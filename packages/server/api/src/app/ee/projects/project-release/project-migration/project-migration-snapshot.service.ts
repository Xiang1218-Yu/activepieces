import { gunzipSync, gzipSync } from 'node:zlib'

import { ActivepiecesError, ErrorCode, isNil } from '@activepieces/core-utils'
import { ProjectMigrationSnapshot } from '@activepieces/shared'
import { encryptUtils } from '../../../../helper/encryption'

const TOKEN_PREFIX = 'apm1.'
const SIGNATURE_PARTS_SEPARATOR = '.'
const MAX_TOKEN_BYTES = 16 * 1024 * 1024

export const projectMigrationSnapshotService = {
    async encode({ snapshot }: { snapshot: ProjectMigrationSnapshot }): Promise<string> {
        const payload = Buffer.from(JSON.stringify(snapshot), 'utf-8')
        const compressed = gzipSync(payload)
        const encodedPayload = compressed.toString('base64url')
        const signature = await signPayload(encodedPayload)
        return `${TOKEN_PREFIX}${encodedPayload}${SIGNATURE_PARTS_SEPARATOR}${signature}`
    },
    async decode({ token, expectedTargetProjectId }: DecodeParams): Promise<ProjectMigrationSnapshot> {
        if (isNil(token) || !token.startsWith(TOKEN_PREFIX)) {
            throw invalidSnapshotError()
        }
        const tokenBody = token.slice(TOKEN_PREFIX.length)
        const separatorIndex = tokenBody.lastIndexOf(SIGNATURE_PARTS_SEPARATOR)
        if (separatorIndex === -1) {
            throw invalidSnapshotError()
        }
        const encodedPayload = tokenBody.slice(0, separatorIndex)
        const signature = tokenBody.slice(separatorIndex + 1)
        if (Buffer.byteLength(encodedPayload, 'utf-8') > MAX_TOKEN_BYTES) {
            throw invalidSnapshotError()
        }
        const expectedSignature = await signPayload(encodedPayload)
        if (!encryptUtils.digestsMatch(signature, expectedSignature)) {
            throw invalidSnapshotError()
        }

        let parsed: unknown
        try {
            const decompressed = gunzipSync(Buffer.from(encodedPayload, 'base64url'))
            parsed = JSON.parse(decompressed.toString('utf-8'))
        }
        catch {
            throw invalidSnapshotError()
        }
        const snapshot = ProjectMigrationSnapshot.safeParse(parsed)
        if (!snapshot.success) {
            throw invalidSnapshotError()
        }
        if (!isNil(expectedTargetProjectId) && snapshot.data.targetProjectId !== expectedTargetProjectId) {
            throw new ActivepiecesError({
                code: ErrorCode.VALIDATION,
                params: {
                    message: 'The precheck snapshot was generated for a different target project. Run the precheck again.',
                },
            })
        }
        return snapshot.data
    },
}

async function signPayload(encodedPayload: string): Promise<string> {
    return encryptUtils.hmacString(encodedPayload)
}

function invalidSnapshotError(): ActivepiecesError {
    return new ActivepiecesError({
        code: ErrorCode.VALIDATION,
        params: {
            message: 'The precheck snapshot is invalid or was generated for a different project. Run the precheck again.',
        },
    })
}

type DecodeParams = {
    token: string | null | undefined
    expectedTargetProjectId?: string
}
