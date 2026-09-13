import { apId } from '@activepieces/core-utils'
import { FieldType } from '@activepieces/shared'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { db } from '../../../helpers/db'
import { describeWithAuth } from '../../../helpers/describe-with-auth'
import {
    createMockCell,
    createMockField,
    createMockRecord,
    createMockTable,
} from '../../../helpers/mocks'
import { TestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance | null = null

beforeAll(async () => {
    app = await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

describe('Record Batch Update API', () => {

    describeWithAuth('POST /v1/records/batch', () => app!, (setup) => {
        it('should update multiple records in one call and return per-record results', async () => {
            const ctx = await setup()
            const { table, field } = await createTableWithTypedField({ ctx, type: FieldType.TEXT })
            const [recordOne, recordTwo] = await saveRecordsWithValues({ ctx, table, field, values: ['before1', 'before2'] })

            const response = await ctx.post('/v1/records/batch', {
                tableId: table.id,
                records: [
                    { recordId: recordOne.id, cells: [{ fieldId: field.id, value: 'after1' }] },
                    { recordId: recordTwo.id, cells: [{ fieldId: field.id, value: 'after2' }] },
                ],
            })

            expect(response?.statusCode).toBe(StatusCodes.OK)
            const body = response?.json()
            expect(body.results).toHaveLength(2)
            expect(body.results.map((result: { status: string }) => result.status)).toEqual(['success', 'success'])
            expect(body.results[0].record.cells[field.id].value).toBe('after1')
            expect(body.results[1].record.cells[field.id].value).toBe('after2')

            const persistedOne = await ctx.get(`/v1/records/${recordOne.id}`)
            expect(persistedOne?.json().cells[field.id].value).toBe('after1')
            const persistedTwo = await ctx.get(`/v1/records/${recordTwo.id}`)
            expect(persistedTwo?.json().cells[field.id].value).toBe('after2')
        })

        it('should keep per-record validation errors while other records succeed', async () => {
            const ctx = await setup()
            const { table, field } = await createTableWithTypedField({ ctx, type: FieldType.NUMBER })
            const [invalidRecord, validRecord] = await saveRecordsWithValues({ ctx, table, field, values: ['1', '2'] })

            const response = await ctx.post('/v1/records/batch', {
                tableId: table.id,
                records: [
                    { recordId: invalidRecord.id, cells: [{ fieldId: field.id, value: 'not-a-number' }] },
                    { recordId: validRecord.id, cells: [{ fieldId: field.id, value: '42' }] },
                ],
            })

            expect(response?.statusCode).toBe(StatusCodes.OK)
            const body = response?.json()
            expect(body.results).toHaveLength(2)

            const invalidResult = body.results[0]
            expect(invalidResult.status).toBe('error')
            expect(invalidResult.error.code).toBe('VALIDATION')
            expect(invalidResult.error.cells).toEqual([
                { fieldId: field.id, code: 'VALIDATION', validationError: 'INVALID_NUMBER' },
            ])

            const validResult = body.results[1]
            expect(validResult.status).toBe('success')
            expect(validResult.record.cells[field.id].value).toBe('42')

            const persistedInvalid = await ctx.get(`/v1/records/${invalidRecord.id}`)
            expect(persistedInvalid?.json().cells[field.id].value).toBe('1')
        })

        it('should reject dropdown values outside the field options', async () => {
            const ctx = await setup()
            const { table, field } = await createTableWithTypedField({ ctx, type: FieldType.STATIC_DROPDOWN })
            await db.update('field', field.id, { data: { options: [{ value: 'open' }, { value: 'closed' }] } })
            const [record] = await saveRecordsWithValues({ ctx, table, field, values: ['open'] })

            const response = await ctx.post('/v1/records/batch', {
                tableId: table.id,
                records: [
                    { recordId: record.id, cells: [{ fieldId: field.id, value: 'unknown-option' }] },
                ],
            })

            expect(response?.statusCode).toBe(StatusCodes.OK)
            const body = response?.json()
            expect(body.results[0].status).toBe('error')
            expect(body.results[0].error.cells).toEqual([
                { fieldId: field.id, code: 'VALIDATION', validationError: 'INVALID_DROPDOWN_OPTION' },
            ])
        })

        it('should reject invalid dates on DATE fields', async () => {
            const ctx = await setup()
            const { table, field } = await createTableWithTypedField({ ctx, type: FieldType.DATE })
            const [record] = await saveRecordsWithValues({ ctx, table, field, values: [''] })

            const response = await ctx.post('/v1/records/batch', {
                tableId: table.id,
                records: [
                    { recordId: record.id, cells: [{ fieldId: field.id, value: 'not a date' }] },
                ],
            })

            expect(response?.statusCode).toBe(StatusCodes.OK)
            const body = response?.json()
            expect(body.results[0].status).toBe('error')
            expect(body.results[0].error.cells).toEqual([
                { fieldId: field.id, code: 'VALIDATION', validationError: 'INVALID_DATE' },
            ])
        })

        it('should return CONFLICT when the record changed since baseUpdated, then succeed with the fresh token', async () => {
            const ctx = await setup()
            const { table, field } = await createTableWithTypedField({ ctx, type: FieldType.TEXT })
            const [record] = await saveRecordsWithValues({ ctx, table, field, values: ['original'] })

            const before = (await ctx.get(`/v1/records/${record.id}`))?.json()
            const staleToken = before.cells[field.id].updated

            const otherUserUpdate = await ctx.post(`/v1/records/${record.id}`, {
                tableId: table.id,
                cells: [{ fieldId: field.id, value: 'written by someone else' }],
            })
            expect(otherUserUpdate?.statusCode).toBe(StatusCodes.OK)

            const conflictResponse = await ctx.post('/v1/records/batch', {
                tableId: table.id,
                records: [
                    { recordId: record.id, cells: [{ fieldId: field.id, value: 'my overwrite', baseUpdated: staleToken }] },
                ],
            })

            expect(conflictResponse?.statusCode).toBe(StatusCodes.OK)
            const conflictBody = conflictResponse?.json()
            expect(conflictBody.results[0].status).toBe('error')
            expect(conflictBody.results[0].error.code).toBe('CONFLICT')
            expect(conflictBody.results[0].error.cells).toEqual([
                { fieldId: field.id, code: 'CONFLICT' },
            ])
            expect(conflictBody.results[0].record.cells[field.id].value).toBe('written by someone else')

            const persisted = await ctx.get(`/v1/records/${record.id}`)
            expect(persisted?.json().cells[field.id].value).toBe('written by someone else')

            const freshToken = conflictBody.results[0].record.cells[field.id].updated
            const forcedResponse = await ctx.post('/v1/records/batch', {
                tableId: table.id,
                records: [
                    { recordId: record.id, cells: [{ fieldId: field.id, value: 'my overwrite', baseUpdated: freshToken }] },
                ],
            })

            expect(forcedResponse?.statusCode).toBe(StatusCodes.OK)
            const forcedBody = forcedResponse?.json()
            expect(forcedBody.results[0].status).toBe('success')
            expect(forcedBody.results[0].record.cells[field.id].value).toBe('my overwrite')
        })

        it('should not conflict when baseUpdated matches the current cell', async () => {
            const ctx = await setup()
            const { table, field } = await createTableWithTypedField({ ctx, type: FieldType.TEXT })
            const [record] = await saveRecordsWithValues({ ctx, table, field, values: ['original'] })

            const before = (await ctx.get(`/v1/records/${record.id}`))?.json()
            const token = before.cells[field.id].updated

            const response = await ctx.post('/v1/records/batch', {
                tableId: table.id,
                records: [
                    { recordId: record.id, cells: [{ fieldId: field.id, value: 'updated', baseUpdated: token }] },
                ],
            })

            expect(response?.statusCode).toBe(StatusCodes.OK)
            expect(response?.json().results[0].status).toBe('success')
        })

        it('should return NOT_FOUND for a missing record without failing the other records', async () => {
            const ctx = await setup()
            const { table, field } = await createTableWithTypedField({ ctx, type: FieldType.TEXT })
            const [record] = await saveRecordsWithValues({ ctx, table, field, values: ['keep'] })

            const response = await ctx.post('/v1/records/batch', {
                tableId: table.id,
                records: [
                    { recordId: apId(), cells: [{ fieldId: field.id, value: 'ghost' }] },
                    { recordId: record.id, cells: [{ fieldId: field.id, value: 'updated' }] },
                ],
            })

            expect(response?.statusCode).toBe(StatusCodes.OK)
            const body = response?.json()
            expect(body.results[0].status).toBe('error')
            expect(body.results[0].error.code).toBe('NOT_FOUND')
            expect(body.results[1].status).toBe('success')

            const persisted = await ctx.get(`/v1/records/${record.id}`)
            expect(persisted?.json().cells[field.id].value).toBe('updated')
        })

        it('should return UNKNOWN_FIELD for cells whose field does not exist', async () => {
            const ctx = await setup()
            const { table, field } = await createTableWithTypedField({ ctx, type: FieldType.TEXT })
            const [record] = await saveRecordsWithValues({ ctx, table, field, values: ['keep'] })
            const unknownFieldId = apId()

            const response = await ctx.post('/v1/records/batch', {
                tableId: table.id,
                records: [
                    {
                        recordId: record.id,
                        cells: [
                            { fieldId: unknownFieldId, value: 'lost' },
                            { fieldId: field.id, value: 'not saved either' },
                        ],
                    },
                ],
            })

            expect(response?.statusCode).toBe(StatusCodes.OK)
            const body = response?.json()
            expect(body.results[0].status).toBe('error')
            expect(body.results[0].error.code).toBe('VALIDATION')
            expect(body.results[0].error.cells).toEqual([
                { fieldId: unknownFieldId, code: 'UNKNOWN_FIELD' },
            ])

            const persisted = await ctx.get(`/v1/records/${record.id}`)
            expect(persisted?.json().cells[field.id].value).toBe('keep')
        })

        it('should reject an empty records payload', async () => {
            const ctx = await setup()
            const { table } = await createTableWithTypedField({ ctx, type: FieldType.TEXT })

            const response = await ctx.post('/v1/records/batch', {
                tableId: table.id,
                records: [],
            })

            expect(response?.statusCode).toBe(StatusCodes.BAD_REQUEST)
        })
    })
})

async function createTableWithTypedField({ ctx, type }: { ctx: TestContext, type: FieldType }) {
    const table = createMockTable({ projectId: ctx.project.id })
    await db.save('table', table)
    const field = createMockField({ tableId: table.id, projectId: ctx.project.id })
    field.type = type
    await db.save('field', field)
    return { table, field }
}

async function saveRecordsWithValues({ ctx, table, field, values }: { ctx: TestContext, table: { id: string }, field: { id: string }, values: string[] }) {
    const records = values.map(() => createMockRecord({ tableId: table.id, projectId: ctx.project.id }))
    await db.save('record', records)
    const cells = records.map((record, index) => {
        const cell = createMockCell({ recordId: record.id, fieldId: field.id, projectId: ctx.project.id })
        cell.value = values[index]
        return cell
    })
    await db.save('cell', cells)
    return records
}
