import { ApEdition } from '@activepieces/shared'
import { MigrationInterface, QueryRunner } from 'typeorm'
import { isNotOneOfTheseEditions } from '../../database-common'

export class AddReleaseContextToGitPushOperation1843000000000 implements MigrationInterface {
    name = 'AddReleaseContextToGitPushOperation1843000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (isNotOneOfTheseEditions([ApEdition.CLOUD, ApEdition.ENTERPRISE])) {
            return
        }
        await queryRunner.query(`
            ALTER TABLE "git_push_operation"
            ADD "releaseId" character varying(21)
        `)
        await queryRunner.query(`
            ALTER TABLE "git_push_operation"
            ADD "releaseName" character varying
        `)
        await queryRunner.query(`
            ALTER TABLE "git_push_operation"
            ADD CONSTRAINT "fk_git_push_operation_release_id"
            FOREIGN KEY ("releaseId") REFERENCES "project_release"("id") ON DELETE SET NULL ON UPDATE NO ACTION
        `)
        await queryRunner.query(`
            ALTER TABLE "git_push_operation"
            DROP CONSTRAINT "fk_git_push_operation_git_repo_id"
        `)
        await queryRunner.query(`
            ALTER TABLE "git_push_operation"
            ALTER COLUMN "gitRepoId" DROP NOT NULL
        `)
        await queryRunner.query(`
            ALTER TABLE "git_push_operation"
            ADD CONSTRAINT "fk_git_push_operation_git_repo_id"
            FOREIGN KEY ("gitRepoId") REFERENCES "git_repo"("id") ON DELETE SET NULL ON UPDATE NO ACTION
        `)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (isNotOneOfTheseEditions([ApEdition.CLOUD, ApEdition.ENTERPRISE])) {
            return
        }
        await queryRunner.query(`
            ALTER TABLE "git_push_operation"
            DROP CONSTRAINT "fk_git_push_operation_git_repo_id"
        `)
        await queryRunner.query(`
            UPDATE "git_push_operation" SET "gitRepoId" = NULL WHERE "gitRepoId" IS NULL
        `)
        await queryRunner.query(`
            ALTER TABLE "git_push_operation"
            ALTER COLUMN "gitRepoId" SET NOT NULL
        `)
        await queryRunner.query(`
            ALTER TABLE "git_push_operation"
            ADD CONSTRAINT "fk_git_push_operation_git_repo_id"
            FOREIGN KEY ("gitRepoId") REFERENCES "git_repo"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `)
        await queryRunner.query(`
            ALTER TABLE "git_push_operation" DROP CONSTRAINT "fk_git_push_operation_release_id"
        `)
        await queryRunner.query(`
            ALTER TABLE "git_push_operation" DROP COLUMN "releaseName"
        `)
        await queryRunner.query(`
            ALTER TABLE "git_push_operation" DROP COLUMN "releaseId"
        `)
    }
}
