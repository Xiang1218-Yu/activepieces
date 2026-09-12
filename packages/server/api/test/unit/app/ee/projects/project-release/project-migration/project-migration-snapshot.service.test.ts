import { projectMigrationSnapshotService } from '../../../../../../../src/app/ee/projects/project-release/project-migration/project-migration-snapshot.service'

describe('Project Migration Snapshot Service', () => {
    const snapshot = {
        sourceProjectId: 'source-project',
        targetProjectId: 'target-project',
        generatedAt: '2026-01-01T00:00:00.000Z',
        sourceState: { flows: [], tables: [], folders: [], connections: [] },
        targetState: { flows: [], tables: [], folders: [], connections: [] },
    }

    it('should encode and decode a signed snapshot roundtrip', async () => {
        const token = await projectMigrationSnapshotService.encode({ snapshot })
        const decoded = await projectMigrationSnapshotService.decode({ token })
        expect(decoded).toEqual(snapshot)
    })

    it('should reject tokens that do not target the expected project', async () => {
        const token = await projectMigrationSnapshotService.encode({ snapshot })
        await expect(projectMigrationSnapshotService.decode({
            token,
            expectedTargetProjectId: 'another-project',
        })).rejects.toThrow()
    })

    it('should reject tokens whose payload was tampered with', async () => {
        const token = await projectMigrationSnapshotService.encode({ snapshot })
        const tokenBody = token.slice('apm1.'.length)
        const separatorIndex = tokenBody.lastIndexOf('.')
        const payload = tokenBody.slice(0, separatorIndex)
        const signature = tokenBody.slice(separatorIndex + 1)
        const middle = Math.floor(payload.length / 2)
        const tamperedPayload = `${payload.slice(0, middle)}${payload[middle] === 'A' ? 'B' : 'A'}${payload.slice(middle + 1)}`
        const tamperedToken = `apm1.${tamperedPayload}.${signature}`
        await expect(projectMigrationSnapshotService.decode({ token: tamperedToken })).rejects.toThrow()
    })

    it('should reject tokens whose signature was tampered with', async () => {
        const token = await projectMigrationSnapshotService.encode({ snapshot })
        const tokenBody = token.slice('apm1.'.length)
        const separatorIndex = tokenBody.lastIndexOf('.')
        const payload = tokenBody.slice(0, separatorIndex)
        const signature = tokenBody.slice(separatorIndex + 1)
        const tamperedSignature = `${signature.slice(0, -2)}${signature.slice(-2) === 'ab' ? 'cd' : 'ab'}`
        await expect(projectMigrationSnapshotService.decode({
            token: `apm1.${payload}.${tamperedSignature}`,
        })).rejects.toThrow()
    })

    it('should reject tokens without prefix', async () => {
        await expect(projectMigrationSnapshotService.decode({ token: 'not-a-token' })).rejects.toThrow()
    })

    it('should reject tokens without a signature', async () => {
        await expect(projectMigrationSnapshotService.decode({ token: 'apm1.payload-without-signature' })).rejects.toThrow()
    })
})
