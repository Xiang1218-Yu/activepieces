import { QueryRunner } from 'typeorm'
import { Migration } from '../../migration'

export class AddTypeToVariable1842000000000 implements Migration {
    name = 'AddTypeToVariable1842000000000'
    breaking = false
    release = '0.90.4'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "variable"
            ADD COLUMN "type" character varying NOT NULL DEFAULT 'SECRET'
        `)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "variable" DROP COLUMN "type"
        `)
    }
}
