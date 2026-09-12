import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddFailureRouting1842000000000 implements MigrationInterface {
    name = 'AddFailureRouting1842000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "failure_routing_rule" (
                "id" character varying(21) NOT NULL,
                "created" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "platformId" character varying(21) NOT NULL,
                "projectId" character varying(21) NOT NULL,
                "displayName" character varying NOT NULL,
                "enabled" boolean NOT NULL DEFAULT true,
                "priority" integer NOT NULL DEFAULT 100,
                "stopOnMatch" boolean NOT NULL DEFAULT false,
                "filter" jsonb NOT NULL,
                "target" jsonb NOT NULL,
                "lastDelivery" jsonb,
                CONSTRAINT "pk_failure_routing_rule_id" PRIMARY KEY ("id")
            )
        `)
        await queryRunner.query(`
            CREATE INDEX "idx_failure_routing_rule_project_priority"
            ON "failure_routing_rule" ("projectId", "priority", "created")
        `)

        await queryRunner.query(`
            CREATE TABLE "failure_delivery" (
                "id" character varying(21) NOT NULL,
                "created" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "platformId" character varying(21) NOT NULL,
                "projectId" character varying(21) NOT NULL,
                "ruleId" character varying(21) NOT NULL,
                "flowRunId" character varying(21) NOT NULL,
                "flowId" character varying(21) NOT NULL,
                "retryCount" integer NOT NULL DEFAULT 0,
                "category" character varying NOT NULL,
                "targetType" character varying NOT NULL,
                "status" character varying NOT NULL,
                "errorMessage" character varying,
                "attempts" integer NOT NULL DEFAULT 0,
                "deliveredAt" character varying,
                CONSTRAINT "pk_failure_delivery_id" PRIMARY KEY ("id")
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

        await queryRunner.query(`
            ALTER TABLE "failure_routing_rule"
            ADD CONSTRAINT "fk_failure_routing_rule_platform"
            FOREIGN KEY ("platformId") REFERENCES "platform"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `)
        await queryRunner.query(`
            ALTER TABLE "failure_routing_rule"
            ADD CONSTRAINT "fk_failure_routing_rule_project"
            FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `)
        await queryRunner.query(`
            ALTER TABLE "failure_delivery"
            ADD CONSTRAINT "fk_failure_delivery_platform"
            FOREIGN KEY ("platformId") REFERENCES "platform"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `)
        await queryRunner.query(`
            ALTER TABLE "failure_delivery"
            ADD CONSTRAINT "fk_failure_delivery_project"
            FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `)
        await queryRunner.query(`
            ALTER TABLE "failure_delivery"
            ADD CONSTRAINT "fk_failure_delivery_rule"
            FOREIGN KEY ("ruleId") REFERENCES "failure_routing_rule"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "failure_delivery" DROP CONSTRAINT "fk_failure_delivery_rule"`)
        await queryRunner.query(`ALTER TABLE "failure_delivery" DROP CONSTRAINT "fk_failure_delivery_project"`)
        await queryRunner.query(`ALTER TABLE "failure_delivery" DROP CONSTRAINT "fk_failure_delivery_platform"`)
        await queryRunner.query(`ALTER TABLE "failure_routing_rule" DROP CONSTRAINT "fk_failure_routing_rule_project"`)
        await queryRunner.query(`ALTER TABLE "failure_routing_rule" DROP CONSTRAINT "fk_failure_routing_rule_platform"`)
        await queryRunner.query(`DROP TABLE "failure_delivery"`)
        await queryRunner.query(`DROP TABLE "failure_routing_rule"`)
    }
}
