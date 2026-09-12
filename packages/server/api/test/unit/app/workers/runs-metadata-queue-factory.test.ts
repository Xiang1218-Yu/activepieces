import { FlowRunStatus, RunEnvironment } from '@activepieces/shared'
import { describe, expect, it } from 'vitest'
import { redisMetadataKey, stripToRunsMetadataUpsertData, RunsMetadataUpsertData } from '../../../../../src/app/workers/job/runs-metadata-queue-factory'

describe('runs metadata upsert whitelist', () => {
    it('keeps replayOfRunId when the worker reports replay run metadata', () => {
        const params: RunsMetadataUpsertData = {
            id: 'run-1',
            projectId: 'proj-1',
            status: FlowRunStatus.SUCCEEDED,
            environment: RunEnvironment.TESTING,
            replayOfRunId: 'source-run-00000000001',
        }

        const stripped = stripToRunsMetadataUpsertData(params)

        expect(stripped.replayOfRunId).toBe('source-run-00000000001')
    })

    it('drops unknown fields so the Redis merge cannot smuggle columns', () => {
        const params = {
            id: 'run-1',
            projectId: 'proj-1',
            status: FlowRunStatus.QUEUED,
            environment: RunEnvironment.PRODUCTION,
            injectedColumn: 'nope',
        } as RunsMetadataUpsertData

        const stripped = stripToRunsMetadataUpsertData(params)

        expect(stripped).not.toHaveProperty('injectedColumn')
        expect(stripped.id).toBe('run-1')
        expect(stripped.status).toBe(FlowRunStatus.QUEUED)
    })

    it('uses a per-run metadata key', () => {
        expect(redisMetadataKey('run-1')).toBe('runs_metadata:run-1')
    })
})
