import { ActivepiecesError, apId, chunk, Cursor, ErrorCode, isNil, SeekPage, tryCatch } from '@activepieces/core-utils'
import { BatchUpdateCellError, BatchUpdateRecordResult, BatchUpdateRecordsRequest, BatchUpdateRecordsResponse, Cell, CreateRecordsRequest, Field, FieldType, Filter, FilterOperator, PopulatedRecord, tableCellValidation, TableWebhookEventType, UpdateRecordRequest } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { EntityManager, In } from 'typeorm'
import { repoFactory } from '../../core/db/repo-factory'
import { transaction } from '../../core/db/transaction'
import { system } from '../../helper/system/system'
import { AppSystemProp } from '../../helper/system/system-props'
import { FieldEntity } from '../field/field.entity'
import { fieldService } from '../field/field.service'
import { tableService } from '../table/table.service'
import { CellEntity } from './cell.entity'
import { RecordEntity, RecordSchema } from './record.entity'

const MAX_BATCH_SIZE = 50

const recordRepo = repoFactory(RecordEntity)
const cellsRepo = repoFactory(CellEntity)

export const recordService = {
    async create({
        request,
        projectId,
        fields,
    }: CreateParams): Promise<PopulatedRecord[]> {
        await this.validateCount({ projectId, tableId: request.tableId }, request.records.length)
        const existingFields = fields ?? await fieldService.getAll({
            tableId: request.tableId,
            projectId,
        })

        const validRecords = request.records.map((recordData) =>
            recordData.filter((cellData) =>
                existingFields.some((field) => field.id === cellData.fieldId),
            ),
        )

        let insertedRecordIds: string[] = []
        insertedRecordIds = await transaction(async (entityManager: EntityManager) => {
            const batches = chunk(validRecords, MAX_BATCH_SIZE)
            const records: RecordSchema[] = []
            const insertedRecordIds: string[] = []

            for (const batch of batches) {
                const now = new Date(new Date().getTime() + records.length)
                const recordInsertions = prepareRecordInsertions(batch, request.tableId, projectId, now)
                await entityManager.getRepository(RecordEntity).insert(recordInsertions)

                const cellInsertions = prepareCellInsertions(batch, recordInsertions, projectId)
                await entityManager.getRepository(CellEntity).insert(cellInsertions)

                insertedRecordIds.push(...recordInsertions.map((r) => r.id))
            }

            return insertedRecordIds
        })

        const insertedRecords = await recordRepo().find({
            where: { id: In(insertedRecordIds), tableId: request.tableId, projectId },
            relations: ['cells'],
            order: {
                created: 'ASC',
            },
        })
        return formatRecordsAndFetchField({ records: insertedRecords, tableId: request.tableId, projectId, fields: existingFields })
    },

    async list({
        tableId,
        projectId,
        filters,
        limit,
        fields: prefetchedFields,
    }: ListParams): Promise<SeekPage<PopulatedRecord>> {
        const fields = prefetchedFields ?? await fieldService.getAll({
            tableId,
            projectId,
        })
        const records = await recordRepo().find({
            where: {
                projectId,
                tableId,
            },
            order: {
                created: 'ASC',
            },
        })

        const cells = await cellsRepo().find({
            where: {
                projectId,
                fieldId: In(fields.map((field) => field.id)),
                recordId: In(records.map((record) => record.id)),
            },
        })
        const cellsByRecordId = new Map<string, typeof cells>()
        for (const cell of cells) {
            const group = cellsByRecordId.get(cell.recordId)
            if (group) {
                group.push(cell)
            }
            else {
                cellsByRecordId.set(cell.recordId, [cell])
            }
        }
        for (const record of records) {
            record.cells = cellsByRecordId.get(record.id) ?? []
        }
        const fieldTypeById = new Map(fields.map((field) => [field.id, field.type]))
        const filteredOutRecords = records.filter((record) => {
            if (!filters || filters.length === 0) {
                return true
            }
            return filters.every((filter) => {
                const cell = record.cells.find(c => c.fieldId === filter.fieldId)
                    ?? { fieldId: filter.fieldId, value: '' }
                return doesCellValueMatchFilter({ cell, filter, fieldType: fieldTypeById.get(filter.fieldId) })
            })
        })

        const populatedRecords = await formatRecordsAndFetchField({ records: filteredOutRecords, tableId, projectId, fields })

        return {
            data: populatedRecords.slice(0, limit),
            next: null,
            previous: null,
        }
    },

    async getById({
        id,
        projectId,
    }: GetByIdParams): Promise<PopulatedRecord> {
        const record = await recordRepo().findOne({
            where: { id, projectId },
            relations: ['cells'],
        })

        if (isNil(record)) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: {
                    entityType: 'Record',
                    entityId: id,
                },
            })
        }

        const result = await formatRecordsAndFetchField({ records: [record], tableId: record.tableId, projectId: record.projectId })
        return result[0]
    },

    async update({
        id,
        projectId,
        request,
    }: UpdateParams): Promise<PopulatedRecord> {
        const { tableId } = request
        return transaction(async (entityManager: EntityManager) => {
            const record = await entityManager.getRepository(RecordEntity).findOne({
                where: { projectId, tableId, id },
            })

            if (isNil(record)) {
                throw new ActivepiecesError({
                    code: ErrorCode.ENTITY_NOT_FOUND,
                    params: {
                        entityType: 'Record',
                        entityId: id,
                    },
                })
            }

            if (request.cells && request.cells.length > 0) {
                const existingFields = await entityManager
                    .getRepository(FieldEntity)
                    .find({
                        where: { projectId, tableId },
                    })

                // Filter out cells with non-existing fields
                const validCells = request.cells.filter((cellData) =>
                    existingFields.some((field) => field.id === cellData.fieldId),
                )

                // Prepare cells for upsert
                const cellsToUpsert = validCells.map((cellData) => {
                    return {
                        recordId: id,
                        fieldId: cellData.fieldId,
                        projectId,
                        value: cellData.value ?? '',
                        id: apId(),
                    }
                })

                // Perform bulk upsert only for valid cells
                if (cellsToUpsert.length > 0) {
                    await entityManager
                        .getRepository(CellEntity)
                        .upsert(cellsToUpsert, ['projectId', 'fieldId', 'recordId'])
                }
            }

            // Fetch and return the updated record with full details
            const updatedRecord = await entityManager
                .getRepository(RecordEntity)
                .findOne({
                    where: { id, projectId, tableId },
                    relations: ['cells'],
                })

            if (isNil(updatedRecord)) {
                throw new ActivepiecesError({
                    code: ErrorCode.ENTITY_NOT_FOUND,
                    params: {
                        entityType: 'Record',
                        entityId: id,
                    },
                })
            }

            const result = await formatRecordsAndFetchField({ records: [updatedRecord], tableId: updatedRecord.tableId, projectId: updatedRecord.projectId })
            return result[0]
        })
    },

    async batchUpdate({
        request,
        projectId,
    }: BatchUpdateParams): Promise<BatchUpdateRecordsResponse> {
        const fields = await fieldService.getAll({
            tableId: request.tableId,
            projectId,
        })
        const results: BatchUpdateRecordResult[] = []
        for (const item of request.records) {
            const { data: result, error } = await tryCatch(() => updateRecordFromBatchItem({ item, tableId: request.tableId, projectId, fields }))
            if (error) {
                results.push({
                    recordId: item.recordId,
                    status: 'error',
                    error: { code: 'INTERNAL' },
                })
            }
            else {
                results.push(result)
            }
        }
        return { results }
    },

    async delete({
        ids,
        projectId,
        tableId,
    }: DeleteParams): Promise<DeleteRecordsResult> {
        const uniqueIds = [...new Set(ids)]
        if (uniqueIds.length === 0) {
            return { deletedCount: 0, records: [] }
        }
        const maxRecordsPerTable = system.getNumberOrThrow(AppSystemProp.MAX_RECORDS_PER_TABLE)
        if (uniqueIds.length > maxRecordsPerTable) {
            throw new ActivepiecesError({
                code: ErrorCode.VALIDATION,
                params: {
                    message: `Max records per delete request reached: ${maxRecordsPerTable}`,
                },
            })
        }
        const { deletedIds, records } = await deleteRecordsAndReturnWebhookPayloads({
            projectId,
            tableId,
            recordIds: uniqueIds,
        })
        if (deletedIds.length === 0) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: { entityType: 'Record', entityId: uniqueIds[0] },
            })
        }
        return {
            deletedCount: deletedIds.length,
            records,
        }
    },

    async deleteAll({
        tableId,
        projectId,
    }: DeleteAllParams): Promise<PopulatedRecord[]> {
        const { records } = await deleteRecordsAndReturnWebhookPayloads({ projectId, tableId })
        return records
    },

    async count({ projectId, tableId }: CountParams): Promise<number> {
        return recordRepo().count({
            where: { projectId, tableId },
        })
    },
    async validateCount(params: CountParams, insertCount: number): Promise<void> {
        const countRes = await this.count(params)
        if (countRes + insertCount > system.getNumberOrThrow(AppSystemProp.MAX_RECORDS_PER_TABLE)) {
            throw new ActivepiecesError({
                code: ErrorCode.VALIDATION,
                params: {
                    message: `Max records per table reached: ${system.getNumberOrThrow(AppSystemProp.MAX_RECORDS_PER_TABLE)}`,
                },
            })
        }
    },
}

async function updateRecordFromBatchItem({ item, tableId, projectId, fields }: UpdateRecordFromBatchItemParams): Promise<BatchUpdateRecordResult> {
    const cellErrors = validateBatchItemCells({ cells: item.cells, fields })
    if (cellErrors.length > 0) {
        return {
            recordId: item.recordId,
            status: 'error',
            error: { code: 'VALIDATION', cells: cellErrors },
        }
    }
    return transaction(async (entityManager: EntityManager) => {
        const record = await entityManager.getRepository(RecordEntity).findOne({
            where: { id: item.recordId, projectId, tableId },
            lock: { mode: 'pessimistic_write' },
        })
        if (isNil(record)) {
            return {
                recordId: item.recordId,
                status: 'error',
                error: { code: 'NOT_FOUND' },
            }
        }
        const existingCells = await entityManager.getRepository(CellEntity).find({
            where: { recordId: record.id, projectId },
        })
        const conflictingCells = findConflictingCells({ cells: item.cells, existingCells })
        if (conflictingCells.length > 0) {
            return {
                recordId: item.recordId,
                status: 'error',
                error: { code: 'CONFLICT', cells: conflictingCells },
                record: formatRecords([{ ...record, cells: existingCells }], fields)[0],
            }
        }
        const cellsToUpsert = item.cells.map((cellData) => ({
            recordId: record.id,
            fieldId: cellData.fieldId,
            projectId,
            value: cellData.value ?? '',
            id: apId(),
            updated: new Date().toISOString(),
        }))
        await entityManager.getRepository(CellEntity).upsert(cellsToUpsert, ['projectId', 'fieldId', 'recordId'])
        const updatedCells = await entityManager.getRepository(CellEntity).find({
            where: { recordId: record.id, projectId },
        })
        return {
            recordId: item.recordId,
            status: 'success',
            record: formatRecords([{ ...record, cells: updatedCells }], fields)[0],
        }
    })
}

function validateBatchItemCells({ cells, fields }: { cells: BatchUpdateItemCell[], fields: Field[] }): BatchUpdateCellError[] {
    const fieldById = new Map(fields.map((field) => [field.id, field]))
    return cells
        .map((cell): BatchUpdateCellError | null => {
            const field = fieldById.get(cell.fieldId)
            if (isNil(field)) {
                return { fieldId: cell.fieldId, code: 'UNKNOWN_FIELD' }
            }
            const validationError = tableCellValidation.validate({
                fieldType: field.type,
                value: cell.value ?? '',
                options: field.type === FieldType.STATIC_DROPDOWN ? field.data.options.map((option) => option.value) : undefined,
            })
            if (isNil(validationError)) {
                return null
            }
            return { fieldId: cell.fieldId, code: 'VALIDATION', validationError }
        })
        .filter((error): error is BatchUpdateCellError => !isNil(error))
}

function findConflictingCells({ cells, existingCells }: { cells: BatchUpdateItemCell[], existingCells: Cell[] }): BatchUpdateCellError[] {
    return cells
        .filter((cell) => {
            if (isNil(cell.baseUpdated)) {
                return false
            }
            const existingCell = existingCells.find((existing) => existing.fieldId === cell.fieldId)
            if (isNil(existingCell)) {
                return false
            }
            return new Date(existingCell.updated).getTime() !== new Date(cell.baseUpdated).getTime()
        })
        .map((cell) => ({ fieldId: cell.fieldId, code: 'CONFLICT' }))
}

function prepareRecordInsertions(
    records: Array<Array<{ fieldId: string, value: string | null }>>,
    tableId: string,
    projectId: string,
    baseDate: Date,
): RecordInsertion[] {
    return records.map((_, index) => {
        const created = new Date(baseDate.getTime() + index).toISOString()
        return {
            tableId,
            projectId,
            created,
            id: apId(),
        }
    })
}

function prepareCellInsertions(
    records: Array<Array<{ fieldId: string, value: string | null }>>,
    recordInsertions: RecordInsertion[],
    projectId: string,
): CellInsertion[] {
    return records.flatMap((recordData, index) =>
        recordData.map((cellData) => {
            return {
                recordId: recordInsertions[index].id,
                fieldId: cellData.fieldId,
                projectId,
                value: cellData.value ?? '',
                id: apId(),
            }
        }),
    )
}

async function loadRecordsForDeleteWebhook({
    projectId,
    tableId,
    recordIds,
}: {
    projectId: string
    tableId: string
    recordIds?: string[]
}): Promise<RecordSchema[]> {
    const webhooks = await tableService.getWebhooks({
        projectId,
        id: tableId,
        events: [TableWebhookEventType.RECORD_DELETED],
    })
    if (webhooks.length === 0) {
        return []
    }
    return recordRepo().find({
        where: isNil(recordIds) ? { projectId, tableId } : { id: In(recordIds), projectId, tableId },
        relations: ['cells'],
    })
}

async function deleteRecordsReturningIds({
    projectId,
    tableId,
    recordIds,
}: {
    projectId: string
    tableId: string
    recordIds?: string[]
}): Promise<string[]> {
    const result = await recordRepo()
        .createQueryBuilder()
        .delete()
        .where(isNil(recordIds) ? { projectId, tableId } : { id: In(recordIds), projectId, tableId })
        .returning('id')
        .execute()
    const deletedRows: unknown = result.raw
    if (!Array.isArray(deletedRows)) {
        return []
    }
    return deletedRows.filter(isRowWithId).map((row) => row.id)
}

function isRowWithId(row: unknown): row is { id: string } {
    return typeof row === 'object' && !isNil(row) && typeof Reflect.get(row, 'id') === 'string'
}

async function deleteRecordsAndReturnWebhookPayloads({
    projectId,
    tableId,
    recordIds,
}: {
    projectId: string
    tableId: string
    recordIds?: string[]
}): Promise<{ deletedIds: string[], records: PopulatedRecord[] }> {
    const snapshot = await loadRecordsForDeleteWebhook({ projectId, tableId, recordIds })
    const deletedIds = await deleteRecordsReturningIds({ projectId, tableId, recordIds })
    const deletedIdSet = new Set(deletedIds)
    const deletedRecords = snapshot.filter((record) => deletedIdSet.has(record.id))
    return {
        deletedIds,
        records: await formatRecordsAndFetchField({ records: deletedRecords, tableId, projectId }),
    }
}

async function formatRecordsAndFetchField({ records, tableId, projectId, fields: prefetchedFields }: { records: RecordSchema[], tableId: string, projectId: string, fields?: Field[] }): Promise<PopulatedRecord[]> {
    if (records.length === 0) {
        return []
    }
    const fields = prefetchedFields ?? await fieldService.getAll({
        tableId,
        projectId,
    })
    return formatRecords(records, fields)
}

function formatRecords(records: RecordSchema[], fields: Field[]): PopulatedRecord[] {
    const fieldsNamesMap: Record<string, string> = fields.reduce((acc, field) => {
        acc[field.id] = field.name
        return acc
    }, {} as Record<string, string>)
    return records.map((record) => {
        const cells = record.cells.reduce<PopulatedRecord['cells']>((acc, cell) => {
            acc[cell.fieldId] = {
                fieldName: fieldsNamesMap[cell.fieldId],
                value: cell.value,
                updated: cell.updated,
                created: cell.created,
            }
            return acc
        }, {})
        for (const field of fields) {
            if (!(field.id in cells)) {
                cells[field.id] = {
                    fieldName: field.name,
                    value: null,
                    updated: record.updated,
                    created: record.created,
                }
            }
        }
        return {
            ...record,
            cells,
        }
    })
}

function doesCellValueMatchFilter({ cell, filter, fieldType }: DoesCellValueMatchFilterParams): boolean {
    const compareOrdered = isDateFieldType(fieldType) ? dateFilterValidator : numberFilterValidator
    switch (filter.operator) {
        case FilterOperator.EXISTS: {
            return cell.value !== null && cell.value !== ''
        }
        case FilterOperator.NOT_EXISTS: {
            return cell.value === null || cell.value === ''
        }
        case FilterOperator.EQ: {
            return cell.value === filter.value
        }
        case FilterOperator.NEQ: {
            return cell.value !== filter.value
        }
        case FilterOperator.GT: {
            return compareOrdered({ cellValue: cell.value, filterValue: filter.value, cb: ({ cellValue, filterValue }) => cellValue > filterValue })
        }
        case FilterOperator.GTE: {
            return compareOrdered({ cellValue: cell.value, filterValue: filter.value, cb: ({ cellValue, filterValue }) => cellValue >= filterValue })
        }
        case FilterOperator.LT: {
            return compareOrdered({ cellValue: cell.value, filterValue: filter.value, cb: ({ cellValue, filterValue }) => cellValue < filterValue })
        }
        case FilterOperator.LTE: {
            return compareOrdered({ cellValue: cell.value, filterValue: filter.value, cb: ({ cellValue, filterValue }) => cellValue <= filterValue })
        }
        case FilterOperator.CO: {
            if (typeof cell.value === 'string') {
                return cell.value.toLowerCase().includes(filter.value.toLowerCase())
            }
            return false
        }
    }
}

const numberFilterValidator = ({ cellValue, filterValue, cb }: OrderedFilterValidatorParams) => {
    if (typeof cellValue === 'string' || typeof cellValue === 'number') {
        const cv = parseFloat(String(cellValue))
        const fv = parseFloat(filterValue)
        if (isNaN(cv) || isNaN(fv)) {
            return false
        }
        return cb({ cellValue: cv, filterValue: fv })
    }
    return false
}

const dateFilterValidator = ({ cellValue, filterValue, cb }: OrderedFilterValidatorParams) => {
    if (typeof cellValue !== 'string') {
        return false
    }
    const cv = Date.parse(cellValue)
    const fv = Date.parse(filterValue)
    if (isNaN(cv) || isNaN(fv)) {
        return false
    }
    return cb({ cellValue: cv, filterValue: fv })
}

const isDateFieldType = (fieldType: FieldType | undefined): boolean => fieldType === FieldType.DATE || fieldType === FieldType.DATETIME

type CreateParams = {
    request: CreateRecordsRequest
    projectId: string
    logger: FastifyBaseLogger
    fields?: Field[]
}

type ListParams = {
    tableId: string
    projectId: string
    cursorRequest: Cursor | null
    limit: number
    filters: Filter[] | null
    fields?: Field[]
}

type GetByIdParams = {
    id: string
    projectId: string
}

type UpdateParams = {
    id: string
    projectId: string
    request: UpdateRecordRequest
}

type BatchUpdateParams = {
    request: BatchUpdateRecordsRequest
    projectId: string
}

type BatchUpdateItemCell = BatchUpdateRecordsRequest['records'][number]['cells'][number]

type UpdateRecordFromBatchItemParams = {
    item: BatchUpdateRecordsRequest['records'][number]
    tableId: string
    projectId: string
    fields: Field[]
}

type DeleteParams = {
    ids: string[]
    projectId: string
    tableId: string
}

type DeleteRecordsResult = {
    deletedCount: number
    records: PopulatedRecord[]
}

type DeleteAllParams = {
    tableId: string
    projectId: string
}

type CountParams = {
    projectId: string
    tableId: string
}

type RecordInsertion = {
    id: string
    tableId: string
    projectId: string
    created: string
}

type CellInsertion = {
    id: string
    recordId: string
    fieldId: string
    projectId: string
    value: string
}

type DoesCellValueMatchFilterParams = {
    cell: Pick<Cell, 'value'>
    filter: Filter
    fieldType: FieldType | undefined
}

type OrderedFilterValidatorParams = {
    cellValue: unknown
    filterValue: string
    cb: ({ cellValue, filterValue }: { cellValue: number, filterValue: number }) => boolean
}
