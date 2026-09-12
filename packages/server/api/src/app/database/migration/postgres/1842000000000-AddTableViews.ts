import { QueryRunner } from 'typeorm'
import { Migration } from '../../migration'

export class AddTableViews1842000000000 implements Migration {
    name = 'AddTableViews1842000000000'
    breaking = false
    release = '0.91.1'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "table_view" (
                "id" character varying(21) NOT NULL,
                "created" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "name" character varying NOT NULL,
                "tableId" character varying(21) NOT NULL,
                "projectId" character varying(21) NOT NULL,
                "config" jsonb NOT NULL DEFAULT '{"filters":[],"sorts":[],"hiddenFieldIds":[],"pagination":{"page":1,"pageSize":100}}',
                "version" integer NOT NULL DEFAULT 0,
                CONSTRAINT "pk_table_view_id" PRIMARY KEY ("id")
            )
        `)
        await queryRunner.query(`
            CREATE INDEX "idx_table_view_project_id_table_id" ON "table_view" ("projectId", "tableId")
        `)
        await queryRunner.query(`
            ALTER TABLE "table_view"
            ADD CONSTRAINT "fk_table_view_table_id"
            FOREIGN KEY ("tableId") REFERENCES "table"("id") ON DELETE CASCADE
        `)
        await queryRunner.query(`
            ALTER TABLE "table_view"
            ADD CONSTRAINT "fk_table_view_project_id"
            FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE
        `)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "table_view"`)
    }
}
