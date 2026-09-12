import { Project, Table, TableView } from '@activepieces/shared'
import { EntitySchema } from 'typeorm'
import { ApIdSchema, BaseColumnSchemaPart } from '../../database/database-common'

type TableViewSchema = Omit<TableView, 'invalidConditions'> & {
    table: Table
    project: Project
}

export const TableViewEntity = new EntitySchema<TableViewSchema>({
    name: 'table_view',
    columns: {
        ...BaseColumnSchemaPart,
        name: {
            type: String,
        },
        tableId: {
            ...ApIdSchema,
            nullable: false,
        },
        projectId: {
            ...ApIdSchema,
            nullable: false,
        },
        config: {
            type: 'jsonb',
            nullable: false,
            default: `{"filters":[],"sorts":[],"hiddenFieldIds":[],"pagination":{"page":1,"pageSize":100}}`,
        },
        version: {
            type: Number,
            nullable: false,
            default: 0,
        },
    },
    indices: [
        {
            name: 'idx_table_view_project_id_table_id',
            columns: ['projectId', 'tableId'],
        },
    ],
    relations: {
        table: {
            type: 'many-to-one',
            target: 'table',
            cascade: true,
            onDelete: 'CASCADE',
            joinColumn: {
                name: 'tableId',
                foreignKeyConstraintName: 'fk_table_view_table_id',
            },
        },
        project: {
            type: 'many-to-one',
            target: 'project',
            cascade: true,
            onDelete: 'CASCADE',
            joinColumn: {
                name: 'projectId',
                foreignKeyConstraintName: 'fk_table_view_project_id',
            },
        },
    },
})
