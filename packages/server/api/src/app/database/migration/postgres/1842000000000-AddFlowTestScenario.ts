import { QueryRunner } from 'typeorm'
import { Migration } from '../../migration'

export class AddFlowTestScenario1842000000000 implements Migration {
    name = 'AddFlowTestScenario1842000000000'
    breaking = false
    release = '0.91.0'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "flow_test_scenario" (
                "id" character varying(21) NOT NULL,
                "created" timestamp with time zone NOT NULL DEFAULT now(),
                "updated" timestamp with time zone NOT NULL DEFAULT now(),
                "projectId" character varying(21) NOT NULL,
                "flowId" character varying(21) NOT NULL,
                "flowVersionId" character varying(21) NOT NULL,
                "name" character varying NOT NULL,
                "description" character varying,
                "triggerInput" jsonb,
                "inputFileIds" character varying[] NOT NULL,
                "expectedOutputs" jsonb NOT NULL,
                "allowedDynamicFields" character varying[] NOT NULL,
                "connectionStrategy" character varying NOT NULL,
                "connectionMocks" jsonb NOT NULL,
                "versionSnapshot" jsonb NOT NULL,
                CONSTRAINT "pk_flow_test_scenario" PRIMARY KEY ("id"),
                CONSTRAINT "fk_flow_test_scenario_flow" FOREIGN KEY ("flowId")
                    REFERENCES "flow" ("id") ON DELETE CASCADE,
                CONSTRAINT "fk_flow_test_scenario_flow_version" FOREIGN KEY ("flowVersionId")
                    REFERENCES "flow_version" ("id") ON DELETE CASCADE,
                CONSTRAINT "fk_flow_test_scenario_project" FOREIGN KEY ("projectId")
                    REFERENCES "project" ("id") ON DELETE CASCADE
            )
        `)

        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "idx_flow_test_scenario_flow_id"
            ON "flow_test_scenario" ("flowId")
        `)

        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "idx_flow_test_scenario_flow_version_id"
            ON "flow_test_scenario" ("flowVersionId")
        `)

        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "idx_flow_test_scenario_project_id"
            ON "flow_test_scenario" ("projectId")
        `)

        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "flow_test_scenario_run" (
                "id" character varying(21) NOT NULL,
                "created" timestamp with time zone NOT NULL DEFAULT now(),
                "updated" timestamp with time zone NOT NULL DEFAULT now(),
                "projectId" character varying(21) NOT NULL,
                "scenarioId" character varying(21) NOT NULL,
                "flowId" character varying(21) NOT NULL,
                "flowVersionId" character varying(21) NOT NULL,
                "flowRunId" character varying(21),
                "status" character varying NOT NULL,
                "failureReason" character varying,
                "diffReport" jsonb,
                "triggeredBy" character varying,
                CONSTRAINT "pk_flow_test_scenario_run" PRIMARY KEY ("id"),
                CONSTRAINT "fk_flow_test_scenario_run_scenario" FOREIGN KEY ("scenarioId")
                    REFERENCES "flow_test_scenario" ("id") ON DELETE CASCADE
            )
        `)

        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "idx_flow_test_scenario_run_scenario_id"
            ON "flow_test_scenario_run" ("scenarioId", "created")
        `)

        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "idx_flow_test_scenario_run_flow_run_id"
            ON "flow_test_scenario_run" ("flowRunId")
        `)

        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "idx_flow_test_scenario_run_project_id"
            ON "flow_test_scenario_run" ("projectId")
        `)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('DROP TABLE IF EXISTS "flow_test_scenario_run"')
        await queryRunner.query('DROP TABLE IF EXISTS "flow_test_scenario"')
    }
}
