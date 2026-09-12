import { Platform, Project, RunRetentionPolicy } from '@activepieces/shared'
import { EntitySchema } from 'typeorm'
import {
    ApIdSchema,
    BaseColumnSchemaPart,
} from '../database/database-common'

type RunRetentionPolicySchema = RunRetentionPolicy & {
    platform: Platform
    project?: Project
}

export const RunRetentionPolicyEntity = new EntitySchema<RunRetentionPolicySchema>({
    name: 'run_retention_policy',
    columns: {
        ...BaseColumnSchemaPart,
        platformId: ApIdSchema,
        projectId: {
            ...ApIdSchema,
            nullable: true,
        },
        retentionDays: {
            type: Number,
            nullable: false,
        },
        statuses: {
            type: String,
            array: true,
            nullable: false,
        },
        includeArchived: {
            type: Boolean,
            nullable: false,
            default: true,
        },
    },
    indices: [
        {
            name: 'idx_run_retention_policy_platform_default',
            columns: ['platformId'],
            where: '"projectId" IS NULL',
            unique: true,
        },
        {
            name: 'idx_run_retention_policy_project',
            columns: ['projectId'],
            where: '"projectId" IS NOT NULL',
            unique: true,
        },
    ],
    relations: {
        platform: {
            type: 'many-to-one',
            target: 'platform',
            cascade: true,
            onDelete: 'CASCADE',
            joinColumn: {
                name: 'platformId',
                foreignKeyConstraintName: 'fk_run_retention_policy_platform_id',
            },
        },
        project: {
            type: 'many-to-one',
            target: 'project',
            cascade: true,
            onDelete: 'CASCADE',
            nullable: true,
            joinColumn: {
                name: 'projectId',
                foreignKeyConstraintName: 'fk_run_retention_policy_project_id',
            },
        },
    },
})
