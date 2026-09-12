import { projectMigrationSnapshotService } from '../../../../../../../src/app/ee/projects/project-release/project-migration/project-migration-snapshot.service'

describe('Project Migration Snapshot Service', () => {
    const snapshot = {
        sourceProjectId: 'source-project',
        targetProjectId: 'target-project',
        generatedAt: '2026-01-01T00:00:00.000Z',
        sourceState: { flows: [], tables: [], folders: [], connections: [] },
        targetState: { flows: [], tables: [], folders: [], connections: [] },
    }

    it('should encode and decode a snapshot roundtrip', () => {
        const token = projectMigrationSnapshotService.encode({ snapshot })
        const decoded = projectMigrationSnapshotService.decode({ token })
        expect(decoded).toEqual(snapshot)
    })

    it('should reject tokens that do not target the expected project', () => {
        const token = projectMigrationSnapshotService.encode({ snapshot })
        expect(() => projectMigrationSnapshotService.decode({
            token,
            expectedTargetProjectId: 'another-project',
        })).toThrow()
    })

    it('should reject tampered tokens', () => {
        const token = projectMigrationSnapshotService.encode({ snapshot })
        const payload = token.slice('apm1.'.length)
        const middle = Math.floor(payload.length / 2)
        const tampered = `apm1.${payload.slice(0, middle)}${payload[middle] === 'A' ? 'B' : 'A'}${payload.slice(middle + 1)}`
        expect(() => projectMigrationSnapshotService.decode({ token: tampered })).toThrow()
    })

    it('should reject tokens without prefix', () => {
        expect(() => projectMigrationSnapshotService.decode({ token: 'not-a-token' })).toThrow()
    })
})
