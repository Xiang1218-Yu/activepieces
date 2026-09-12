import { ActivepiecesError, apId, ErrorCode, isNil, PlatformId, ProjectId } from '@activepieces/core-utils'
import { ApplicationEventName, ResolvedRunRetentionPolicy, RunRetentionPolicy, RunRetentionPolicyScope, RunRetentionPolicySpec } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { IsNull } from 'typeorm'
import { repoFactory } from '../core/db/repo-factory'
import { applicationEvents, MetaInformation } from '../helper/application-events'
import { system } from '../helper/system/system'
import { AppSystemProp } from '../helper/system/system-props'
import { projectService } from '../project/project-service'
import { RunRetentionPolicyEntity } from './run-retention-policy-entity'

export const runRetentionPolicyRepo = repoFactory<RunRetentionPolicy>(RunRetentionPolicyEntity)

export const runRetentionPolicyService = (log: FastifyBaseLogger) => ({
    async getDefault({ platformId }: GetDefaultParams): Promise<RunRetentionPolicy | null> {
        return runRetentionPolicyRepo().findOneBy({ platformId, projectId: IsNull() })
    },
    async getOverride({ projectId }: GetOverrideParams): Promise<RunRetentionPolicy | null> {
        return runRetentionPolicyRepo().findOneBy({ projectId })
    },
    async getEffective({ platformId, projectId }: GetEffectiveParams): Promise<ResolvedRunRetentionPolicy | null> {
        const override = await this.getOverride({ projectId })
        if (!isNil(override)) {
            return { source: RunRetentionPolicyScope.PROJECT, ...toSpec(override) }
        }
        const platformDefault = await this.getDefault({ platformId })
        if (!isNil(platformDefault)) {
            return { source: RunRetentionPolicyScope.PLATFORM, ...toSpec(platformDefault) }
        }
        return null
    },
    async upsertDefault({ platformId, spec, meta }: UpsertDefaultParams): Promise<RunRetentionPolicy> {
        const existing = await this.getDefault({ platformId })
        const saved = await runRetentionPolicyRepo().save({
            id: existing?.id ?? apId(),
            platformId,
            projectId: null,
            ...spec,
        })
        emitPolicyEvent(log, {
            action: ApplicationEventName.RUN_RETENTION_POLICY_UPDATED,
            scope: RunRetentionPolicyScope.PLATFORM,
            spec,
            meta: { ...meta, platformId },
        })
        return saved
    },
    async upsertOverride({ platformId, projectId, spec, meta }: UpsertOverrideParams): Promise<RunRetentionPolicy> {
        const platformDefault = await this.getDefault({ platformId })
        const ceilingDays = platformDefault?.retentionDays ?? system.getNumberOrThrow(AppSystemProp.EXECUTION_DATA_RETENTION_DAYS)
        if (spec.retentionDays >= ceilingDays) {
            throw new ActivepiecesError({
                code: ErrorCode.VALIDATION,
                params: {
                    message: `Project retention override must be shorter than the platform default of ${ceilingDays} days`,
                },
            })
        }
        const project = await projectService(log).getOneOrThrow(projectId)
        if (project.platformId !== platformId) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: {
                    entityType: 'project',
                    entityId: projectId,
                },
            })
        }
        const existing = await this.getOverride({ projectId })
        const saved = await runRetentionPolicyRepo().save({
            id: existing?.id ?? apId(),
            platformId,
            projectId,
            ...spec,
        })
        emitPolicyEvent(log, {
            action: ApplicationEventName.RUN_RETENTION_POLICY_UPDATED,
            scope: RunRetentionPolicyScope.PROJECT,
            spec,
            meta: { ...meta, platformId, projectId },
        })
        return saved
    },
    async deleteDefault({ platformId, meta }: DeleteDefaultParams): Promise<void> {
        const existing = await this.getDefault({ platformId })
        if (isNil(existing)) {
            return
        }
        await runRetentionPolicyRepo().delete({ id: existing.id })
        emitPolicyEvent(log, {
            action: ApplicationEventName.RUN_RETENTION_POLICY_DELETED,
            scope: RunRetentionPolicyScope.PLATFORM,
            spec: toSpec(existing),
            meta: { ...meta, platformId },
        })
    },
    async deleteOverride({ platformId, projectId, meta }: DeleteOverrideParams): Promise<void> {
        const existing = await this.getOverride({ projectId })
        if (isNil(existing)) {
            return
        }
        await runRetentionPolicyRepo().delete({ id: existing.id })
        emitPolicyEvent(log, {
            action: ApplicationEventName.RUN_RETENTION_POLICY_DELETED,
            scope: RunRetentionPolicyScope.PROJECT,
            spec: toSpec(existing),
            meta: { ...meta, platformId, projectId },
        })
    },
})

function toSpec(policy: RunRetentionPolicy): RunRetentionPolicySpec {
    return {
        retentionDays: policy.retentionDays,
        statuses: policy.statuses,
        includeArchived: policy.includeArchived,
    }
}

function emitPolicyEvent(log: FastifyBaseLogger, { action, scope, spec, meta }: EmitPolicyEventParams): void {
    applicationEvents(log).sendUserEvent(meta, {
        action,
        data: {
            policy: {
                scope,
                retentionDays: spec.retentionDays,
                statuses: spec.statuses,
                includeArchived: spec.includeArchived,
            },
        },
    })
}

type GetDefaultParams = {
    platformId: PlatformId
}

type GetOverrideParams = {
    projectId: ProjectId
}

type GetEffectiveParams = {
    platformId: PlatformId
    projectId: ProjectId
}

type UpsertDefaultParams = {
    platformId: PlatformId
    spec: RunRetentionPolicySpec
    meta: Omit<MetaInformation, 'platformId'>
}

type UpsertOverrideParams = {
    platformId: PlatformId
    projectId: ProjectId
    spec: RunRetentionPolicySpec
    meta: Omit<MetaInformation, 'platformId' | 'projectId'>
}

type DeleteDefaultParams = {
    platformId: PlatformId
    meta: Omit<MetaInformation, 'platformId'>
}

type DeleteOverrideParams = {
    platformId: PlatformId
    projectId: ProjectId
    meta: Omit<MetaInformation, 'platformId' | 'projectId'>
}

type EmitPolicyEventParams = {
    action: ApplicationEventName.RUN_RETENTION_POLICY_UPDATED | ApplicationEventName.RUN_RETENTION_POLICY_DELETED
    scope: RunRetentionPolicyScope
    spec: RunRetentionPolicySpec
    meta: MetaInformation
}
