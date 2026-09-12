import { QueryRunner } from 'typeorm'
import { Migration } from '../../migration'

export class AddRunRetentionPolicy1842000000000 implements Migration {
    name = 'AddRunRetentionPolicy1842000000000'
    breaking = false
    release = '0.91.0'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "run_retention_policy" (
                "id" character varying(21) NOT NULL,
                "created" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "platformId" character varying(21) NOT NULL,
                "projectId" character varying(21),
                "retentionDays" integer NOT NULL,
                "statuses" text[] NOT NULL,
                "includeArchived" boolean NOT NULL DEFAULT true,
                CONSTRAINT "pk_run_retention_policy" PRIMARY KEY ("id")
            )
        `)
        await queryRunner.query(`
            CREATE UNIQUE INDEX "idx_run_retention_policy_platform_default"
            ON "run_retention_policy" ("platformId")
            WHERE "projectId" IS NULL
        `)
        await queryRunner.query(`
            CREATE UNIQUE INDEX "idx_run_retention_policy_project"
            ON "run_retention_policy" ("projectId")
            WHERE "projectId" IS NOT NULL
        `)
        await queryRunner.query(`
            ALTER TABLE "run_retention_policy"
            ADD CONSTRAINT "fk_run_retention_policy_platform_id" FOREIGN KEY ("platformId") REFERENCES "platform"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `)
        await queryRunner.query(`
            ALTER TABLE "run_retention_policy"
            ADD CONSTRAINT "fk_run_retention_policy_project_id" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('DROP TABLE IF EXISTS "run_retention_policy"')
    }
}
