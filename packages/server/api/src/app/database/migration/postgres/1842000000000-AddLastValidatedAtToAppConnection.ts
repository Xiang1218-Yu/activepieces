import { QueryRunner } from 'typeorm'
import { Migration } from '../../migration'

export class AddLastValidatedAtToAppConnection1842000000000 implements Migration {
    name = 'AddLastValidatedAtToAppConnection1842000000000'
    breaking = false
    release = '0.91.0'
    transaction = true

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "app_connection"
            ADD COLUMN IF NOT EXISTS "lastValidatedAt" TIMESTAMP WITH TIME ZONE
        `)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('ALTER TABLE "app_connection" DROP COLUMN IF EXISTS "lastValidatedAt"')
    }
}
