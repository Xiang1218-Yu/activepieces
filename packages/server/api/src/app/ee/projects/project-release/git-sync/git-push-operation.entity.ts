import { GitPushFailureReason, GitPushOperation, GitPushOperationStatus, GitPushOperationType, GitRepo, Project } from '@activepieces/shared'
import { EntitySchema } from 'typeorm'
import { ApIdSchema, BaseColumnSchemaPart } from '../../../../database/database-common'

type GitPushOperationSchema = GitPushOperation & {
    project: Project
    gitRepo: GitRepo
}

export const GitPushOperationEntity = new EntitySchema<GitPushOperationSchema>({
    name: 'git_push_operation',
    columns: {
        ...BaseColumnSchemaPart,
        projectId: ApIdSchema,
        gitRepoId: ApIdSchema,
        status: {
            type: String,
            enum: Object.values(GitPushOperationStatus),
            nullable: false,
        },
        operationType: {
            type: String,
            enum: Object.values(GitPushOperationType),
            nullable: false,
        },
        request: {
            type: 'simple-json',
            nullable: false,
        },
        commitMessage: {
            type: String,
            nullable: true,
        },
        triggeredBy: {
            ...ApIdSchema,
            nullable: true,
        },
        failureReason: {
            type: String,
            enum: Object.values(GitPushFailureReason),
            nullable: true,
        },
        errorMessage: {
            type: String,
            nullable: true,
        },
        startedAt: {
            type: 'timestamp with time zone',
            nullable: false,
        },
        finishedAt: {
            type: 'timestamp with time zone',
            nullable: true,
        },
    },
    indices: [
        {
            name: 'idx_git_push_operation_project_id',
            columns: ['projectId'],
        },
        {
            name: 'idx_git_push_operation_repo_id',
            columns: ['gitRepoId'],
        },
        {
            name: 'uq_git_push_operation_in_progress',
            columns: ['projectId'],
            where: '"status" = \'IN_PROGRESS\'',
        },
    ],
    relations: {
        project: {
            type: 'many-to-one',
            target: 'project',
            cascade: true,
            onDelete: 'CASCADE',
            joinColumn: {
                name: 'projectId',
                referencedColumnName: 'id',
                foreignKeyConstraintName: 'fk_git_push_operation_project_id',
            },
        },
        gitRepo: {
            type: 'many-to-one',
            target: 'git_repo',
            cascade: true,
            onDelete: 'CASCADE',
            joinColumn: {
                name: 'gitRepoId',
                referencedColumnName: 'id',
                foreignKeyConstraintName: 'fk_git_push_operation_git_repo_id',
            },
        },
    },
})
