import { QueryRunner } from 'typeorm'
import { Migration } from '../../migration'

export class AddWebhookRequestCapture1842000000000 implements Migration {
    name = 'AddWebhookRequestCapture1842000000000'
    breaking = false
    transaction = true

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "webhook_request_capture" (
                "id" character varying(21) NOT NULL,
                "created" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "projectId" character varying(21) NOT NULL,
                "platformId" character varying(21) NOT NULL,
                "flowId" character varying(21) NOT NULL,
                "requestId" character varying(21) NOT NULL,
                "method" character varying(10) NOT NULL,
                "path" character varying NOT NULL,
                "headers" jsonb NOT NULL,
                "maskedHeaders" jsonb NOT NULL DEFAULT '[]',
                "queryParams" jsonb NOT NULL,
                "body" jsonb NOT NULL,
                "clientIpPrefix" character varying,
                "responseStatus" integer,
                "environment" character varying NOT NULL,
                "testInput" jsonb,
                CONSTRAINT "PK_webhook_request_capture" PRIMARY KEY ("id")
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
