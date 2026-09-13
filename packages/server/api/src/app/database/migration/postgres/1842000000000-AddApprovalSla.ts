import { QueryRunner } from 'typeorm'
import { Migration } from '../../migration'

export class AddApprovalSla1842000000000 implements Migration {
    name = 'AddApprovalSla1842000000000'
    breaking = false
    release = '0.91.0'
    transaction = true

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "approval_sla_policy" (
                "id" character varying(21) NOT NULL,
                "created" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "projectId" character varying(21) NOT NULL,
                "platformId" character varying(21) NOT NULL,
                "timezone" character varying(64) NOT NULL DEFAULT 'Etc/UTC',
                "rules" jsonb NOT NULL,
                CONSTRAINT "pk_approval_sla_policy" PRIMARY KEY ("id"),
                CONSTRAINT "fk_approval_sla_policy_project_id" FOREIGN KEY ("projectId")
                    REFERENCES "project" ("id") ON DELETE CASCADE
            )
        `)

        await queryRunner.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS "idx_approval_sla_policy_project_id"
            ON "approval_sla_policy" ("projectId")
        `)

        await queryRunner.query(`
            ALTER TABLE "flow_approval_request"
            ADD COLUMN IF NOT EXISTS "priority" character varying NOT NULL DEFAULT 'NORMAL'
        `)
        await queryRunner.query(`
            ALTER TABLE "flow_approval_request"
            ADD COLUMN IF NOT EXISTS "slaDeadlineAt" timestamp with time zone
        `)
        await queryRunner.query(`
            ALTER TABLE "flow_approval_request"
            ADD COLUMN IF NOT EXISTS "pausedAt" timestamp with time zone
        `)
        await queryRunner.query(`
            ALTER TABLE "flow_approval_request"
            ADD COLUMN IF NOT EXISTS "pauseReason" character varying
        `)
        await queryRunner.query(`
            ALTER TABLE "flow_approval_request"
            ADD COLUMN IF NOT EXISTS "escalatedAt" timestamp with time zone
        `)
        await queryRunner.query(`
            ALTER TABLE "flow_approval_request"
            ADD COLUMN IF NOT EXISTS "slaBreachReason" character varying
        `)

        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "idx_flow_approval_request_sla_due"
            ON "flow_approval_request" ("slaDeadlineAt")
            WHERE "state" = 'PENDING' AND "pausedAt" IS NULL
        `)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('DROP INDEX IF EXISTS "idx_flow_approval_request_sla_due"')
        await queryRunner.query('ALTER TABLE "flow_approval_request" DROP COLUMN IF EXISTS "slaBreachReason"')
        await queryRunner.query('ALTER TABLE "flow_approval_request" DROP COLUMN IF EXISTS "escalatedAt"')
        await queryRunner.query('ALTER TABLE "flow_approval_request" DROP COLUMN IF EXISTS "pauseReason"')
        await queryRunner.query('ALTER TABLE "flow_approval_request" DROP COLUMN IF EXISTS "pausedAt"')
        await queryRunner.query('ALTER TABLE "flow_approval_request" DROP COLUMN IF EXISTS "slaDeadlineAt"')
        await queryRunner.query('ALTER TABLE "flow_approval_request" DROP COLUMN IF EXISTS "priority"')
        await queryRunner.query('DROP TABLE IF EXISTS "approval_sla_policy"')
    }
}
