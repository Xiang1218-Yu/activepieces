import { Agent, AgentEvalCase, AgentEvalCaseResult, AgentEvalRun, AgentEvalSuite, Project } from '@activepieces/shared'
import { EntitySchema } from 'typeorm'
import { ApIdSchema, BaseColumnSchemaPart } from '../../../database/database-common'

export type AgentEvalSuiteWithRelations = AgentEvalSuite & {
    project: Project
    agent: Agent
}

export const AgentEvalSuiteEntity = new EntitySchema<AgentEvalSuiteWithRelations>({
    name: 'agent_eval_suite',
    columns: {
        ...BaseColumnSchemaPart,
        projectId: {
            ...ApIdSchema,
            nullable: false,
        },
        agentId: {
            ...ApIdSchema,
            nullable: false,
        },
        name: {
            type: String,
            nullable: false,
        },
        description: {
            type: String,
            nullable: true,
        },
        variableNames: {
            type: 'jsonb',
            nullable: false,
            default: '[]',
        },
    },
    indices: [
        {
            name: 'idx_agent_eval_suite_agent',
            columns: ['agentId'],
        },
        {
            name: 'idx_agent_eval_suite_project',
            columns: ['projectId'],
        },
    ],
    relations: {
        project: {
            type: 'many-to-one',
            target: 'project',
            onDelete: 'CASCADE',
            joinColumn: {
                name: 'projectId',
                foreignKeyConstraintName: 'fk_agent_eval_suite_project_id',
            },
        },
        agent: {
            type: 'many-to-one',
            target: 'agent',
            onDelete: 'CASCADE',
            joinColumn: {
                name: 'agentId',
                foreignKeyConstraintName: 'fk_agent_eval_suite_agent_id',
            },
        },
    },
})

export type AgentEvalCaseWithRelations = AgentEvalCase & {
    suite: AgentEvalSuite
}

export const AgentEvalCaseEntity = new EntitySchema<AgentEvalCaseWithRelations>({
    name: 'agent_eval_case',
    columns: {
        ...BaseColumnSchemaPart,
        suiteId: {
            ...ApIdSchema,
            nullable: false,
        },
        name: {
            type: String,
            nullable: false,
        },
        messageTemplate: {
            type: 'text',
            nullable: false,
        },
        variables: {
            type: 'jsonb',
            nullable: false,
            default: '{}',
        },
        expectedOutput: {
            type: 'text',
            nullable: true,
        },
        sortOrder: {
            type: Number,
            nullable: false,
            default: 0,
        },
    },
    indices: [
        {
            name: 'idx_agent_eval_case_suite',
            columns: ['suiteId', 'sortOrder'],
        },
    ],
    relations: {
        suite: {
            type: 'many-to-one',
            target: 'agent_eval_suite',
            onDelete: 'CASCADE',
            joinColumn: {
                name: 'suiteId',
                foreignKeyConstraintName: 'fk_agent_eval_case_suite_id',
            },
        },
    },
})

export type AgentEvalRunWithRelations = AgentEvalRun & {
    project: Project
    suite: AgentEvalSuite
    agent: Agent
}

export const AgentEvalRunEntity = new EntitySchema<AgentEvalRunWithRelations>({
    name: 'agent_eval_run',
    columns: {
        ...BaseColumnSchemaPart,
        projectId: {
            ...ApIdSchema,
            nullable: false,
        },
        suiteId: {
            ...ApIdSchema,
            nullable: false,
        },
        agentId: {
            ...ApIdSchema,
            nullable: false,
        },
        createdByUserId: {
            ...ApIdSchema,
            nullable: false,
        },
        agentVersion: {
            type: String,
            nullable: false,
        },
        modelName: {
            type: String,
            nullable: true,
        },
        toolExecution: {
            type: String,
            nullable: false,
        },
        status: {
            type: String,
            nullable: false,
        },
        maxConcurrency: {
            type: Number,
            nullable: false,
        },
        maxCostCredits: {
            type: 'double precision',
            nullable: true,
        },
        caseTimeoutMs: {
            type: Number,
            nullable: false,
        },
        totals: {
            type: 'jsonb',
            nullable: false,
        },
        error: {
            type: 'text',
            nullable: true,
        },
        startedAt: {
            type: 'timestamp with time zone',
            nullable: true,
        },
        finishedAt: {
            type: 'timestamp with time zone',
            nullable: true,
        },
    },
    indices: [
        {
            name: 'idx_agent_eval_run_suite_created',
            columns: ['suiteId', 'created'],
        },
        {
            name: 'idx_agent_eval_run_project_created',
            columns: ['projectId', 'created'],
        },
    ],
    relations: {
        project: {
            type: 'many-to-one',
            target: 'project',
            onDelete: 'CASCADE',
            joinColumn: {
                name: 'projectId',
                foreignKeyConstraintName: 'fk_agent_eval_run_project_id',
            },
        },
        suite: {
            type: 'many-to-one',
            target: 'agent_eval_suite',
            onDelete: 'CASCADE',
            joinColumn: {
                name: 'suiteId',
                foreignKeyConstraintName: 'fk_agent_eval_run_suite_id',
            },
        },
        agent: {
            type: 'many-to-one',
            target: 'agent',
            onDelete: 'CASCADE',
            joinColumn: {
                name: 'agentId',
                foreignKeyConstraintName: 'fk_agent_eval_run_agent_id',
            },
        },
    },
})

export type AgentEvalCaseResultWithRelations = AgentEvalCaseResult & {
    run: AgentEvalRun
    case: AgentEvalCase
}

export const AgentEvalCaseResultEntity = new EntitySchema<AgentEvalCaseResultWithRelations>({
    name: 'agent_eval_case_result',
    columns: {
        ...BaseColumnSchemaPart,
        runId: {
            ...ApIdSchema,
            nullable: false,
        },
        caseId: {
            ...ApIdSchema,
            nullable: false,
        },
        caseName: {
            type: String,
            nullable: false,
        },
        status: {
            type: String,
            nullable: false,
        },
        renderedMessage: {
            type: 'text',
            nullable: false,
        },
        toolCalls: {
            type: 'jsonb',
            nullable: false,
            default: '[]',
        },
        creditsUsed: {
            type: 'double precision',
            nullable: false,
            default: 0,
        },
        output: {
            type: 'text',
            nullable: true,
        },
        error: {
            type: 'text',
            nullable: true,
        },
        durationMs: {
            type: Number,
            nullable: true,
        },
        conversationId: {
            type: String,
            nullable: true,
        },
        startedAt: {
            type: 'timestamp with time zone',
            nullable: true,
        },
        finishedAt: {
            type: 'timestamp with time zone',
            nullable: true,
        },
    },
    indices: [
        {
            name: 'idx_agent_eval_case_result_run',
            columns: ['runId', 'status'],
        },
    ],
    relations: {
        run: {
            type: 'many-to-one',
            target: 'agent_eval_run',
            onDelete: 'CASCADE',
            joinColumn: {
                name: 'runId',
                foreignKeyConstraintName: 'fk_agent_eval_case_result_run_id',
            },
        },
        case: {
            type: 'many-to-one',
            target: 'agent_eval_case',
            onDelete: 'CASCADE',
            joinColumn: {
                name: 'caseId',
                foreignKeyConstraintName: 'fk_agent_eval_case_result_case_id',
            },
        },
    },
})
