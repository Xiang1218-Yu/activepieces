import { CheckPieceCompatibilityRequest, PieceCompatibilityReport, PrincipalType } from '@activepieces/shared'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { securityAccess } from '../../core/security/authorization/fastify-security'
import { pieceCompatibilityService } from './piece-compatibility.service'

export const pieceCompatibilityModule: FastifyPluginAsyncZod = async (app) => {
    await app.register(pieceCompatibilityController, { prefix: '/v1/piece-compatibility' })
}

const pieceCompatibilityController: FastifyPluginAsyncZod = async (app) => {
    app.post('/check', CheckRequest, async (req): Promise<PieceCompatibilityReport> => {
        return pieceCompatibilityService(req.log).check({
            platformId: req.principal.platform.id,
            request: req.body,
        })
    })
}

const CheckRequest = {
    config: {
        security: securityAccess.platformAdminOnly([PrincipalType.USER, PrincipalType.SERVICE]),
    },
    schema: {
        tags: ['piece-compatibility'],
        description: 'Checks whether flow versions configured against one piece version are still accepted by another version. Reports per-step incompatibilities, re-authorization needs and display-only changes without exposing connection secrets.',
        body: CheckPieceCompatibilityRequest,
    },
}
