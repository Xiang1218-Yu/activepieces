import { ActivepiecesError, apId, assertNotNullOrUndefined, ErrorCode, isNil } from '@activepieces/core-utils'
import { CreateFieldRequest, Field, FieldState, FieldType, StaticDropdownOption, UpdateFieldRequest } from '@activepieces/shared'
import { In } from 'typeorm'
import { repoFactory } from '../../core/db/repo-factory'
import { system } from '../../helper/system/system'
import { AppSystemProp } from '../../helper/system/system-props'
import { FieldEntity } from './field.entity'

const fieldRepo = repoFactory<Field>(FieldEntity)

export const fieldService = {
    async create({ request, projectId }: CreateParams): Promise<Field> {
        await this.validateCount({ projectId, tableId: request.tableId })
        const maxPosition = await fieldRepo().maximum('position', { projectId, tableId: request.tableId })
        const field = await fieldRepo().save({
            ...request,
            position: request.position ?? (maxPosition ?? -1) + 1,
            projectId,
            id: apId(),
            externalId: request.externalId ?? apId(),
        })
        return field
    },

    async createFromState({ projectId, field, tableId, position }: CreateFromStateParams): Promise<Field> {
        switch (field.type) {
            case FieldType.STATIC_DROPDOWN: {
                assertNotNullOrUndefined(field.data, 'Data is required for static dropdown field')
                return this.create({
                    projectId,
                    request: {
                        name: field.name,
                        type: field.type,
                        tableId,
                        data: field.data,
                        externalId: field.externalId,
                        position,
                    },
                })
            }
            case FieldType.DATE:
            case FieldType.DATETIME:
            case FieldType.NUMBER:
            case FieldType.TEXT: {
                return this.create({
                    projectId,
                    request: {
                        name: field.name,
                        type: field.type,
                        tableId,
                        externalId: field.externalId,
                        position,
                    },
                })
            }
            default: {
                throw new ActivepiecesError({
                    code: ErrorCode.VALIDATION,
                    params: {
                        message: `Unsupported field type: ${field.type}`,
                    },
                })
            }
        }
    },

    async getAll({ projectId, tableId }: GetAllParams): Promise<Field[]> {
        return fieldRepo().find({
            where: { projectId, tableId },
            order: {
                position: 'ASC',
                created: 'ASC',
            },
        })
    },

    async getAllByTableIds({ projectId, tableIds }: GetAllByTableIdsParams): Promise<Map<string, Field[]>> {
        const fields = await fieldRepo().find({
            where: { projectId, tableId: In(tableIds) },
            order: {
                position: 'ASC',
                created: 'ASC',
            },
        })
        const result = new Map<string, Field[]>()
        for (const tableId of tableIds) {
            result.set(tableId, [])
        }
        for (const field of fields) {
            result.get(field.tableId)?.push(field)
        }
        return result
    },

    async getById({ id, projectId }: GetByIdParams): Promise<Field> {
        const field = await fieldRepo().findOne({
            where: { id, projectId },
        })

        if (isNil(field)) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: {
                    entityType: 'Field',
                    entityId: id,
                },
            })
        }

        return field
    },

    async delete({ id, projectId }: DeleteParams): Promise<void> {
        await fieldRepo().delete({
            id,
            projectId,
        })
    },

    async update({ id, projectId, request }: UpdateParams): Promise<Field> {
        const field = await this.getById({ id, projectId })
        if (!isNil(request.data)) {
            const options = validateAndNormalizeDropdownOptions({ field, options: request.data.options })
            // Single atomic jsonb replace: no read-modify-write, so a
            // concurrent update can never be partially overwritten.
            await fieldRepo().update({
                id,
                projectId,
            }, {
                data: { options },
            })
        }
        if (!isNil(request.name)) {
            await fieldRepo().update({
                id,
                projectId,
            }, {
                name: request.name,
            })
        }
        return this.getById({ id, projectId })
    },

    async reorder({ projectId, tableId, fieldIds }: ReorderParams): Promise<Field[]> {
        await fieldRepo().query(
            `
            UPDATE "field" AS f
            SET "position" = ordering.ord - 1
            FROM unnest($1::text[]) WITH ORDINALITY AS ordering(id, ord)
            WHERE f."id" = ordering.id
              AND f."projectId" = $2
              AND f."tableId" = $3
              AND f."position" IS DISTINCT FROM ordering.ord - 1
            `,
            [fieldIds, projectId, tableId],
        )
        return this.getAll({ projectId, tableId })
    },

    async count({ projectId, tableId }: CountParams): Promise<number> {
        return fieldRepo().count({
            where: { projectId, tableId },
        })
    },
    async validateCount({ projectId, tableId, insertCount = 1 }: ValidateCountParams): Promise<void> {
        const countRes = await this.count({ projectId, tableId })
        if (countRes + insertCount > system.getNumberOrThrow(AppSystemProp.MAX_FIELDS_PER_TABLE)) {
            throw new ActivepiecesError({
                code: ErrorCode.VALIDATION,
                params: { message: `Max fields per table reached: ${system.getNumberOrThrow(AppSystemProp.MAX_FIELDS_PER_TABLE)}`,
                },
            })
        }
    },
}

function validateAndNormalizeDropdownOptions({ field, options }: { field: Field, options: StaticDropdownOption[] }): StaticDropdownOption[] {
    if (field.type !== FieldType.STATIC_DROPDOWN) {
        throw new ActivepiecesError({
            code: ErrorCode.VALIDATION,
            params: {
                message: `Options can only be updated for static dropdown fields, field "${field.name}" (${field.id}) is of type ${field.type}`,
            },
        })
    }
    if (options.length === 0) {
        throw new ActivepiecesError({
            code: ErrorCode.VALIDATION,
            params: {
                message: `Dropdown field "${field.name}" (${field.id}) must have at least one option`,
            },
        })
    }
    const seenValues = new Set<string>()
    return options.map((option) => {
        const value = option.value.trim()
        if (value.length === 0) {
            throw new ActivepiecesError({
                code: ErrorCode.VALIDATION,
                params: {
                    message: `Dropdown field "${field.name}" (${field.id}) has an empty option value`,
                },
            })
        }
        if (seenValues.has(value)) {
            throw new ActivepiecesError({
                code: ErrorCode.VALIDATION,
                params: {
                    message: `Dropdown field "${field.name}" (${field.id}) has a duplicate option value: "${value}"`,
                },
            })
        }
        seenValues.add(value)
        // Normalize legacy options (no `disabled` key) to an explicit flag on write
        return { value, disabled: option.disabled === true }
    })
}

type CreateParams = {
    projectId: string
    request: CreateFieldRequest
}

type CreateFromStateParams = {
    projectId: string
    field: FieldState
    tableId: string
    position?: number
}

type GetAllParams = {
    projectId: string
    tableId: string
}

type GetAllByTableIdsParams = {
    projectId: string
    tableIds: string[]
}

type GetByIdParams = {
    id: string
    projectId: string
}

type DeleteParams = {
    id: string
    projectId: string
}

type UpdateParams = {
    id: string
    projectId: string
    request: UpdateFieldRequest
}

type ReorderParams = {
    projectId: string
    tableId: string
    fieldIds: string[]
}

type CountParams = {
    projectId: string
    tableId: string
}

type ValidateCountParams = {
    projectId: string
    tableId: string
    insertCount?: number
}
