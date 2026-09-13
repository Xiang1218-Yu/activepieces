import { ActivepiecesError, apId, ApId, ApplicationEventName, ApprovalSlaPolicy, Cursor, ErrorCode, Flow, FlowApprovalPriority, FlowApprovalRequest, FlowApprovalRequestState, FlowOperationType, FlowStatus, FlowVersionState, isNil, Permission, PlatformId, PopulatedFlowApprovalRequest, Principal, PrincipalType, ProjectId, SeekPage, UserId } from '@activepieces/shared'
import { FastifyBaseLogger, FastifyRequest } from 'fastify'
import { IsNull, LessThanOrEqual } from 'typeorm'
import { repoFactory } from '../../../core/db/repo-factory'
import { transaction } from '../../../core/db/transaction'
import { flowExecutionCache } from '../../../flows/flow/flow-execution-cache'
import { flowService } from '../../../flows/flow/flow.service'
import { flowVersionRepo, flowVersionService } from '../../../flows/flow-version/flow-version.service'
import { applicationEvents } from '../../../helper/application-events'
import { buildPaginator } from '../../../helper/pagination/build-paginator'
import { paginationHelper } from '../../../helper/pagination/pagination-utils'
import { Order } from '../../../helper/pagination/paginator'
import { triggerSourceService } from '../../../trigger/trigger-source/trigger-source-service'
import { projectMemberService } from '../../projects/project-members/project-member.service'
import { approvalSlaPolicyService } from './approval-sla-policy.service'
import { approvalSlaTime } from './approval-sla-time'
import { FlowApprovalRequestEntity, FlowApprovalRequestSchema } from './flow-approval-request.entity'

const flowApprovalRequestRepo = repoFactory(FlowApprovalRequestEntity)

export const flowApprovalRequestService = (log: FastifyBaseLogger) => ({
    async submitForApproval({ flow, userId, projectId, platformId, requestedStatus, priority }: SubmitParams): Promise<FlowApprovalRequest> {
        const draft = await flowVersionService(log).getFlowVersionOrThrow({
            flowId: flow.id,
            versionId: undefined,
        })
        const policy = await approvalSlaPolicyService(log).getForProject({ projectId })
        const rule = policy ? approvalSlaTime.resolveRule(policy, priority) : undefined
        const nowIso = new Date().toISOString()
        const slaDeadlineAt = policy && rule
            ? approvalSlaTime.computeDeadline({ submittedAtIso: nowIso, rule, timezoneName: policy.timezone })
            : null
        return transaction(async (entityManager) => {
            const lockedVersion = draft.state === FlowVersionState.LOCKED
                ? draft
                : await flowVersionService(log).applyOperation({
                    userId,
                    projectId,
                    platformId,
                    flowVersion: draft,
                    userOperation: { type: FlowOperationType.LOCK_FLOW, request: {} },
                    entityManager,
                })
            await flowApprovalRequestRepo(entityManager)
                .createQueryBuilder()
                .insert()
                .into(FlowApprovalRequestEntity)
                .values({
                    id: apId(),
                    flowId: flow.id,
                    flowVersionId: lockedVersion.id,
                    projectId,
                    platformId,
                    submitterId: userId ?? null,
                    submittedAt: nowIso,
                    approverId: null,
                    decidedAt: null,
                    state: FlowApprovalRequestState.PENDING,
                    requestedStatus,
                    rejectionReason: null,
                    priority,
                    slaDeadlineAt,
                    pausedAt: null,
                    escalatedAt: null,
                    slaBreachReason: null,
                })
                .orUpdate(
                    ['flowVersionId', 'submitterId', 'submittedAt', 'requestedStatus', 'priority', 'slaDeadlineAt', 'pausedAt', 'escalatedAt', 'slaBreachReason'],
                    ['flowId'],
                    { indexPredicate: '"state" = \'PENDING\'' },
                )
                .execute()
            const persisted = await flowApprovalRequestRepo(entityManager).findOneByOrFail({
                flowId: flow.id,
                state: FlowApprovalRequestState.PENDING,
            })
            applicationEvents(log).sendUserEvent({ platformId, userId: userId ?? undefined, projectId }, {
                action: ApplicationEventName.FLOW_APPROVAL_REQUESTED,
                data: {
                    approvalRequestId: persisted.id,
                    flowId: flow.id,
                    flowVersionId: lockedVersion.id,
                    flowDisplayName: lockedVersion.displayName,
                },
            })
            return persisted
        })
    },

    async approve({ requestId, projectId, approverPrincipal, request }: DecideParams): Promise<PopulatedFlowApprovalRequest> {
        const approval = await this.getOneOrThrow({ requestId, projectId })
        if (approval.state === FlowApprovalRequestState.APPROVED) {
            return this.getPopulatedOrThrow({ requestId, projectId })
        }
        assertStateIsPending(approval.state)

        const flow = await flowService(log).getOneOrThrow({ id: approval.flowId, projectId: approval.projectId })
        const lockedVersion = await flowVersionService(log).getFlowVersionOrThrow({
            flowId: flow.id,
            versionId: approval.flowVersionId,
        })

        const decidedAt = new Date().toISOString()
        const approverId = approverPrincipal.type === PrincipalType.SERVICE ? null : approverPrincipal.id

        await transaction(async (entityManager) => {
            const updateResult = await flowApprovalRequestRepo(entityManager)
                .createQueryBuilder()
                .update()
                .set({
                    state: FlowApprovalRequestState.APPROVED,
                    approverId,
                    decidedAt,
                    pausedAt: null,
                })
                .where({ id: approval.id, state: FlowApprovalRequestState.PENDING })
                .returning(['id'])
                .execute()
            assertRowsAffected(updateResult.raw?.length)
            await flowService(log).setPublishedVersion({ flow, lockedVersion, entityManager })
        })

        if (flow.status === FlowStatus.ENABLED && !isNil(flow.publishedVersionId)) {
            await triggerSourceService(log).disable({
                flowId: flow.id,
                projectId: flow.projectId,
                simulate: false,
                ignoreError: true,
            })
        }
        await flowExecutionCache(log).invalidate(flow.id)
        await flowService(log).applyStatusChangeForPublishedFlow({
            id: flow.id,
            projectId: approval.projectId,
            newStatus: approval.requestedStatus,
        })
        applicationEvents(log).sendUserEvent(request, {
            action: ApplicationEventName.FLOW_APPROVAL_GRANTED,
            data: {
                approvalRequestId: approval.id,
                flowId: flow.id,
                flowVersionId: approval.flowVersionId,
                flowDisplayName: lockedVersion.displayName,
            },
        })
        return this.getPopulatedOrThrow({ requestId: approval.id, projectId })
    },

    async reject({ requestId, projectId, approverPrincipal, reason, request }: RejectParams): Promise<PopulatedFlowApprovalRequest> {
        const approval = await this.getOneOrThrow({ requestId, projectId })
        if (approval.state === FlowApprovalRequestState.REJECTED) {
            return this.getPopulatedOrThrow({ requestId, projectId })
        }
        assertStateIsPending(approval.state)

        const lockedVersion = await flowVersionService(log).getFlowVersionOrThrow({
            flowId: approval.flowId,
            versionId: approval.flowVersionId,
        })

        const decidedAt = new Date().toISOString()
        const rejectionReason = reason ?? null
        const approverId = approverPrincipal.type === PrincipalType.SERVICE ? null : approverPrincipal.id

        const rejectResult = await flowApprovalRequestRepo()
            .createQueryBuilder()
            .update()
            .set({
                state: FlowApprovalRequestState.REJECTED,
                approverId,
                decidedAt,
                rejectionReason,
                pausedAt: null,
            })
            .where({ id: approval.id, state: FlowApprovalRequestState.PENDING })
            .returning(['id'])
            .execute()
        assertRowsAffected(rejectResult.raw?.length)

        applicationEvents(log).sendUserEvent(request, {
            action: ApplicationEventName.FLOW_APPROVAL_REJECTED,
            data: {
                approvalRequestId: approval.id,
                flowId: approval.flowId,
                flowVersionId: approval.flowVersionId,
                flowDisplayName: lockedVersion.displayName,
                rejectionReason,
            },
        })
        return this.getPopulatedOrThrow({ requestId: approval.id, projectId })
    },

    async withdraw({ requestId, projectId, request }: WithdrawParams): Promise<void> {
        const approval = await this.getOneOrThrow({ requestId, projectId })
        assertStateIsPending(approval.state)

        const lockedVersion = await flowVersionService(log).getFlowVersionOrThrow({
            flowId: approval.flowId,
            versionId: approval.flowVersionId,
        })

        await transaction(async (entityManager) => {
            const deleteResult = await flowApprovalRequestRepo(entityManager)
                .createQueryBuilder()
                .delete()
                .where({ id: approval.id, state: FlowApprovalRequestState.PENDING })
                .returning(['id'])
                .execute()
            assertRowsAffected(deleteResult.raw?.length)
            await flowVersionRepo(entityManager).update({ id: lockedVersion.id }, { state: FlowVersionState.DRAFT })
        })

        applicationEvents(log).sendUserEvent(request, {
            action: ApplicationEventName.FLOW_APPROVAL_WITHDRAWN,
            data: {
                approvalRequestId: approval.id,
                flowId: approval.flowId,
                flowVersionId: approval.flowVersionId,
                flowDisplayName: lockedVersion.displayName,
            },
        })
    },

    async pause({ requestId, projectId }: PauseParams): Promise<PopulatedFlowApprovalRequest> {
        const approval = await this.getOneOrThrow({ requestId, projectId })
        assertStateIsPending(approval.state)
        if (approval.pausedAt === null) {
            await flowApprovalRequestRepo().update(
                { id: approval.id, state: FlowApprovalRequestState.PENDING, pausedAt: IsNull() },
                { pausedAt: new Date().toISOString() },
            )
        }
        return this.getPopulatedOrThrow({ requestId, projectId })
    },

    async resume({ requestId, projectId }: PauseParams): Promise<PopulatedFlowApprovalRequest> {
        const approval = await this.getOneOrThrow({ requestId, projectId })
        assertStateIsPending(approval.state)
        if (approval.pausedAt !== null) {
            await shiftDeadlineForPausedDuration({ requestId: approval.id, projectId })
        }
        return this.getPopulatedOrThrow({ requestId, projectId })
    },

    async getOneOrThrow({ requestId, projectId }: { requestId: ApId, projectId: ProjectId }): Promise<FlowApprovalRequest> {
        const approval = await flowApprovalRequestRepo().findOne({
            where: { id: requestId, projectId },
        })
        if (isNil(approval)) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: { entityType: 'FlowApprovalRequest', entityId: requestId },
            })
        }
        return approval
    },

    async getPendingByFlowId({ flowId, projectId }: { flowId: string, projectId: ProjectId }): Promise<FlowApprovalRequest | null> {
        return flowApprovalRequestRepo().findOne({
            where: { flowId, projectId, state: FlowApprovalRequestState.PENDING },
        })
    },

    async getPopulatedOrThrow({ requestId, projectId, policy }: { requestId: ApId, projectId: ProjectId, policy?: ApprovalSlaPolicy | null }): Promise<PopulatedFlowApprovalRequest> {
        const approval = await this.getOneOrThrow({ requestId, projectId })
        const flowVersion = await flowVersionService(log).getOneOrThrow(approval.flowVersionId)
        const effectivePolicy = policy === undefined ? await approvalSlaPolicyService(log).getForProject({ projectId }) : policy
        return {
            ...approval,
            flowVersion: {
                id: flowVersion.id,
                displayName: flowVersion.displayName,
                flowId: flowVersion.flowId,
                state: flowVersion.state,
                created: flowVersion.created,
                updated: flowVersion.updated,
            },
            sla: approvalSlaTime.computeSlaStatus({ approval, policy: effectivePolicy }),
        }
    },

    async list({ projectId, state, flowVersionId, cursor, limit, viewerId, mine, overdue }: ListParams): Promise<SeekPage<PopulatedFlowApprovalRequest>> {
        const decoded = paginationHelper.decodeCursor(cursor)
        const paginator = buildPaginator({
            entity: FlowApprovalRequestEntity,
            alias: 'far',
            query: {
                limit: limit ?? 50,
                orderBy: [{ field: 'created', order: Order.DESC }],
                afterCursor: decoded.nextCursor,
                beforeCursor: decoded.previousCursor,
            },
        })
        const qb = flowApprovalRequestRepo()
            .createQueryBuilder('far')
            .leftJoinAndMapOne(
                'far.flowVersion',
                'flow_version',
                'fv',
                'fv.id = far."flowVersionId"',
            )
            .where({ projectId })
        if (state) {
            qb.andWhere({ state })
        }
        if (flowVersionId) {
            qb.andWhere({ flowVersionId })
        }
        if (mine && viewerId) {
            qb.andWhere('(far."submitterId" = :viewerId OR far."approverId" = :viewerId)', { viewerId })
        }
        if (overdue) {
            qb.andWhere('far."state" = :pendingState AND far."pausedAt" IS NULL AND far."slaDeadlineAt" IS NOT NULL AND far."slaDeadlineAt" <= :now', {
                pendingState: FlowApprovalRequestState.PENDING,
                now: new Date().toISOString(),
            })
        }
        const result = await paginator.paginate<FlowApprovalRequestSchema & { flowVersion?: { id: string, displayName: string, flowId: string, state: FlowVersionState, created: string, updated: string } }>(qb)
        const policy = await approvalSlaPolicyService(log).getForProject({ projectId })
        const visibleApproverIds = viewerId
            ? await projectMemberService(log).listUserIdsWithPermissionOnProject({ projectId, permission: Permission.PUBLISH_SENSITIVE_FLOW_ACCESS })
            : null
        const populated: PopulatedFlowApprovalRequest[] = result.data
            .filter((row) => isViewerAllowed({ row, viewerId: viewerId ?? null, visibleApproverIds }))
            .map((row) => ({
                ...row,
                flowVersion: row.flowVersion
                    ? {
                        id: row.flowVersion.id,
                        displayName: row.flowVersion.displayName,
                        flowId: row.flowVersion.flowId,
                        state: row.flowVersion.state,
                        created: row.flowVersion.created,
                        updated: row.flowVersion.updated,
                    }
                    : undefined,
                sla: approvalSlaTime.computeSlaStatus({ approval: row, policy }),
            }))
        return paginationHelper.createPage(populated, result.cursor)
    },

    async listDueForSlaCheck({ nowIso, batchSize = 200 }: { nowIso: string, batchSize?: number }): Promise<FlowApprovalRequest[]> {
        return flowApprovalRequestRepo().find({
            where: {
                state: FlowApprovalRequestState.PENDING,
                pausedAt: IsNull(),
                slaDeadlineAt: LessThanOrEqual(nowIso),
            },
            order: { slaDeadlineAt: 'ASC' },
            take: batchSize,
        })
    },

    async markEscalated({ requestId, projectId, escalatedAt }: { requestId: ApId, projectId: ProjectId, escalatedAt: string }): Promise<boolean> {
        const updateResult = await flowApprovalRequestRepo()
            .createQueryBuilder()
            .update()
            .set({ escalatedAt })
            .where({ id: requestId, projectId, escalatedAt: IsNull(), state: FlowApprovalRequestState.PENDING })
            .returning(['id'])
            .execute()
        return (updateResult.raw?.length ?? 0) > 0
    },

    async markBreached({ requestId, projectId, reason }: { requestId: ApId, projectId: ProjectId, reason: NonNullable<FlowApprovalRequest['slaBreachReason']> }): Promise<boolean> {
        const updateResult = await flowApprovalRequestRepo()
            .createQueryBuilder()
            .update()
            .set({ slaBreachReason: reason })
            .where({ id: requestId, projectId, state: FlowApprovalRequestState.PENDING, slaBreachReason: IsNull() })
            .returning(['id'])
            .execute()
        return (updateResult.raw?.length ?? 0) > 0
    },
})

async function shiftDeadlineForPausedDuration({ requestId, projectId }: {
    requestId: ApId
    projectId: ProjectId
}): Promise<void> {
    await transaction(async (entityManager) => {
        const locked = await flowApprovalRequestRepo(entityManager)
            .createQueryBuilder('far')
            .setLock('pessimistic_write')
            .where({ id: requestId, projectId })
            .getOneOrFail()
        if (isNil(locked.pausedAt)) {
            return
        }
        const resumeIso = new Date().toISOString()
        const pausedMillis = new Date(resumeIso).getTime() - new Date(locked.pausedAt).getTime()
        const newDeadline = locked.slaDeadlineAt
            ? new Date(new Date(locked.slaDeadlineAt).getTime() + pausedMillis).toISOString()
            : null
        await flowApprovalRequestRepo(entityManager).update(
            { id: locked.id },
            { pausedAt: null, slaDeadlineAt: newDeadline },
        )
    })
}

function isViewerAllowed({ row, viewerId, visibleApproverIds }: {
    row: FlowApprovalRequest
    viewerId: UserId | null
    visibleApproverIds: UserId[] | null
}): boolean {
    if (viewerId === null || visibleApproverIds === null) {
        return true
    }
    const isSubmitter = row.submitterId === viewerId
    const canApprove = visibleApproverIds.includes(viewerId)
    return isSubmitter || canApprove
}

function assertStateIsPending(state: FlowApprovalRequestState): void {
    if (state !== FlowApprovalRequestState.PENDING) {
        throw new ActivepiecesError({
            code: ErrorCode.VALIDATION,
            params: { message: 'This approval request is no longer pending' },
        })
    }
}

function assertRowsAffected(affected: number | null | undefined): void {
    if (!affected || affected === 0) {
        throw new ActivepiecesError({
            code: ErrorCode.VALIDATION,
            params: { message: 'This approval request is no longer pending' },
        })
    }
}

type SubmitParams = {
    flow: Flow
    userId: UserId | null
    projectId: ProjectId
    platformId: PlatformId
    requestedStatus: FlowStatus
    priority: FlowApprovalPriority
}

type DecideParams = {
    requestId: ApId
    projectId: ProjectId
    approverPrincipal: Principal
    request: FastifyRequest
}

type RejectParams = DecideParams & {
    reason?: string
}

type WithdrawParams = {
    requestId: ApId
    projectId: ProjectId
    request: FastifyRequest
}

type PauseParams = {
    requestId: ApId
    projectId: ProjectId
}

type ListParams = {
    projectId: ProjectId
    state?: FlowApprovalRequestState
    flowVersionId?: ApId
    cursor?: Cursor
    limit?: number
    viewerId?: UserId
    mine?: boolean
    overdue?: boolean
}
