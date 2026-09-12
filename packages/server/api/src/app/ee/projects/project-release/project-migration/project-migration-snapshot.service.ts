import { gunzipSync, gzipSync } from 'node:zlib'
import { ActivepiecesError, ErrorCode, isNil } from '@activepieces/core-utils'
import {
    ProjectMigrationSnapshot,
} from '@activepieces/shared'

const TOKEN_PREFIX = 'apm1.'
const MAX_TOKEN_BYTES = 16 * 1024 * 1024

export const projectMigrationSnapshotService = {
    encode({ snapshot }: { snapshot: ProjectMigrationSnapshot }): string {
        const payload = JSON.stringify(snapshot)
        const compressed = gzipSync(Buffer.from(payload, 'utf-8'))
        return `${TOKEN_PREFIX}${compressed.toString('base64url')}`
    },
    decode({ token, expectedTargetProjectId }: DecodeParams): ProjectMigrationSnapshot {
        if (isNil(token) || !token.startsWith(TOKEN_PREFIX)) {
            throw invalidSnapshotError()
        }
        const encoded = token.slice(TOKEN_PREFIX.length)
        if (Buffer.byteLength(encoded, 'utf-8') > MAX_TOKEN_BYTES) {
            throw invalidSnapshotError()
        }
        let parsed: unknown
        try {
            const decompressed = gunzipSync(Buffer.from(encoded, 'base64url'))
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
            throw invalidSnapshotError()
        }
        return snapshot.data
    },
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
