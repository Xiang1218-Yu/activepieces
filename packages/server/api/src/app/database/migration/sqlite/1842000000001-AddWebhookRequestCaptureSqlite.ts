import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddWebhookRequestCaptureSqlite1842000000001 implements MigrationInterface {
    name = 'AddWebhookRequestCaptureSqlite1842000000001'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "webhook_request_capture" (
                "id" varchar(21) PRIMARY KEY NOT NULL,
                "created" datetime NOT NULL DEFAULT (datetime('now')),
                "updated" datetime NOT NULL DEFAULT (datetime('now')),
                "projectId" varchar(21) NOT NULL,
                "platformId" varchar(21) NOT NULL,
                "flowId" varchar(21) NOT NULL,
                "requestId" varchar(21) NOT NULL,
                "method" varchar(10) NOT NULL,
                "path" varchar NOT NULL,
                "headers" text NOT NULL,
                "maskedHeaders" text NOT NULL DEFAULT '[]',
                "queryParams" text NOT NULL,
                "body" text NOT NULL,
                "clientIpPrefix" varchar,
                "responseStatus" integer,
                "environment" varchar NOT NULL,
                "testInput" text
            )
        `)
        await queryRunner.query(`
            CREATE INDEX "idx_webhook_capture_project_created" ON "webhook_request_capture" ("projectId", "created")
        `)
        await queryRunner.query(`
            CREATE INDEX "idx_webhook_capture_project_flow_created" ON "webhook_request_capture" ("projectId", "flowId", "created")
        `)
        await queryRunner.query(`
            CREATE INDEX "idx_webhook_capture_project_request" ON "webhook_request_capture" ("projectId", "requestId")
        `)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "idx_webhook_capture_project_request"`)
        await queryRunner.query(`DROP INDEX "idx_webhook_capture_project_flow_created"`)
        await queryRunner.query(`DROP INDEX "idx_webhook_capture_project_created"`)
        await queryRunner.query(`DROP TABLE "webhook_request_capture"`)
    }
}
