import { BaseModelSchema } from '@activepieces/core-utils'
import { z } from 'zod'
import { FilterOperator } from './dto/records.dto'
import { FieldType } from './field'

export enum TableViewSortDirection {
    ASC = 'ASC',
    DESC = 'DESC',
}

export enum TableViewConditionIssue {
    FIELD_DELETED = 'FIELD_DELETED',
    FIELD_TYPE_CHANGED = 'FIELD_TYPE_CHANGED',
}

const tableViewValueCondition = z.object({
    fieldId: z.string(),
    fieldName: z.string(),
    fieldType: z.nativeEnum(FieldType),
    operator: z.enum(valueOperators),
    value: z.string(),
})

const tableViewExistenceCondition = z.object({
    fieldId: z.string(),
    fieldName: z.string(),
    fieldType: z.nativeEnum(FieldType),
    operator: z.enum(existenceOperators),
})

export const TableViewCondition = z.discriminatedUnion('operator', [
    tableViewValueCondition,
    tableViewExistenceCondition,
])

export type TableViewCondition = z.infer<typeof TableViewCondition>

export const TableViewSort = z.object({
    fieldId: z.string(),
    direction: z.nativeEnum(TableViewSortDirection),
})

export type TableViewSort = z.infer<typeof TableViewSort>

export const TableViewPagination = z.object({
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(500),
})

export type TableViewPagination = z.infer<typeof TableViewPagination>

export const TableViewConfig = z.object({
    filters: z.array(TableViewCondition),
    sorts: z.array(TableViewSort),
    hiddenFieldIds: z.array(z.string()),
    pagination: TableViewPagination,
})

export type TableViewConfig = z.infer<typeof TableViewConfig>

const tableViewValueConditionIssue = tableViewValueCondition.extend({
    issue: z.nativeEnum(TableViewConditionIssue),
    currentFieldType: z.nativeEnum(FieldType).optional(),
})

const tableViewExistenceConditionIssue = tableViewExistenceCondition.extend({
    issue: z.nativeEnum(TableViewConditionIssue),
    currentFieldType: z.nativeEnum(FieldType).optional(),
})

export const TableViewConditionIssueDetails = z.discriminatedUnion('operator', [
    tableViewValueConditionIssue,
    tableViewExistenceConditionIssue,
])

export type TableViewConditionIssueDetails = z.infer<typeof TableViewConditionIssueDetails>

export const TableView = z.object({
    ...BaseModelSchema,
    name: z.string(),
    tableId: z.string(),
    projectId: z.string(),
    config: TableViewConfig,
    version: z.number().int().nonnegative(),
    invalidConditions: z.array(TableViewConditionIssueDetails),
})

export type TableView = z.infer<typeof TableView>

export const DEFAULT_TABLE_VIEW_CONFIG: TableViewConfig = {
    filters: [],
    sorts: [],
    hiddenFieldIds: [],
    pagination: {
        page: 1,
        pageSize: 100,
    },
}

const valueOperators = [
    FilterOperator.EQ,
    FilterOperator.NEQ,
    FilterOperator.GT,
    FilterOperator.GTE,
    FilterOperator.LT,
    FilterOperator.LTE,
    FilterOperator.CO,
] as const

const existenceOperators = [
    FilterOperator.EXISTS,
    FilterOperator.NOT_EXISTS,
] as const
