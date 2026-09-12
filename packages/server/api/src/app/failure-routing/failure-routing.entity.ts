import { FailureDelivery, FailureRoutingRule, Platform, Project } from '@activepieces/shared'
import { EntitySchema } from 'typeorm'
import { ApIdSchema, BaseColumnSchemaPart } from '../database/database-common'

export type FailureRoutingRuleSchema = FailureRoutingRule & {
    platform: Platform
    project: Project
}

export const FailureRoutingRuleEntity = new EntitySchema<FailureRoutingRuleSchema>({
    name: 'failure_routing_rule',
    columns: {
        ...BaseColumnSchemaPart,
        platformId: {
            ...ApIdSchema,
            nullable: false,
        },
        projectId: {
            ...ApIdSchema,
            nullable: false,
        },
        displayName: {
            type: String,
            nullable: false,
        },
        enabled: {
            type: Boolean,
            nullable: false,
            default: true,
        },
        priority: {
            type: Number,
            nullable: false,
            default: 100,
        },
        stopOnMatch: {
            type: Boolean,
            nullable: false,
            default: false,
        },
        filter: {
            type: 'json',
            nullable: false,
        },
        target: {
            type: 'json',
            nullable: false,
        },
        lastDelivery: {
            type: 'json',
            nullable: true,
        },
    },
    indices: [
        {
            name: 'idx_failure_routing_rule_project_priority',
            columns: ['projectId', 'priority', 'created'],
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
                foreignKeyConstraintName: 'fk_failure_routing_rule_platform',
            },
        },
        project: {
            type: 'many-to-one',
            target: 'project',
            cascade: true,
            onDelete: 'CASCADE',
            joinColumn: {
                name: 'projectId',
                foreignKeyConstraintName: 'fk_failure_routing_rule_project',
            },
        },
    },
})

export type FailureDeliverySchema = FailureDelivery & {
    platform: Platform
    project: Project
    rule: FailureRoutingRule
}

export const FailureDeliveryEntity = new EntitySchema<FailureDeliverySchema>({
    name: 'failure_delivery',
    columns: {
        ...BaseColumnSchemaPart,
        platformId: {
            ...ApIdSchema,
            nullable: false,
        },
        projectId: {
            ...ApIdSchema,
            nullable: false,
        },
        ruleId: {
            ...ApIdSchema,
            nullable: false,
        },
        flowRunId: {
            ...ApIdSchema,
            nullable: false,
        },
        flowId: {
            ...ApIdSchema,
            nullable: false,
        },
        retryCount: {
            type: Number,
            nullable: false,
            default: 0,
        },
        category: {
            type: String,
            nullable: false,
        },
        targetType: {
            type: String,
            nullable: false,
        },
        status: {
            type: String,
            nullable: false,
        },
        errorMessage: {
            type: String,
            nullable: true,
        },
        attempts: {
            type: Number,
            nullable: false,
            default: 0,
        },
        deliveredAt: {
            type: String,
            nullable: true,
        },
    },
    indices: [
        {
            name: 'idx_failure_delivery_run_rule_unique',
            columns: ['flowRunId', 'ruleId'],
            unique: true,
        },
        {
            name: 'idx_failure_delivery_project_created',
            columns: ['projectId', 'created'],
        },
        {
            name: 'idx_failure_delivery_rule',
            columns: ['ruleId'],
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
                foreignKeyConstraintName: 'fk_failure_delivery_platform',
            },
        },
        project: {
            type: 'many-to-one',
            target: 'project',
            cascade: true,
            onDelete: 'CASCADE',
            joinColumn: {
                name: 'projectId',
                foreignKeyConstraintName: 'fk_failure_delivery_project',
            },
        },
        rule: {
            type: 'many-to-one',
            target: 'failure_routing_rule',
            cascade: true,
            onDelete: 'CASCADE',
            joinColumn: {
                name: 'ruleId',
                foreignKeyConstraintName: 'fk_failure_delivery_rule',
            },
        },
    },
})
