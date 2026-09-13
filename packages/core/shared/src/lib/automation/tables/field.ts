import { BaseModelSchema } from '@activepieces/core-utils'
import { z } from 'zod'

export enum FieldType {
    TEXT = 'TEXT',
    NUMBER = 'NUMBER',
    DATE = 'DATE',
    DATETIME = 'DATETIME',
    STATIC_DROPDOWN = 'STATIC_DROPDOWN',
}

export const StaticDropdownOption = z.object({
    value: z.string(),
    // Optional for backwards compatibility: options stored before this flag
    // existed have no `disabled` key and are treated as active.
    disabled: z.boolean().optional(),
})
export type StaticDropdownOption = z.infer<typeof StaticDropdownOption>

export const StaticDropdownData = z.object({
    options: z.array(StaticDropdownOption),
})
export type StaticDropdownData = z.infer<typeof StaticDropdownData>

export const isActiveDropdownOption = (option: StaticDropdownOption): boolean => option.disabled !== true

export const getActiveDropdownOptionValues = (data: StaticDropdownData): string[] =>
    data.options.filter(isActiveDropdownOption).map((option) => option.value)

export const Field = z.union([z.object({
    ...BaseModelSchema,
    name: z.string(),
    externalId: z.string(),
    type: z.literal(FieldType.STATIC_DROPDOWN),
    tableId: z.string(),
    projectId: z.string(),
    position: z.number(),
    data: StaticDropdownData,
}), z.object({
    ...BaseModelSchema,
    name: z.string(),
    externalId: z.string(),
    type: z.union([z.literal(FieldType.TEXT), z.literal(FieldType.NUMBER), z.literal(FieldType.DATE), z.literal(FieldType.DATETIME)]),
    tableId: z.string(),
    projectId: z.string(),
    position: z.number(),
})])

export type Field = z.infer<typeof Field>

export const StaticDropdownEmptyOption = {
    label: '',
    value: '',
}
