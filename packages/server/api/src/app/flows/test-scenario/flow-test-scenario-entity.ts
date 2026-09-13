import { Flow, FlowTestScenario, FlowTestScenarioRun, FlowVersion, Project } from '@activepieces/shared'
import { EntitySchema } from 'typeorm'
import {
    ApIdSchema,
    BaseColumnSchemaPart,
} from '../../database/database-common'

export type FlowTestScenarioSchema = {
    flow: Flow
    flowVersion: FlowVersion
    project: Project
} & FlowTestScenario

export const FlowTestScenarioEntity = new EntitySchema<FlowTestScenarioSchema>({
    name: 'flow_test_scenario',
    columns: {
        ...BaseColumnSchemaPart,
        projectId: ApIdSchema,
        flowId: ApIdSchema,
        flowVersionId: ApIdSchema,
        name: {
            type: String,
        },
        description: {
            type: String,
            nullable: true,
        },
        triggerInput: {
            type: 'jsonb',
            nullable: true,
        },
        inputFileIds: {
            type: String,
            array: true,
        },
        expectedOutputs: {
            type: 'jsonb',
        },
        allowedDynamicFields: {
            type: String,
            array: true,
        },
        connectionStrategy: {
            type: String,
        },
        connectionMocks: {
            type: 'jsonb',
        },
        versionSnapshot: {
            type: 'jsonb',
        },
    },
    indices: [
        {
            name: 'idx_flow_test_scenario_flow_id',
            columns: ['flowId'],
        },
        {
            name: 'idx_flow_test_scenario_flow_version_id',
            columns: ['flowVersionId'],
        },
        {
            name: 'idx_flow_test_scenario_project_id',
            columns: ['projectId'],
        },
    ],
    relations: {
        flow: {
            type: 'many-to-one',
            target: 'flow',
            onDelete: 'CASCADE',
            joinColumn: {
                name: 'flowId',
                foreignKeyConstraintName: 'fk_flow_test_scenario_flow',
            },
        },
        flowVersion: {
            type: 'many-to-one',
            target: 'flow_version',
            onDelete: 'CASCADE',
            joinColumn: {
                name: 'flowVersionId',
                foreignKeyConstraintName: 'fk_flow_test_scenario_flow_version',
            },
        },
        project: {
            type: 'many-to-one',
            target: 'project',
            onDelete: 'CASCADE',
            joinColumn: {
                name: 'projectId',
                foreignKeyConstraintName: 'fk_flow_test_scenario_project',
            },
        },
    },
})

export type FlowTestScenarioRunSchema = {
    scenario: FlowTestScenario
} & FlowTestScenarioRun

export const FlowTestScenarioRunEntity = new EntitySchema<FlowTestScenarioRunSchema>({
    name: 'flow_test_scenario_run',
    columns: {
        ...BaseColumnSchemaPart,
        projectId: ApIdSchema,
        scenarioId: ApIdSchema,
        flowId: ApIdSchema,
        flowVersionId: ApIdSchema,
        flowRunId: {
            ...ApIdSchema,
            nullable: true,
        },
        status: {
            type: String,
        },
        failureReason: {
            type: String,
            nullable: true,
        },
        diffReport: {
            type: 'jsonb',
            nullable: true,
        },
        triggeredBy: {
            type: String,
            nullable: true,
        },
    },
    indices: [
        {
            name: 'idx_flow_test_scenario_run_scenario_id',
            columns: ['scenarioId', 'created'],
        },
        {
            name: 'idx_flow_test_scenario_run_flow_run_id',
            columns: ['flowRunId'],
        },
        {
            name: 'idx_flow_test_scenario_run_project_id',
            columns: ['projectId'],
        },
    ],
    relations: {
        scenario: {
            type: 'many-to-one',
            target: 'flow_test_scenario',
            onDelete: 'CASCADE',
            joinColumn: {
                name: 'scenarioId',
                foreignKeyConstraintName: 'fk_flow_test_scenario_run_scenario',
            },
        },
    },
})
