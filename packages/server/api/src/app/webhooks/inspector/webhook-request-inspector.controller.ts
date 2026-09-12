import { Permission } from '@activepieces/core-utils'
import {
    CopyWebhookRequestAsTestInputBody,
    ListWebhookRequestCapturesRequestQuery,
    PrincipalType,
    WebhookRequestRetentionDays,
} from '@activepieces/shared'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { system } from '../../helper/system/system'
import { AppSystemProp } from '../../helper/system/system-props'
import { ProjectResourceType } from '../core/security/authorization/common'
import { securityAccess } from '../core/security/authorization/fastify-security'
import { WebhookRequestCaptureEntity } from './webhook-request-capture-entity'
import { webhookRequestInspectorService } from './webhook-request-inspector.service'

const DEFAULT_PAGING_LIMIT = 25

export const webhookRequestInspectorController: FastifyPluginAsyncZod = async (app) => {
    app.get('/retention', GetRetentionRequest, async () => {
        return {
            retentionDays: system.getNumberOrThrow(AppSystemProp.WEBHOOK_INSPECTOR_RETENTION_DAYS),
        } satisfies WebhookRequestRetentionDays
    })

    app.get('/', ListRequest, async (request) => {
        return webhookRequestInspectorService(request.log).list({
            projectId: request.query.projectId,
            flowId: request.query.flowId,
            status: request.query.status,
            requestId: request.query.requestId,
            createdAfter: request.query.createdAfter,
            createdBefore: request.query.createdBefore,
            cursor: request.query.cursor,
            limit: Number(request.query.limit ?? DEFAULT_PAGING_LIMIT),
        })
    })

    // The TABLE project resource resolves the capture row and verifies its projectId against the
    // principal before the handler runs — a capture id or request id from another project 404s.
    app.get('/:id', GetRequest, async (request) => {
        return webhookRequestInspectorService(request.log).getOneOrThrow({
            projectId: request.projectId,
            id: request.params.id,
        })
    })

    // Writes a draft-only sample INPUT file. It never executes or enqueues the production flow.
    app.post('/:id/copy-as-test-input', CopyAsTestInputRequest, async (request) => {
        return webhookRequestInspectorService(request.log).copyAsTestInput({
            projectId: request.projectId,
            captureId: request.params.id,
        })
    })
}

const ListRequest = {
    schema: {
        querystring: ListWebhookRequestCapturesRequestQuery,
        tags: ['webhook-request-inspector'],
    },
    config: {
        security: securityAccess.project(
            [PrincipalType.USER],
            Permission.READ_RUN,
            { type: ProjectResourceType.QUERY },
        ),
    },
}

const GetRequest = {
    config: {
        security: securityAccess.project(
            [PrincipalType.USER],
            Permission.READ_RUN,
            {
                type: ProjectResourceType.TABLE,
                tableName: WebhookRequestCaptureEntity,
            },
        ),
    },
}

const CopyAsTestInputRequest = {
    schema: {
        body: CopyWebhookRequestAsTestInputBody,
        tags: ['webhook-request-inspector'],
    },
    config: {
        security: securityAccess.project(
            [PrincipalType.USER],
            Permission.WRITE_FLOW,
            {
                type: ProjectResourceType.TABLE,
                tableName: WebhookRequestCaptureEntity,
            },
        ),
    },
}

const GetRetentionRequest = {
    config: {
        security: securityAccess.project(
            [PrincipalType.USER],
            Permission.READ_RUN,
            { type: ProjectResourceType.QUERY },
        ),
    },
}
