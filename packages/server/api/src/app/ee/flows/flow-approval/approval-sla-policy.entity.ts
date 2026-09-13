import { ApprovalSlaPolicy, ApprovalSlaRule, FlowApprovalPriority } from '@activepieces/shared'
import { EntitySchema } from 'typeorm'
import { ApIdSchema, BaseColumnSchemaPart } from '../../../database/database-common'

export type ApprovalSlaPolicySchema = ApprovalSlaPolicy

type ApprovalSlaPolicyRow = Omit<ApprovalSlaPolicy, 'rules'> & {
    rules: Record<FlowApprovalPriority, ApprovalSlaRule>
}

export const ApprovalSlaPolicyEntity = new EntitySchema<ApprovalSlaPolicyRow>({
    name: 'approval_sla_policy',
    columns: {
        ...BaseColumnSchemaPart,
        projectId: {
            ...ApIdSchema,
            nullable: false,
        },
        platformId: {
            ...ApIdSchema,
            nullable: false,
        },
        timezone: {
            type: String,
            length: 64,
            nullable: false,
            default: 'Etc/UTC',
        },
        rules: {
            type: 'jsonb',
            nullable: false,
        },
    },
    indices: [
        {
            name: 'idx_approval_sla_policy_project_id',
            columns: ['projectId'],
            unique: true,
        },
    ],
})
