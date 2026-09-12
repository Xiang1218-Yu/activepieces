import {
    ApId,
    AuditLogExportSchema,
    CreateAuditLogExportRequest,
    ListAuditEventsRequest,
    PrincipalType,
} from '@activepieces/shared'
import contentDisposition from 'content-disposition'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { StatusCodes } from 'http-status-codes'
import { z } from 'zod'
import { securityAccess } from '../../core/security/authorization/fastify-security'
import { platformMustHaveFeatureEnabled } from '../authentication/ee-authorization'
import { auditLogService } from './audit-event-service'
import { auditLogExportService, DownloadTransport } from './audit-log-export-service'
import { auditLogExportJobs } from './audit-log-export.jobs'
export const auditEventModule: FastifyPluginAsyncZod = async (app) => {
    auditLogService(app.log).setup()
    auditLogExportJobs(app.log).register()
    await app.register(auditEventDownloadController, { prefix: '/v1/audit-events/exports' })
    await app.register(async (protectedApp) => {
        protectedApp.addHook('preHandler', platformMustHaveFeatureEnabled((platform) => platform.plan.auditLogEnabled))
        await protectedApp.register(auditEventController, { prefix: '/v1/audit-events' })
    })
}

const auditEventController: FastifyPluginAsyncZod = async (app) => {

    app.get('/', ListAuditEventsRequestEndpoint, async (request) => {
        return auditLogService(request.log).list({
            platformId: request.principal.platform.id,
            cursorRequest: request.query.cursor ?? null,
            limit: request.query.limit ?? 20,
            action: request.query.action ?? undefined,
            projectId: request.query.projectId ?? undefined,
            userId: request.query.userId ?? undefined,
            createdBefore: request.query.createdBefore ?? undefined,
            createdAfter: request.query.createdAfter ?? undefined,
        })
    })

    app.post('/exports', CreateAuditLogExportEndpoint, async (request, reply) => {
        const filters = {
            projectId: request.body.projectId,
            userId: request.body.userId,
            action: request.body.action,
            createdAfter: request.body.createdAfter,
            createdBefore: request.body.createdBefore,
        }
        const created = await auditLogExportService(request.log).create({
            platformId: request.principal.platform.id,
            requestedById: request.principal.id,
            format: request.body.format,
            filters,
        })
        await auditLogExportJobs(request.log).enqueue(created.id)
        return reply.status(StatusCodes.CREATED).send(created)
    })

    app.get('/exports', ListAuditLogExportsEndpoint, async (request) => {
        return {
            data: await auditLogExportService(request.log).listForPlatform({
                platformId: request.principal.platform.id,
            }),
        }
    })

    app.get('/exports/:id', GetAuditLogExportEndpoint, async (request) => {
        return auditLogExportService(request.log).getOneOrThrow({
            id: request.params.id,
            platformId: request.principal.platform.id,
        })
    })

    app.post('/exports/:id/download-link', CreateDownloadLinkEndpoint, async (request) => {
        return auditLogExportService(request.log).getOneTimeDownloadUrl({
            id: request.params.id,
            platformId: request.principal.platform.id,
        })
    })
}

const auditEventDownloadController: FastifyPluginAsyncZod = async (app) => {
    app.get('/:id/download', DownloadAuditLogExportEndpoint, async (request, reply) => {
        const download = await auditLogExportService(request.log).prepareDownload({ token: request.query.token })
        if (download.kind === DownloadTransport.REDIRECT) {
            return reply
                .status(StatusCodes.TEMPORARY_REDIRECT)
                .header('Location', download.redirectUrl)
                .send()
        }
        return reply
            .type('application/octet-stream')
            .header('X-Content-Type-Options', 'nosniff')
            .header('Content-Disposition', contentDisposition(download.fileName, { type: 'attachment' }))
            .status(StatusCodes.OK)
            .send(download.stream)
    })
}


const ListAuditEventsRequestEndpoint = {
    config: {
        security: securityAccess.platformAdminOnly([PrincipalType.SERVICE, PrincipalType.USER]),
    },
    schema: {
        querystring: ListAuditEventsRequest,
    },
}

const CreateAuditLogExportEndpoint = {
    config: {
        security: securityAccess.platformAdminOnly([PrincipalType.USER]),
    },
    schema: {
        body: CreateAuditLogExportRequest,
        response: {
            [StatusCodes.CREATED]: AuditLogExportSchema,
        },
    },
}

const ListAuditLogExportsEndpoint = {
    config: {
        security: securityAccess.platformAdminOnly([PrincipalType.USER]),
    },
    schema: {
        response: {
            [StatusCodes.OK]: z.object({ data: z.array(AuditLogExportSchema) }),
        },
    },
}

const GetAuditLogExportEndpoint = {
    config: {
        security: securityAccess.platformAdminOnly([PrincipalType.USER]),
    },
    schema: {
        params: z.object({ id: ApId }),
        response: {
            [StatusCodes.OK]: AuditLogExportSchema,
        },
    },
}

const CreateDownloadLinkEndpoint = {
    config: {
        security: securityAccess.platformAdminOnly([PrincipalType.USER]),
    },
    schema: {
        params: z.object({ id: ApId }),
        response: {
            [StatusCodes.OK]: z.object({
                downloadUrl: z.string(),
                expiresAt: z.string(),
            }),
        },
    },
}

const DownloadAuditLogExportEndpoint = {
    config: {
        security: securityAccess.public(),
    },
    schema: {
        params: z.object({ id: ApId }),
        querystring: z.object({ token: z.string() }),
    },
}
