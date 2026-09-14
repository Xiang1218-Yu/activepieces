import { ApEdition } from '@activepieces/shared'
import { MigrationInterface, QueryRunner } from 'typeorm'
import { isNotOneOfTheseEditions } from '../../database-common'

export class AddGitPushOperationTable1842000000000 implements MigrationInterface {
    name = 'AddGitPushOperationTable1842000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (isNotOneOfTheseEditions([ApEdition.CLOUD, ApEdition.ENTERPRISE])) {
            return
        }
        await queryRunner.query(`
            CREATE TABLE "git_push_operation" (
                "id" character varying(21) NOT NULL,
                "created" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "projectId" character varying(21) NOT NULL,
                "gitRepoId" character varying(21) NOT NULL,
                "status" character varying NOT NULL,
                "operationType" character varying NOT NULL,
                "request" text NOT NULL,
                "commitMessage" character varying,
                "triggeredBy" character varying(21),
                "failureReason" character varying,
                "errorMessage" character varying,
                "startedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
                "finishedAt" TIMESTAMP WITH TIME ZONE,
                CONSTRAINT "PK_git_push_operation" PRIMARY KEY ("id")
            )
        `)
        await queryRunner.query(`
            CREATE INDEX "idx_git_push_operation_project_id" ON "git_push_operation" ("projectId")
        `)
        await queryRunner.query(`
            CREATE INDEX "idx_git_push_operation_repo_id" ON "git_push_operation" ("gitRepoId")
        `)
        await queryRunner.query(`
            CREATE UNIQUE INDEX "uq_git_push_operation_in_progress"
            ON "git_push_operation" ("projectId")
            WHERE "status" = 'IN_PROGRESS'
        `)
        await queryRunner.query(`
            ALTER TABLE "git_push_operation"
            ADD CONSTRAINT "fk_git_push_operation_project_id"
            FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `)
        await queryRunner.query(`
            ALTER TABLE "git_push_operation"
            ADD CONSTRAINT "fk_git_push_operation_git_repo_id"
            FOREIGN KEY ("gitRepoId") REFERENCES "git_repo"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (isNotOneOfTheseEditions([ApEdition.CLOUD, ApEdition.ENTERPRISE])) {
            return
        }
        await queryRunner.query(`
            ALTER TABLE "git_push_operation" DROP CONSTRAINT "fk_git_push_operation_git_repo_id"
        `)
        await queryRunner.query(`
            ALTER TABLE "git_push_operation" DROP CONSTRAINT "fk_git_push_operation_project_id"
        `)
        await queryRunner.query(`
            DROP INDEX "uq_git_push_operation_in_progress"
        `)
        await queryRunner.query(`
            DROP INDEX "idx_git_push_operation_repo_id"
        `)
        await queryRunner.query(`
            DROP INDEX "idx_git_push_operation_project_id"
        `)
        await queryRunner.query(`
            DROP TABLE "git_push_operation"
        `)
    }
}
