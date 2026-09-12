import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddFormAnalytics1767000000000 implements MigrationInterface {
    name = 'AddFormAnalytics1767000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "form_session" (
                "id" varchar(21) PRIMARY KEY NOT NULL,
                "created" datetime NOT NULL DEFAULT (datetime('now')),
                "updated" datetime NOT NULL DEFAULT (datetime('now')),
                "projectId" varchar(21) NOT NULL,
                "flowId" varchar(21) NOT NULL,
                "flowVersionId" varchar(21),
                "visitorKey" varchar(64) NOT NULL,
                "attribution" varchar NOT NULL,
                "userId" varchar(21),
                "status" varchar NOT NULL,
                "runId" varchar(21),
                "useDraft" boolean NOT NULL DEFAULT (0),
                "lastEventAt" datetime NOT NULL,
                FOREIGN KEY ("projectId") REFERENCES "project" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
                FOREIGN KEY ("flowId") REFERENCES "flow" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
                FOREIGN KEY ("runId") REFERENCES "flow_run" ("id") ON DELETE SET NULL ON UPDATE NO ACTION
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
            CREATE TABLE "form_field_interaction" (
                "id" varchar(21) PRIMARY KEY NOT NULL,
                "created" datetime NOT NULL DEFAULT (datetime('now')),
                "updated" datetime NOT NULL DEFAULT (datetime('now')),
                "projectId" varchar(21) NOT NULL,
                "flowId" varchar(21) NOT NULL,
                "flowVersionId" varchar(21),
                "sessionId" varchar(21) NOT NULL,
                "fieldName" varchar(200) NOT NULL,
                "fieldLabel" varchar(200) NOT NULL,
                "reached" boolean NOT NULL DEFAULT (1),
                "interacted" boolean NOT NULL DEFAULT (0),
                "attribution" varchar NOT NULL,
                FOREIGN KEY ("projectId") REFERENCES "project" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
                FOREIGN KEY ("flowId") REFERENCES "flow" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
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
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('DROP TABLE IF EXISTS "form_field_interaction"')
        await queryRunner.query('DROP TABLE IF EXISTS "form_session"')
    }
}
