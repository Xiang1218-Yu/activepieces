import { QueryRunner } from 'typeorm'
import { Migration } from '../../migration'

export class AddAgentEvalWorkbench1842000000000 implements Migration {
    name = 'AddAgentEvalWorkbench1842000000000'
    breaking = false
    release = '0.91.0'
    transaction = true

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "agent_eval_suite" (
                "id" character varying(21) NOT NULL,
                "created" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "projectId" character varying(21) NOT NULL,
                "agentId" character varying(21) NOT NULL,
                "name" character varying NOT NULL,
                "description" character varying,
                "variableNames" jsonb NOT NULL DEFAULT '[]',
                CONSTRAINT "pk_agent_eval_suite" PRIMARY KEY ("id")
            )
        `)
        await queryRunner.query(`
            CREATE INDEX "idx_agent_eval_suite_agent" ON "agent_eval_suite" ("agentId")
        `)
        await queryRunner.query(`
            CREATE INDEX "idx_agent_eval_suite_project" ON "agent_eval_suite" ("projectId")
        `)

        await queryRunner.query(`
            CREATE TABLE "agent_eval_case" (
                "id" character varying(21) NOT NULL,
                "created" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "suiteId" character varying(21) NOT NULL,
                "name" character varying NOT NULL,
                "messageTemplate" text NOT NULL,
                "variables" jsonb NOT NULL DEFAULT '{}',
                "expectedOutput" text,
                "sortOrder" integer NOT NULL DEFAULT 0,
                CONSTRAINT "pk_agent_eval_case" PRIMARY KEY ("id")
            )
        `)
        await queryRunner.query(`
            CREATE INDEX "idx_agent_eval_case_suite" ON "agent_eval_case" ("suiteId", "sortOrder")
        `)

        await queryRunner.query(`
            CREATE TABLE "agent_eval_run" (
                "id" character varying(21) NOT NULL,
                "created" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "projectId" character varying(21) NOT NULL,
                "suiteId" character varying(21) NOT NULL,
                "agentId" character varying(21) NOT NULL,
                "createdByUserId" character varying(21) NOT NULL,
                "agentVersion" character varying NOT NULL,
                "modelName" character varying,
                "toolExecution" character varying NOT NULL,
                "status" character varying NOT NULL,
                "maxConcurrency" integer NOT NULL,
                "maxCostCredits" double precision,
                "caseTimeoutMs" integer NOT NULL,
                "totals" jsonb NOT NULL,
                "error" text,
                "startedAt" TIMESTAMP WITH TIME ZONE,
                "finishedAt" TIMESTAMP WITH TIME ZONE,
                CONSTRAINT "pk_agent_eval_run" PRIMARY KEY ("id")
            )
        `)
        await queryRunner.query(`
            CREATE INDEX "idx_agent_eval_run_suite_created" ON "agent_eval_run" ("suiteId", "created")
        `)
        await queryRunner.query(`
            CREATE INDEX "idx_agent_eval_run_project_created" ON "agent_eval_run" ("projectId", "created")
        `)

        await queryRunner.query(`
            CREATE TABLE "agent_eval_case_result" (
                "id" character varying(21) NOT NULL,
                "created" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "runId" character varying(21) NOT NULL,
                "caseId" character varying(21) NOT NULL,
                "caseName" character varying NOT NULL,
                "status" character varying NOT NULL,
                "renderedMessage" text NOT NULL,
                "toolCalls" jsonb NOT NULL DEFAULT '[]',
                "creditsUsed" double precision NOT NULL DEFAULT 0,
                "output" text,
                "error" text,
                "durationMs" integer,
                "conversationId" character varying,
                "startedAt" TIMESTAMP WITH TIME ZONE,
                "finishedAt" TIMESTAMP WITH TIME ZONE,
                CONSTRAINT "pk_agent_eval_case_result" PRIMARY KEY ("id")
            )
        `)
        await queryRunner.query(`
            CREATE INDEX "idx_agent_eval_case_result_run" ON "agent_eval_case_result" ("runId", "status")
        `)

        await queryRunner.query(`
            ALTER TABLE "agent_eval_suite"
            ADD CONSTRAINT "fk_agent_eval_suite_project_id" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `)
        await queryRunner.query(`
            ALTER TABLE "agent_eval_suite"
            ADD CONSTRAINT "fk_agent_eval_suite_agent_id" FOREIGN KEY ("agentId") REFERENCES "agent"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `)
        await queryRunner.query(`
            ALTER TABLE "agent_eval_case"
            ADD CONSTRAINT "fk_agent_eval_case_suite_id" FOREIGN KEY ("suiteId") REFERENCES "agent_eval_suite"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `)
        await queryRunner.query(`
            ALTER TABLE "agent_eval_run"
            ADD CONSTRAINT "fk_agent_eval_run_project_id" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `)
        await queryRunner.query(`
            ALTER TABLE "agent_eval_run"
            ADD CONSTRAINT "fk_agent_eval_run_suite_id" FOREIGN KEY ("suiteId") REFERENCES "agent_eval_suite"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `)
        await queryRunner.query(`
            ALTER TABLE "agent_eval_run"
            ADD CONSTRAINT "fk_agent_eval_run_agent_id" FOREIGN KEY ("agentId") REFERENCES "agent"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `)
        await queryRunner.query(`
            ALTER TABLE "agent_eval_case_result"
            ADD CONSTRAINT "fk_agent_eval_case_result_run_id" FOREIGN KEY ("runId") REFERENCES "agent_eval_run"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `)
        await queryRunner.query(`
            ALTER TABLE "agent_eval_case_result"
            ADD CONSTRAINT "fk_agent_eval_case_result_case_id" FOREIGN KEY ("caseId") REFERENCES "agent_eval_case"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('DROP TABLE IF EXISTS "agent_eval_case_result" CASCADE')
        await queryRunner.query('DROP TABLE IF EXISTS "agent_eval_run" CASCADE')
        await queryRunner.query('DROP TABLE IF EXISTS "agent_eval_case" CASCADE')
        await queryRunner.query('DROP TABLE IF EXISTS "agent_eval_suite" CASCADE')
    }
}
