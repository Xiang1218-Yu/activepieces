import { OptionalArrayFromQuery } from '@activepieces/core-utils'
import { z } from 'zod'
import { VariableType } from '../variable'

export const ListVariablesRequestQuery = z.object({
    projectId: z.string(),
    cursor: z.string().optional(),
    limit: z.coerce.number().optional(),
    name: z.string().optional(),
    type: OptionalArrayFromQuery(z.enum(VariableType)),
    updatedAfter: z.string().optional(),
    updatedBefore: z.string().optional(),
    usedInFlows: OptionalArrayFromQuery(z.enum(['true', 'false'])),
    includeValues: z.enum(['true', 'false']).optional(),
})
export type ListVariablesRequestQuery = z.infer<typeof ListVariablesRequestQuery>

export const RevealVariableResponse = z.object({
    value: z.string(),
})
export type RevealVariableResponse = z.infer<typeof RevealVariableResponse>

export const GetVariableForWorkerRequestParams = z.object({
    name: z.string(),
})
export type GetVariableForWorkerRequestParams = z.infer<typeof GetVariableForWorkerRequestParams>
