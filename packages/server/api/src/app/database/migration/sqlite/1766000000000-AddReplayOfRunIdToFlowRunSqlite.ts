import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddReplayOfRunIdToFlowRunSqlite1766000000000 implements MigrationInterface {
    name = 'AddReplayOfRunIdToFlowRunSqlite1766000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "flow_run" ADD COLUMN "replayOfRunId" varchar
        `)
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "idx_run_replay_of_run_id" ON "flow_run" ("replayOfRunId")
        `)
    }

    public async down(): Promise<void> {
        // SQLite cannot drop a column on deprecated 3.x databases; the column is nullable and inert.
    }
}
