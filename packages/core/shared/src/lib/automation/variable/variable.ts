import { BaseModel, BaseModelSchema, Metadata, Nullable } from '@activepieces/core-utils'
import { z } from 'zod'
import { UserWithMetaInformation } from '../../core/user'

export const VARIABLE_NAME_REGEX = /^[a-zA-Z0-9_]+$/

export type VariableId = string

export type VariableValue = {
    secret_text: string
}

export enum VariableType {
    SECRET = 'SECRET',
    TEXT = 'TEXT',
}

export type Variable = BaseModel<VariableId> & {
    name: string
    type: VariableType
    projectId: string
    platformId: string
    ownerId: string | null
    owner: UserWithMetaInformation | null
    metadata: Metadata | null
    value: VariableValue
}

export const VariableWithoutSensitiveData = z.object({
    ...BaseModelSchema,
    name: z.string(),
    type: z.enum(VariableType),
    projectId: z.string(),
    platformId: z.string(),
    ownerId: Nullable(z.string()),
    owner: Nullable(UserWithMetaInformation),
    metadata: Nullable(Metadata),
    value: z.string().optional(),
}).describe('A project-scoped encrypted variable that flows can reference via {{variables[\'NAME\']}}. The plaintext value is only present for TEXT variables; SECRET variables require the reveal endpoint.')
export type VariableWithoutSensitiveData = z.infer<typeof VariableWithoutSensitiveData>

export const VariableListItem = VariableWithoutSensitiveData.extend({
    usedInFlows: z.boolean(),
})
export type VariableListItem = z.infer<typeof VariableListItem>
