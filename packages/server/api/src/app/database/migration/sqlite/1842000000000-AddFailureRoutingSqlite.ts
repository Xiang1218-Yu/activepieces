import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddFailureRoutingSqlite1842000000000 implements MigrationInterface {
    name = 'AddFailureRoutingSqlite1842000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "failure_routing_rule" (
                "id" varchar(21) PRIMARY KEY NOT NULL,
                "created" datetime NOT NULL DEFAULT (datetime('now')),
                "updated" datetime NOT NULL DEFAULT (datetime('now')),
                "platformId" varchar(21) NOT NULL,
                "projectId" varchar(21) NOT NULL,
                "displayName" varchar NOT NULL,
                "enabled" boolean NOT NULL DEFAULT (1),
                "priority" integer NOT NULL DEFAULT 100,
                "stopOnMatch" boolean NOT NULL DEFAULT (0),
                "filter" text NOT NULL,
                "target" text NOT NULL,
                "lastDelivery" text
            )
        `)
        await queryRunner.query(`
            CREATE INDEX "idx_failure_routing_rule_project_priority"
            ON "failure_routing_rule" ("projectId", "priority", "created")
        `)

        await queryRunner.query(`
            CREATE TABLE "failure_delivery" (
                "id" varchar(21) PRIMARY KEY NOT NULL,
                "created" datetime NOT NULL DEFAULT (datetime('now')),
                "updated" datetime NOT NULL DEFAULT (datetime('now')),
                "platformId" varchar(21) NOT NULL,
                "projectId" varchar(21) NOT NULL,
                "ruleId" varchar(21) NOT NULL,
                "flowRunId" varchar(21) NOT NULL,
                "flowId" varchar(21) NOT NULL,
                "retryCount" integer NOT NULL DEFAULT 0,
                "category" varchar NOT NULL,
                "targetType" varchar NOT NULL,
                "status" varchar NOT NULL,
                "errorMessage" varchar,
                "attempts" integer NOT NULL DEFAULT 0,
                "deliveredAt" varchar
            )
        `)
        await queryRunner.query(`
            CREATE UNIQUE INDEX "idx_failure_delivery_run_rule_unique"
            ON "failure_delivery" ("flowRunId", "ruleId")
        `)
        await queryRunner.query(`
            CREATE INDEX "idx_failure_delivery_project_created"
            ON "failure_delivery" ("projectId", "created")
        `)
        await queryRunner.query(`
            CREATE INDEX "idx_failure_delivery_rule"
            ON "failure_delivery" ("ruleId")
        `)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "failure_delivery"`)
        await queryRunner.query(`DROP TABLE "failure_routing_rule"`)
    }
}
