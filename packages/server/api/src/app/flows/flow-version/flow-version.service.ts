import { ActivepiecesError, apId, Cursor, ErrorCode, FlowId, FlowVersionId, isNil, PlatformId, ProjectId, SeekPage, UserId } from '@activepieces/core-utils'
import { FlowOperationRequest, flowStructureUtil, FlowTriggerType, FlowVersion, FlowVersionState, LATEST_FLOW_SCHEMA_VERSION, Note } from '@activepieces/shared'
import dayjs from 'dayjs'
import { FastifyBaseLogger } from 'fastify'
import { EntityManager, FindOneOptions, SelectQueryBuilder } from 'typeorm'
import { buildPaginator } from '../../helper/pagination/build-paginator'
import { paginationHelper } from '../../helper/pagination/pagination-utils'
import { projectService } from '../../project/project-service'
import { userService } from '../../user/user-service'
import { FlowVersionEntity } from './flow-version-entity'
import { flowVersionMigrationService } from './flow-version-migration.service'
import { flowVersionRepo } from './flow-version.repo'
import { applySingleOperation } from './operations/flow-operation-applier'
import { finalizeAndSaveVersion } from './operations/flow-version-finalizer'
import { expandOperation } from './operations/operation-expanders'

export { flowVersionRepo } from './flow-version.repo'

export const publishedFlowVersionsUsingAgent = ({ projectId, agentExternalId, alias = 'flow_version' }: { projectId: ProjectId, agentExternalId: string, alias?: string }): SelectQueryBuilder<FlowVersion> => flowVersionRepo()
    .createQueryBuilder(alias)
    .innerJoin('flow', `${alias}_flow`, `${alias}_flow.id = ${alias}."flowId"`)
    .where(`${alias}_flow."projectId" = :projectId`, { projectId })
    .andWhere(`${alias}.id = ${alias}_flow."publishedVersionId"`)
    .andWhere(`${alias}."agentIds" && :agentExternalIds`, { agentExternalIds: [agentExternalId] })

export const publishedFlowsUsingAgent = async ({ projectId, agentExternalId, nameLimit }: { projectId: ProjectId, agentExternalId: string, nameLimit: number }): Promise<PublishedFlowsUsingAgent> => {
    const referencing = () => publishedFlowVersionsUsingAgent({ projectId, agentExternalId })
    const [total, named] = await Promise.all([
        referencing().getCount(),
        referencing()
            .select('flow_version."displayName"', 'displayName')
            .orderBy('flow_version."displayName"', 'ASC')
            .limit(nameLimit)
            .getRawMany<{ displayName: string }>(),
    ])
    return { total, names: named.map((row) => row.displayName) }
}

export const flowVersionService = (log: FastifyBaseLogger) => ({
    /**
     * Applies a user operation to a flow version.
     *
     * Responsibilities are split into:
     * - expandOperation: composite operations (USE_AS_DRAFT, SAVE_SAMPLE_DATA,
     *   future ones) are expanded into an ordered list of primitive operations
     *   by a registry (see operations/operation-expanders.ts);
     * - applySingleOperation: per-operation side effects, validation and pure
     *   structure application (operations/flow-operation-applier.ts);
     * - finalizeAndSaveVersion: timestamps/connection+agent reference
     *   extraction and the single persist (operations/flow-version-finalizer.ts).
     *
     * The version row is written only once after the whole batch succeeds, so
     * an exception on operation N leaves the stored version as it was before.
     */
    async applyOperation({
        flowVersion,
        projectId,
        userId,
        userOperation,
        entityManager,
        platformId,
    }: ApplyOperationParams): Promise<FlowVersion> {
        const operations = await expandOperation(userOperation, {
            log,
            projectId,
            flowVersion,
            loadVersionOrThrow: (versionId) => this.getFlowVersionOrThrow({
                flowId: flowVersion.flowId,
                versionId,
                removeConnectionsName: false,
            }),
        })

        let mutatedFlowVersion = flowVersion
        for (const operation of operations) {
            mutatedFlowVersion = await applySingleOperation({
                projectId,
                flowVersion: mutatedFlowVersion,
                operation,
                platformId,
                log,
                userId,
                entityManager,
            })
        }

        return finalizeAndSaveVersion({
            userId,
            entityManager,
            flowVersion: mutatedFlowVersion,
        })
    },

    async getOne(id: FlowVersionId): Promise<FlowVersion | null> {
        if (isNil(id)) {
            return null
        }
        return findOne(log, {
            where: {
                id,
            },
        })
    },

    async exists(id: FlowVersionId): Promise<boolean> {
        return flowVersionRepo().exists({
            where: {
                id,
            },
        })
    },
    async getLatestVersion(flowId: FlowId, state: FlowVersionState): Promise<FlowVersion | null> {
        return findOne(log, {
            where: {
                flowId,
                state,
            },
            order: {
                created: 'DESC',
            },
        })
    },

    async getLatestVersionsByFlowIds(flowIds: FlowId[], projectId?: ProjectId): Promise<Map<FlowId, FlowVersion>> {
        if (flowIds.length === 0) {
            return new Map()
        }
        const latestVersions = await flowVersionRepo()
            .createQueryBuilder('fv')
            .where('fv.flowId IN (:...flowIds)', { flowIds })
            .distinctOn(['fv.flowId'])
            .orderBy('fv.flowId')
            .addOrderBy('fv.created', 'DESC')
            .getMany()
        const platformId = isNil(projectId) ? undefined : await projectService(log).getPlatformId(projectId)
        const migratedEntries = await Promise.all(
            latestVersions.map(async (version) => {
                const migrated = await flowVersionMigrationService(log).migrate(version, projectId, platformId)
                return [version.flowId, migrated] as const
            }),
        )
        return new Map(migratedEntries)
    },

    async getLatestLockedVersionOrThrow(flowId: FlowId): Promise<FlowVersion> {
        const lockedVersion = await this.getLatestVersion(flowId, FlowVersionState.LOCKED)
        if (isNil(lockedVersion)) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: {
                    entityId: flowId,
                    entityType: 'FlowVersion',
                },
            })
        }
        return lockedVersion
    },

    async getOneOrThrow(id: FlowVersionId): Promise<FlowVersion> {
        const flowVersion = await flowVersionService(log).getOne(id)

        if (isNil(flowVersion)) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: {
                    entityId: id,
                    entityType: 'FlowVersion',
                },
            })
        }

        return flowVersion
    },
    async list({
        cursorRequest,
        limit,
        flowId,
    }: ListFlowVersionParams): Promise<SeekPage<FlowVersion>> {
        const decodedCursor = paginationHelper.decodeCursor(cursorRequest)
        const paginator = buildPaginator({
            entity: FlowVersionEntity,
            query: {
                limit,
                order: 'DESC',
                afterCursor: decodedCursor.nextCursor,
                beforeCursor: decodedCursor.previousCursor,
            },
        })
        const paginationResult = await paginator.paginate(
            flowVersionRepo().createQueryBuilder()
                .where({
                    flowId,
                }),
        )
        const promises = paginationResult.data.map(async (flowVersion) => {
            return {
                ...flowVersion,
                updatedByUser: isNil(flowVersion.updatedBy) ? null : await userService(log).getMetaInformation({
                    id: flowVersion.updatedBy,
                }),
            }
        })
        return paginationHelper.createPage<FlowVersion>(
            await Promise.all(promises),
            paginationResult.cursor,
        )
    },
    async getFlowVersionOrThrow({
        flowId,
        versionId,
        removeConnectionsName = false,
        removeSampleData = false,
        entityManager,
        projectId,
        platformId,
    }: GetFlowVersionOrThrowParams): Promise<FlowVersion> {
        const flowVersion: FlowVersion | null = await findOne(log, {
            where: {
                flowId,
                id: versionId,
            },
            //This is needed to return draft by default because it is always the latest one
            order: {
                created: 'DESC',
            },
        }, entityManager, projectId, platformId)

        if (isNil(flowVersion)) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: {
                    entityId: versionId,
                    entityType: 'FlowVersion',
                    message: `flowId=${flowId}`,
                },
            })
        }

        return this.removeConnectionsAndSampleDataFromFlowVersion(
            flowVersion,
            removeConnectionsName,
            removeSampleData,
        )
    },
    async createEmptyVersion({
        flowId,
        displayName,
        notes,
        schemaVersion,
        entityManager,
    }: CreateEmptyVersionParams): Promise<FlowVersion> {
        const flowVersion: NewFlowVersion = {
            id: apId(),
            displayName,
            flowId,
            trigger: {
                type: FlowTriggerType.EMPTY,
                name: 'trigger',
                settings: {},
                valid: false,
                displayName: 'Select Trigger',
                lastUpdatedDate: dayjs().toISOString(),
            },
            schemaVersion: schemaVersion ?? LATEST_FLOW_SCHEMA_VERSION,
            connectionIds: [],
            agentIds: [],
            valid: false,
            state: FlowVersionState.DRAFT,
            notes,
        }
        return flowVersionRepo(entityManager).save(flowVersion)
    },
    removeConnectionsAndSampleDataFromFlowVersion(
        flowVersion: FlowVersion,
        removeConnectionNames: boolean,
        removeSampleData: boolean,
    ): FlowVersion {
        return flowStructureUtil.transferFlow(flowVersion, (step) => {
            const settings = { ...step.settings }
            if (removeConnectionNames && !isNil(settings.input)) {
                settings.input = removeConnectionsFromInput(settings.input)
            }
            if (removeSampleData && !isNil(settings.sampleData)) {
                settings.sampleData = {
                    ...settings.sampleData,
                    sampleDataFileId: undefined,
                    sampleDataInputFileId: undefined,
                    lastTestDate: undefined,
                }
            }
            return { ...step, settings }
        })
    },
})



async function findOne(log: FastifyBaseLogger, options: FindOneOptions, entityManager?: EntityManager, projectId?: ProjectId, platformId?: string): Promise<FlowVersion | null> {
    const flowVersion = await flowVersionRepo(entityManager).findOne(options)
    if (isNil(flowVersion)) {
        return null
    }
    return flowVersionMigrationService(log).migrate(flowVersion, projectId, platformId)
}

function removeConnectionsFromInput(
    obj: Record<string, unknown>,
): Record<string, unknown> {
    if (isNil(obj)) {
        return obj
    }
    const replacedObj: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(obj)) {
        if (Array.isArray(value)) {
            replacedObj[key] = value
        }
        else if (typeof value === 'object' && value !== null) {
            replacedObj[key] = removeConnectionsFromInput(value as Record<string, unknown>)
        }
        else if (typeof value === 'string') {
            const replacedValue = value.replace(/\{{connections\.[^}]*}}/g, '')
            replacedObj[key] = replacedValue === '' ? undefined : replacedValue
        }
        else {
            replacedObj[key] = value
        }
    }
    return replacedObj
}

type GetFlowVersionOrThrowParams = {
    flowId: FlowId
    versionId: FlowVersionId | undefined
    removeConnectionsName?: boolean
    removeSampleData?: boolean
    entityManager?: EntityManager
    projectId?: ProjectId
    platformId?: string
}

type NewFlowVersion = Omit<FlowVersion, 'created' | 'updated'>

type CreateEmptyVersionParams = {
    flowId: FlowId
    displayName: string
    notes: Note[]
    schemaVersion: string | undefined | null
    entityManager?: EntityManager
}

type ListFlowVersionParams = {
    flowId: FlowId
    cursorRequest: Cursor | null
    limit: number
}

type ApplyOperationParams = {
    userId: UserId | null
    projectId: ProjectId
    platformId: PlatformId
    flowVersion: FlowVersion
    userOperation: FlowOperationRequest
    entityManager?: EntityManager
}

export type PublishedFlowsUsingAgent = {
    total: number
    names: string[]
}
