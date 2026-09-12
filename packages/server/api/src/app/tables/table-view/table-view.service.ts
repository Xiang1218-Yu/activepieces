import {
    ActivepiecesError,
    apId,
    ErrorCode,
    isNil,
    sanitizeObjectForPostgresql,
} from '@activepieces/core-utils'
import {
    CreateTableViewRequest,
    Field,
    TableView,
    TableViewCondition,
    TableViewConditionIssue,
    TableViewConfig,
    UpdateTableViewRequest,
} from '@activepieces/shared'
import { repoFactory } from '../../core/db/repo-factory'
import { fieldService } from '../field/field.service'
import { tableService } from '../table/table.service'
import { TableViewEntity } from './table-view.entity'

const tableViewRepo = repoFactory(TableViewEntity)

export const tableViewService = {
    async create({
        projectId,
        request,
    }: CreateParams): Promise<TableView> {
        const { tableId } = request
        await assertTableExists({ projectId, tableId })
        const fields = await fieldService.getAll({ projectId, tableId })
        const config = normalizeConfig({
            config: request.config,
            fields,
        })
        const id = apId()
        await tableViewRepo().insert(
            sanitizeObjectForPostgresql({
                id,
                name: request.name,
                tableId,
                projectId,
                config,
                version: 0,
            }),
        )
        return this.getOneOrThrow({ projectId, id })
    },

    async list({
        projectId,
        tableId,
    }: ListParams): Promise<TableView[]> {
        const views = await tableViewRepo().find({
            where: { projectId, tableId },
            order: {
                created: 'ASC',
            },
        })
        const fields = await fieldService.getAll({ projectId, tableId })
        return views.map((view) => attachIssues({ view, fields }))
    },

    async getOneOrThrow({
        projectId,
        id,
    }: GetOneParams): Promise<TableView> {
        const view = await tableViewRepo().findOne({
            where: { projectId, id },
        })
        if (isNil(view)) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: {
                    entityType: 'TableView',
                    entityId: id,
                },
            })
        }
        const fields = await fieldService.getAll({
            projectId,
            tableId: view.tableId,
        })
        return attachIssues({ view, fields })
    },

    async update({
        projectId,
        id,
        request,
    }: UpdateParams): Promise<TableView> {
        const existing = await this.getStoredViewOrThrow({ projectId, id })
        const nextConfig = isNil(request.config)
            ? existing.config
            : normalizeConfig({
                config: request.config,
                fields: await fieldService.getAll({
                    projectId,
                    tableId: existing.tableId,
                }),
            })
        const result = await tableViewRepo()
            .createQueryBuilder()
            .update(TableViewEntity)
            .set(
                sanitizeObjectForPostgresql({
                    name: request.name ?? existing.name,
                    config: nextConfig,
                    version: existing.version + 1,
                }),
            )
            .where('id = :id AND "projectId" = :projectId AND version = :version', {
                id,
                projectId,
                version: request.expectedVersion,
            })
            .execute()

        if (!result.affected) {
            throw new ActivepiecesError({
                code: ErrorCode.VALIDATION,
                params: {
                    message: 'TABLE_VIEW_VERSION_CONFLICT',
                },
            })
        }

        return this.getOneOrThrow({ projectId, id })
    },

    async delete({
        projectId,
        id,
    }: DeleteParams): Promise<void> {
        const result = await tableViewRepo().delete({ projectId, id })
        if (result.affected === 0) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: {
                    entityType: 'TableView',
                    entityId: id,
                },
            })
        }
    },

    async getStoredViewOrThrow({
        projectId,
        id,
    }: GetOneParams): Promise<StoredTableView> {
        const view = await tableViewRepo().findOne({
            where: { projectId, id },
        })
        if (isNil(view)) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: {
                    entityType: 'TableView',
                    entityId: id,
                },
            })
        }
        return view
    },
}

async function assertTableExists({
    projectId,
    tableId,
}: {
    projectId: string
    tableId: string
}): Promise<void> {
    await tableService.getOneOrThrow({ projectId, id: tableId })
}

function normalizeConfig({
    config,
    fields,
}: {
    config: TableViewConfig
    fields: Field[]
}): TableViewConfig {
    const fieldById = new Map(fields.map((field) => [field.id, field]))
    return {
        filters: config.filters.map((condition) => {
            const field = fieldById.get(condition.fieldId)
            return {
                ...condition,
                fieldName: field?.name ?? condition.fieldName,
            }
        }),
        sorts: config.sorts.filter((sort) => fieldById.has(sort.fieldId)),
        hiddenFieldIds: config.hiddenFieldIds.filter((fieldId) => fieldById.has(fieldId)),
        pagination: {
            page: config.pagination.page,
            pageSize: config.pagination.pageSize,
        },
    }
}

function attachIssues({
    view,
    fields,
}: {
    view: StoredTableView
    fields: Field[]
}): TableView {
    const fieldById = new Map(fields.map((field) => [field.id, field]))
    const invalidConditions = view.config.filters.flatMap((condition) => {
        const field = fieldById.get(condition.fieldId)
        const issue = getConditionIssue({ condition, field })
        return isNil(issue)
            ? []
            : [{
                ...condition,
                issue,
                currentFieldType: field?.type,
            }]
    })
    return {
        ...view,
        invalidConditions,
    }
}

function getConditionIssue({
    condition,
    field,
}: {
    condition: TableViewCondition
    field?: Field
}): TableViewConditionIssue | null {
    if (isNil(field)) {
        return TableViewConditionIssue.FIELD_DELETED
    }
    if (field.type !== condition.fieldType) {
        return TableViewConditionIssue.FIELD_TYPE_CHANGED
    }
    return null
}

type StoredTableView = Omit<TableView, 'invalidConditions'>

type CreateParams = {
    projectId: string
    request: CreateTableViewRequest
}

type ListParams = {
    projectId: string
    tableId: string
}

type GetOneParams = {
    projectId: string
    id: string
}

type UpdateParams = {
    projectId: string
    id: string
    request: UpdateTableViewRequest
}

type DeleteParams = {
    projectId: string
    id: string
}
