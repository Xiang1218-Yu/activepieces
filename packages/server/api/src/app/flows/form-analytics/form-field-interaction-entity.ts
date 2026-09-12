import { Flow, FormFieldInteraction, Project } from '@activepieces/shared'
import { EntitySchema } from 'typeorm'
import {
    ApIdSchema,
    BaseColumnSchemaPart,
} from '../../database/database-common'

export type FormFieldInteractionSchema = FormFieldInteraction & {
    project: Project
    flow: Flow
}

export const FormFieldInteractionEntity = new EntitySchema<FormFieldInteractionSchema>({
    name: 'form_field_interaction',
    columns: {
        ...BaseColumnSchemaPart,
        projectId: ApIdSchema,
        flowId: ApIdSchema,
        flowVersionId: {
            ...ApIdSchema,
            nullable: true,
        },
        sessionId: ApIdSchema,
        fieldName: {
            type: String,
            length: 200,
        },
        fieldLabel: {
            type: String,
            length: 200,
        },
        reached: {
            type: Boolean,
            nullable: false,
            default: true,
        },
        interacted: {
            type: Boolean,
            nullable: false,
            default: false,
        },
        attribution: {
            type: String,
        },
    },
    indices: [
        {
            name: 'idx_form_field_interaction_session_field',
            columns: ['sessionId', 'fieldName'],
        },
        {
            name: 'idx_form_field_interaction_project_created',
            columns: ['projectId', 'created'],
        },
        {
            name: 'idx_form_field_interaction_flow_created',
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
                foreignKeyConstraintName: 'fk_form_field_interaction_project_id',
            },
        },
        flow: {
            type: 'many-to-one',
            target: 'flow',
            cascade: true,
            onDelete: 'CASCADE',
            joinColumn: {
                name: 'flowId',
                foreignKeyConstraintName: 'fk_form_field_interaction_flow_id',
            },
        },
    },
})
