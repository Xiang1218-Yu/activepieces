import { isNil } from '@activepieces/core-utils'
import {
    FORM_SESSION_ID_HEADER,
    FormSessionAttribution,
    FormSessionEvent,
    Principal,
    PrincipalType,
    ResolveFormSessionRunRequestBody,
    StartFormSessionRequestBody,
    StartFormSessionResponse,
    TrackFormFieldInteractionRequestBody,
    TrackFormSessionEventRequestBody,
} from '@activepieces/shared'
import { FastifyRequest } from 'fastify'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { authenticateOrThrow } from '../../../core/security/v2/authn/authenticate'
import { securityAccess } from '../../../core/security/authorization/fastify-security'
import { formAnalyticsService } from './form-analytics.service'

export const formAnalyticsController: FastifyPluginAsyncZod = async (app) => {
    app.post('/sessions', StartSessionRoute, async (request) => {
        const identity = await resolveIdentity(request)
        return formAnalyticsService(request.log).startSession({
            flowId: request.body.flowId,
            visitorKey: getVisitorKey(request),
            useDraft: request.body.useDraft ?? false,
            attribution: identity.attribution,
            userId: identity.userId,
        })
    })

    app.post('/events', TrackEventRoute, async (request, reply) => {
        const identity = await resolveIdentity(request)
        const body = request.body
        await formAnalyticsService(request.log).trackEvent({
            flowId: body.flowId,
            sessionId: body.sessionId,
            event: body.event,
            attribution: identity.attribution,
            userId: identity.userId,
            reachedFields: body.reachedFields,
        })
        return reply.send({})
    })

    app.post('/field-interactions', TrackFieldRoute, async (request, reply) => {
        await formAnalyticsService(request.log).trackFieldInteraction({
            flowId: request.body.flowId,
            sessionId: request.body.sessionId,
            fieldName: request.body.fieldName,
            reachedFieldNames: request.body.reachedFieldNames,
        })
        return reply.send({})
    })

    app.post('/resolve-run', ResolveRunRoute, async (request, reply) => {
        await formAnalyticsService(request.log).linkLatestRun({
            flowId: request.body.flowId,
            sessionId: request.body.sessionId,
            submittedAt: request.body.submittedAt,
        })
        return reply.send({})
    })
}

async function resolveIdentity(request: FastifyRequest): Promise<Identity> {
    const authorization = request.headers.authorization
    if (isNil(authorization)) {
        return { attribution: FormSessionAttribution.ANONYMOUS, userId: null }
    }
    let principal: Principal | null = null
    try {
        principal = await authenticateOrThrow(request.log, authorization)
    }
    catch {
        principal = null
    }
    if (!isNil(principal) && principal.type === PrincipalType.USER) {
        return { attribution: FormSessionAttribution.AUTHENTICATED, userId: principal.id }
    }
    return { attribution: FormSessionAttribution.ANONYMOUS, userId: null }
}

function getVisitorKey(request: FastifyRequest): string {
    const header = request.headers[FORM_SESSION_ID_HEADER]
    if (typeof header === 'string' && header.length > 0 && header.length <= 64) {
        return header
    }
    return request.ip
}

type Identity = {
    attribution: FormSessionAttribution
    userId: string | null
}

const StartSessionRoute = {
    config: {
        security: securityAccess.public(),
    },
    schema: {
        description: 'Start a form analytics session',
        body: StartFormSessionRequestBody,
        response: {
            200: StartFormSessionResponse,
        },
    },
}

const TrackEventRoute = {
    config: {
        security: securityAccess.public(),
    },
    schema: {
        description: 'Track a form session event',
        body: TrackFormSessionEventRequestBody,
    },
}

const TrackFieldRoute = {
    config: {
        security: securityAccess.public(),
    },
    schema: {
        description: 'Track a form field interaction',
        body: TrackFormFieldInteractionRequestBody,
    },
}

const ResolveRunRoute = {
    config: {
        security: securityAccess.public(),
    },
    schema: {
        description: 'Resolve the flow run created by an async form submission',
        body: ResolveFormSessionRunRequestBody,
    },
}
