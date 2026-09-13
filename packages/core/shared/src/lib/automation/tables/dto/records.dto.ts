import { Cursor, OptionalArrayFromQuery } from '@activepieces/core-utils'
import { z } from 'zod'
import { TableCellValidationErrorCode } from '../cell-validation'
import { PopulatedRecord } from '../record'

const coerceToString = z.preprocess(
    (v) => (v === null || v === undefined ? v : String(v)),
    z.string().nullable(),
)

export const CreateRecordsRequest = z.object({
    records: z.array(z.array(z.object({
        fieldId: z.string(),
        value: coerceToString,
    }))),
    tableId: z.string(),
})

export type CreateRecordsRequest = z.infer<typeof CreateRecordsRequest>

export const UpdateRecordRequest = z.object({
    cells: z.array(z.object({
        fieldId: z.string(),
        value: coerceToString,
    })).optional(),
    tableId: z.string(),
    agentUpdate: z.boolean().optional(),
})

export type UpdateRecordRequest = z.infer<typeof UpdateRecordRequest>


export enum FilterOperator {
    EQ = 'eq',
    NEQ = 'neq',
    GT = 'gt',
    GTE = 'gte',
    LT = 'lt',
    LTE = 'lte',
    CO = 'co',
    EXISTS = 'exists',
    NOT_EXISTS = 'not_exists',
}

const valueFilter = <T extends FilterOperator>(op: T) => z.object({
    fieldId: z.string(),
    operator: z.literal(op),
    value: z.string(),
})

const existenceFilter = <T extends FilterOperator>(op: T) => z.object({
    fieldId: z.string(),
    operator: z.literal(op),
})

export const Filter = z.discriminatedUnion('operator', [
    valueFilter(FilterOperator.EQ),
    valueFilter(FilterOperator.NEQ),
    valueFilter(FilterOperator.GT),
    valueFilter(FilterOperator.GTE),
    valueFilter(FilterOperator.LT),
    valueFilter(FilterOperator.LTE),
    valueFilter(FilterOperator.CO),
    existenceFilter(FilterOperator.EXISTS),
    existenceFilter(FilterOperator.NOT_EXISTS),
])

export type Filter = z.infer<typeof Filter>

export const ListRecordsRequest = z.object({
    tableId: z.string(),
    limit: z.coerce.number().optional(),
    cursor: z.string().optional(),
    filters: OptionalArrayFromQuery(Filter),
})

export type ListRecordsRequest = Omit<z.infer<typeof ListRecordsRequest>, 'cursor'> & { cursor: Cursor | undefined }

export const DeleteRecordsRequest = z.object({
    tableId: z.string(),
    ids: z.array(z.string()),
})

export type DeleteRecordsRequest = z.infer<typeof DeleteRecordsRequest>

export const BATCH_UPDATE_RECORDS_LIMIT = 200

export const BatchUpdateRecordsRequest = z.object({
    tableId: z.string(),
    records: z.array(z.object({
        recordId: z.string(),
        cells: z.array(z.object({
            fieldId: z.string(),
            value: coerceToString,
            baseUpdated: z.string().optional(),
        })).min(1),
    })).min(1).max(BATCH_UPDATE_RECORDS_LIMIT),
})

export type BatchUpdateRecordsRequest = z.infer<typeof BatchUpdateRecordsRequest>

export const BatchUpdateCellErrorCode = z.enum(['VALIDATION', 'CONFLICT', 'UNKNOWN_FIELD'])
export type BatchUpdateCellErrorCode = z.infer<typeof BatchUpdateCellErrorCode>

export const BatchUpdateCellError = z.object({
    fieldId: z.string(),
    code: BatchUpdateCellErrorCode,
    validationError: TableCellValidationErrorCode.optional(),
})

export type BatchUpdateCellError = z.infer<typeof BatchUpdateCellError>

export const BatchUpdateRecordErrorCode = z.enum(['VALIDATION', 'CONFLICT', 'NOT_FOUND', 'INTERNAL'])
export type BatchUpdateRecordErrorCode = z.infer<typeof BatchUpdateRecordErrorCode>

export const BatchUpdateRecordResult = z.object({
    recordId: z.string(),
    status: z.enum(['success', 'error']),
    record: PopulatedRecord.optional(),
    error: z.object({
        code: BatchUpdateRecordErrorCode,
        cells: z.array(BatchUpdateCellError).optional(),
    }).optional(),
})

export type BatchUpdateRecordResult = z.infer<typeof BatchUpdateRecordResult>

export const BatchUpdateRecordsResponse = z.object({
    results: z.array(BatchUpdateRecordResult),
})

export type BatchUpdateRecordsResponse = z.infer<typeof BatchUpdateRecordsResponse>

