import { QueryRunner } from 'typeorm'
import { Migration } from '../../migration'

export class AddAuditLogExport1842000000000 implements Migration {
    name = 'AddAuditLogExport1842000000000'
    breaking = false

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "audit_log_export" (
                "id" character varying(21) NOT NULL,
                "created" timestamp with time zone NOT NULL DEFAULT now(),
                "updated" timestamp with time zone NOT NULL DEFAULT now(),
                "platformId" character varying(21) NOT NULL,
                "requestedById" character varying(21),
                "format" character varying NOT NULL DEFAULT 'csv',
                "status" character varying NOT NULL DEFAULT 'PENDING',
                "fileId" character varying,
                "fileName" character varying,
                "filters" jsonb,
                "eventCount" integer NOT NULL DEFAULT 0,
                "attempts" integer NOT NULL DEFAULT 0,
                "errorMessage" character varying,
                "completedAt" timestamp with time zone,
                CONSTRAINT "pk_audit_log_export" PRIMARY KEY ("id"),
                CONSTRAINT "fk_audit_log_export_platform_id" FOREIGN KEY ("platformId")
                    REFERENCES "platform" ("id") ON DELETE CASCADE
            )
        `)

        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "idx_audit_log_export_platform_id_created"
                ON "audit_log_export" ("platformId", "created")
        `)

        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "idx_audit_log_export_status"
                ON "audit_log_export" ("status")
        `)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('DROP TABLE IF EXISTS "audit_log_export"')
    }
}
