import { Flow, FlowRun, FormSessionAttribution, FormSessionStatus, Project } from '@activepieces/shared'
import { EntitySchema } from 'typeorm'
import {
    ApIdSchema,
    BaseColumnSchemaPart,
} from '../../database/database-common'

export type FormSessionSchema = {
    id: string
    projectId: string
    flowId: string
    flowVersionId: string | null
    visitorKey: string
    attribution: FormSessionAttribution
    userId: string | null
    status: FormSessionStatus
    runId: string | null
    useDraft: boolean
    lastEventAt: string
    project: Project
    flow: Flow
    run: FlowRun | null
    created: string
    updated: string
}

export const FormSessionEntity = new EntitySchema<FormSessionSchema>({
    name: 'form_session',
    columns: {
        ...BaseColumnSchemaPart,
        projectId: ApIdSchema,
        flowId: ApIdSchema,
        flowVersionId: {
            ...ApIdSchema,
            nullable: true,
        },
        visitorKey: {
            type: String,
            length: 64,
        },
        attribution: {
            type: String,
        },
        userId: {
            ...ApIdSchema,
            nullable: true,
        },
        status: {
            type: String,
        },
        runId: {
            ...ApIdSchema,
            nullable: true,
        },
        useDraft: {
            type: Boolean,
            nullable: false,
            default: false,
        },
        lastEventAt: {
            type: 'timestamp with time zone',
        },
    },
    indices: [
        {
            name: 'idx_form_session_flow_visitor',
            columns: ['flowId', 'visitorKey'],
        },
        {
            name: 'idx_form_session_project_created',
            columns: ['projectId', 'created'],
        },
        {
            name: 'idx_form_session_run_id',
            columns: ['runId'],
        },
        {
            name: 'idx_form_session_flow_created',
            columns: ['flowId', 'created'],
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
                foreignKeyConstraintName: 'fk_form_session_project_id',
            },
        },
        flow: {
            type: 'many-to-one',
            target: 'flow',
            cascade: true,
            onDelete: 'CASCADE',
            joinColumn: {
                name: 'flowId',
                foreignKeyConstraintName: 'fk_form_session_flow_id',
            },
        },
        run: {
            type: 'many-to-one',
            target: 'flow_run',
            onDelete: 'SET NULL',
            joinColumn: {
                name: 'runId',
                foreignKeyConstraintName: 'fk_form_session_run_id',
            },
        },
    },
})
