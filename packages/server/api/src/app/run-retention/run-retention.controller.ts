import { ActivepiecesError, ErrorCode, isNil, Nullable, Permission } from '@activepieces/core-utils'
import { PreviewRunRetentionCleanupRequest, PrincipalType, ResolvedRunRetentionPolicy, RunRetentionCleanupPreview, RunRetentionPolicy, RunRetentionPolicyQuery, SERVICE_KEY_SECURITY_OPENAPI, UpsertRunRetentionPolicyOverrideRequest, UpsertRunRetentionPolicyRequest } from '@activepieces/shared'
import { FastifyRequest } from 'fastify'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { StatusCodes } from 'http-status-codes'
import { ProjectResourceType } from '../core/security/authorization/common'
import { securityAccess } from '../core/security/authorization/fastify-security'
import { MetaInformation } from '../helper/application-events'
import { networkUtils } from '../helper/network-utils'
import { runRetentionCleanupService } from './run-retention-cleanup-service'
import { runRetentionPolicyService } from './run-retention-policy-service'

export const runRetentionController: FastifyPluginAsyncZod = async (app) => {
    app.get('/default', GetDefaultPolicyRequest, async (request) => {
        const policy = await runRetentionPolicyService(request.log).getDefault({
            platformId: request.principal.platform.id,
        })
        if (isNil(policy)) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: {
                    entityType: 'run_retention_policy',
                    entityId: request.principal.platform.id,
                    message: 'No default run retention policy is configured for this platform',
                },
            })
        }
        return policy
    })

    app.post('/default', UpsertDefaultPolicyRequest, async (request) => {
        return runRetentionPolicyService(request.log).upsertDefault({
            platformId: request.principal.platform.id,
            spec: request.body,
            meta: auditMetaOf(request),
        })
    })

    app.delete('/default', DeleteDefaultPolicyRequest, async (request, reply) => {
        await runRetentionPolicyService(request.log).deleteDefault({
            platformId: request.principal.platform.id,
            meta: auditMetaOf(request),
        })
        return reply.status(StatusCodes.NO_CONTENT).send()
    })

    app.get('/override', GetOverridePolicyRequest, async (request) => {
        const policy = await runRetentionPolicyService(request.log).getOverride({
            projectId: request.query.projectId,
        })
        if (isNil(policy)) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: {
                    entityType: 'run_retention_policy',
                    entityId: request.query.projectId,
                    message: 'No run retention policy override is configured for this project',
                },
            })
        }
        return policy
    })

    app.post('/override', UpsertOverridePolicyRequest, async (request) => {
        return runRetentionPolicyService(request.log).upsertOverride({
            platformId: request.principal.platform.id,
            projectId: request.body.projectId,
            spec: {
                retentionDays: request.body.retentionDays,
                statuses: request.body.statuses,
                includeArchived: request.body.includeArchived,
            },
            meta: auditMetaOf(request),
        })
    })

    app.delete('/override', DeleteOverridePolicyRequest, async (request, reply) => {
        await runRetentionPolicyService(request.log).deleteOverride({
            platformId: request.principal.platform.id,
            projectId: request.query.projectId,
            meta: auditMetaOf(request),
        })
        return reply.status(StatusCodes.NO_CONTENT).send()
    })

    app.get('/effective', GetEffectivePolicyRequest, async (request) => {
        return runRetentionPolicyService(request.log).getEffective({
            platformId: request.principal.platform.id,
            projectId: request.query.projectId,
        })
    })

    app.post('/preview', PreviewCleanupRequest, async (request) => {
        const effective = request.body.policy ?? await runRetentionPolicyService(request.log).getEffective({
            platformId: request.principal.platform.id,
            projectId: request.body.projectId,
        })
        if (isNil(effective)) {
            const emptyPreview: RunRetentionCleanupPreview = { estimatedCount: 0, earliestFinishTime: null }
            return emptyPreview
        }
        return runRetentionCleanupService(request.log).preview({
            projectId: request.body.projectId,
            spec: effective,
        })
    })
}

function auditMetaOf(request: FastifyRequest): Omit<MetaInformation, 'platformId' | 'projectId'> {
    return {
        userId: request.principal.id,
        ip: networkUtils.clientIp(request),
    }
}

const GetDefaultPolicyRequest = {
    config: {
        security: securityAccess.platformAdminOnly([PrincipalType.USER, PrincipalType.SERVICE]),
    },
    schema: {
        tags: ['run-retention'],
        description: 'Get the platform default run retention policy',
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        response: {
            [StatusCodes.OK]: RunRetentionPolicy,
        },
    },
}

const UpsertDefaultPolicyRequest = {
    config: {
        security: securityAccess.platformAdminOnly([PrincipalType.USER, PrincipalType.SERVICE]),
    },
    schema: {
        tags: ['run-retention'],
        description: 'Set the platform default run retention policy',
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        body: UpsertRunRetentionPolicyRequest,
        response: {
            [StatusCodes.OK]: RunRetentionPolicy,
        },
    },
}

const DeleteDefaultPolicyRequest = {
    config: {
        security: securityAccess.platformAdminOnly([PrincipalType.USER, PrincipalType.SERVICE]),
    },
    schema: {
        tags: ['run-retention'],
        description: 'Delete the platform default run retention policy',
        security: [SERVICE_KEY_SECURITY_OPENAPI],
    },
}

const GetOverridePolicyRequest = {
    config: {
        security: securityAccess.project([PrincipalType.USER, PrincipalType.SERVICE], Permission.WRITE_PROJECT, {
            type: ProjectResourceType.QUERY,
        }),
    },
    schema: {
        tags: ['run-retention'],
        description: 'Get the project run retention policy override',
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        querystring: RunRetentionPolicyQuery,
        response: {
            [StatusCodes.OK]: RunRetentionPolicy,
        },
    },
}

const UpsertOverridePolicyRequest = {
    config: {
        security: securityAccess.project([PrincipalType.USER, PrincipalType.SERVICE], Permission.WRITE_PROJECT, {
            type: ProjectResourceType.BODY,
        }),
    },
    schema: {
        tags: ['run-retention'],
        description: 'Set the project run retention policy override, must retain less than the platform default',
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        body: UpsertRunRetentionPolicyOverrideRequest,
        response: {
            [StatusCodes.OK]: RunRetentionPolicy,
        },
    },
}

const DeleteOverridePolicyRequest = {
    config: {
        security: securityAccess.project([PrincipalType.USER, PrincipalType.SERVICE], Permission.WRITE_PROJECT, {
            type: ProjectResourceType.QUERY,
        }),
    },
    schema: {
        tags: ['run-retention'],
        description: 'Delete the project run retention policy override',
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        querystring: RunRetentionPolicyQuery,
    },
}

const GetEffectivePolicyRequest = {
    config: {
        security: securityAccess.project([PrincipalType.USER, PrincipalType.SERVICE], Permission.READ_RUN, {
            type: ProjectResourceType.QUERY,
        }),
    },
    schema: {
        tags: ['run-retention'],
        description: 'Get the effective run retention policy for a project',
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        querystring: RunRetentionPolicyQuery,
        response: {
            [StatusCodes.OK]: Nullable(ResolvedRunRetentionPolicy),
        },
    },
}

const PreviewCleanupRequest = {
    config: {
        security: securityAccess.project([PrincipalType.USER, PrincipalType.SERVICE], Permission.READ_RUN, {
            type: ProjectResourceType.BODY,
        }),
    },
    schema: {
        tags: ['run-retention'],
        description: 'Preview how many runs the retention cleanup would delete and the earliest finish time among them',
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        body: PreviewRunRetentionCleanupRequest,
        response: {
            [StatusCodes.OK]: RunRetentionCleanupPreview,
        },
    },
}
