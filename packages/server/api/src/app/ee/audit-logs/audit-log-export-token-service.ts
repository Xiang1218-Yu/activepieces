import { ActivepiecesError, apId, ErrorCode, isNil } from '@activepieces/core-utils'
import dayjs from 'dayjs'
import { FastifyBaseLogger } from 'fastify'
import { redisConnections } from '../../database/redis-connections'
import { JwtAudience, JwtSignAlgorithm, jwtUtils } from '../../helper/jwt-utils'

const TOKEN_TTL_SECONDS = 900

type DownloadTokenClaims = {
    exportId: string
    platformId: string
    fileId: string
    jti: string
}

export const auditLogExportTokenService = (log: FastifyBaseLogger) => ({
    async issueToken(params: { exportId: string, platformId: string, fileId: string }): Promise<{ token: string, expiresAt: string }> {
        const token = await jwtUtils.sign({
            payload: {
                exportId: params.exportId,
                platformId: params.platformId,
                fileId: params.fileId,
                jti: apId(),
            },
            key: await jwtUtils.getJwtSecret(),
            algorithm: JwtSignAlgorithm.HS256,
            expiresInSeconds: TOKEN_TTL_SECONDS,
            audience: JwtAudience.AUDIT_LOG_EXPORT_DOWNLOAD,
        })
        return {
            token,
            expiresAt: dayjs().add(TOKEN_TTL_SECONDS, 'seconds').toISOString(),
        }
    },
    async redeemToken(token: string): Promise<DownloadTokenClaims> {
        let claims: DownloadTokenClaims
        try {
            claims = await jwtUtils.decodeAndVerify<DownloadTokenClaims>({
                jwt: token,
                key: await jwtUtils.getJwtSecret(),
                algorithm: JwtSignAlgorithm.HS256,
                audience: JwtAudience.AUDIT_LOG_EXPORT_DOWNLOAD,
            })
        }
        catch {
            throw new ActivepiecesError({
                code: ErrorCode.INVALID_BEARER_TOKEN,
                params: { message: 'invalid or expired audit log export token' },
            })
        }

        if (isNil(claims.exportId) || isNil(claims.platformId) || isNil(claims.fileId) || isNil(claims.jti)) {
            throw new ActivepiecesError({
                code: ErrorCode.INVALID_BEARER_TOKEN,
                params: { message: 'malformed audit log export token' },
            })
        }

        const redis = await redisConnections.useExisting()
        const redemptionKey = `audit-log-export:downloaded:${claims.jti}`
        const firstUse = await redis.set(redemptionKey, '1', 'EX', TOKEN_TTL_SECONDS, 'NX')
        if (firstUse === null) {
            log.warn({ exportId: claims.exportId }, '[auditLogExportTokenService#redeemToken] reuse of one-time download link rejected')
            throw new ActivepiecesError({
                code: ErrorCode.INVALID_BEARER_TOKEN,
                params: { message: 'This download link has already been used' },
            })
        }
        return claims
    },
})
