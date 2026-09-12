import { QueryRunner } from 'typeorm'
import { Migration } from '../../migration'

export class AddReplayOfRunIdToFlowRun1842000000000 implements Migration {
    name = 'AddReplayOfRunIdToFlowRun1842000000000'
    breaking = false
    release = '0.91.0'
    transaction = true

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "flow_run" ADD COLUMN IF NOT EXISTS "replayOfRunId" character varying
        `)
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "idx_run_replay_of_run_id" ON "flow_run" ("replayOfRunId")
        `)
    }

    public down(queryRunner: QueryRunner): Promise<void> {
        return queryRunner.query(`
            ALTER TABLE "flow_run" DROP COLUMN IF EXISTS "replayOfRunId"
        `)
    }
}
