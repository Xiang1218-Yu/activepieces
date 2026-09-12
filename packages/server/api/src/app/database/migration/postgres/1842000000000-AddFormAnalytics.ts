import { QueryRunner } from 'typeorm'
import { Migration } from '../../migration'

export class AddFormAnalytics1842000000000 implements Migration {
    name = 'AddFormAnalytics1842000000000'
    breaking = false
    release = '0.92.0'
    transaction = true

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "form_session" (
                "id" character varying(21) NOT NULL,
                "created" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "projectId" character varying(21) NOT NULL,
                "flowId" character varying(21) NOT NULL,
                "flowVersionId" character varying(21),
                "visitorKey" character varying(64) NOT NULL,
                "attribution" character varying NOT NULL,
                "userId" character varying(21),
                "status" character varying NOT NULL,
                "runId" character varying(21),
                "useDraft" boolean NOT NULL DEFAULT false,
                "lastEventAt" TIMESTAMP WITH TIME ZONE NOT NULL,
                CONSTRAINT "pk_form_session" PRIMARY KEY ("id")
            )
        `)

        await queryRunner.query(`
            CREATE INDEX "idx_form_session_flow_visitor" ON "form_session" ("flowId", "visitorKey")
        `)
        await queryRunner.query(`
            CREATE INDEX "idx_form_session_project_created" ON "form_session" ("projectId", "created")
        `)
        await queryRunner.query(`
            CREATE INDEX "idx_form_session_run_id" ON "form_session" ("runId")
        `)
        await queryRunner.query(`
            CREATE INDEX "idx_form_session_flow_created" ON "form_session" ("flowId", "created")
        `)

        await queryRunner.query(`
            ALTER TABLE "form_session"
            ADD CONSTRAINT "fk_form_session_project_id" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `)
        await queryRunner.query(`
            ALTER TABLE "form_session"
            ADD CONSTRAINT "fk_form_session_flow_id" FOREIGN KEY ("flowId") REFERENCES "flow"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `)
        await queryRunner.query(`
            ALTER TABLE "form_session"
            ADD CONSTRAINT "fk_form_session_run_id" FOREIGN KEY ("runId") REFERENCES "flow_run"("id") ON DELETE SET NULL ON UPDATE NO ACTION
        `)

        await queryRunner.query(`
            CREATE TABLE "form_field_interaction" (
                "id" character varying(21) NOT NULL,
                "created" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "projectId" character varying(21) NOT NULL,
                "flowId" character varying(21) NOT NULL,
                "flowVersionId" character varying(21),
                "sessionId" character varying(21) NOT NULL,
                "fieldName" character varying(200) NOT NULL,
                "fieldLabel" character varying(200) NOT NULL,
                "reached" boolean NOT NULL DEFAULT true,
                "interacted" boolean NOT NULL DEFAULT false,
                "attribution" character varying NOT NULL,
                CONSTRAINT "pk_form_field_interaction" PRIMARY KEY ("id")
            )
        `)

        await queryRunner.query(`
            CREATE INDEX "idx_form_field_interaction_session_field" ON "form_field_interaction" ("sessionId", "fieldName")
        `)
        await queryRunner.query(`
            CREATE INDEX "idx_form_field_interaction_project_created" ON "form_field_interaction" ("projectId", "created")
        `)
        await queryRunner.query(`
            CREATE INDEX "idx_form_field_interaction_flow_created" ON "form_field_interaction" ("flowId", "created")
        `)

        await queryRunner.query(`
            ALTER TABLE "form_field_interaction"
            ADD CONSTRAINT "fk_form_field_interaction_project_id" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `)
        await queryRunner.query(`
            ALTER TABLE "form_field_interaction"
            ADD CONSTRAINT "fk_form_field_interaction_flow_id" FOREIGN KEY ("flowId") REFERENCES "flow"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('DROP TABLE IF EXISTS "form_field_interaction" CASCADE')
        await queryRunner.query('DROP TABLE IF EXISTS "form_session" CASCADE')
    }
}
