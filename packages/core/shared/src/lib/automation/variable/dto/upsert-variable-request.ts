import { Metadata } from '@activepieces/core-utils'
import { z } from 'zod'
import { VARIABLE_NAME_REGEX, VariableType } from '../variable'

export const UpsertVariableRequestBody = z.object({
    projectId: z.string(),
    name: z.string().min(1, 'formErrors.required').regex(VARIABLE_NAME_REGEX, 'invalidVariableName'),
    type: z.enum(VariableType).optional(),
    value: z.string().min(1, 'formErrors.required'),
    metadata: z.optional(Metadata),
})
export type UpsertVariableRequestBody = z.infer<typeof UpsertVariableRequestBody>

export const UpdateVariableRequestBody = z.object({
    type: z.enum(VariableType).optional(),
    value: z.string().min(1, 'formErrors.required').optional(),
    metadata: z.optional(Metadata),
})
export type UpdateVariableRequestBody = z.infer<typeof UpdateVariableRequestBody>
