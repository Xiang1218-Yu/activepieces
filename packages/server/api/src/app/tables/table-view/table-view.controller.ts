import { ApId, Permission } from '@activepieces/core-utils'
import {
    CreateTableViewRequest,
    ListTableViewsRequest,
    PrincipalType,
    SERVICE_KEY_SECURITY_OPENAPI,
    TableView,
    UpdateTableViewRequest,
} from '@activepieces/shared'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { StatusCodes } from 'http-status-codes'
import { z } from 'zod'
import { EntitySourceType, ProjectResourceType } from '../../core/security/authorization/common'
import { securityAccess } from '../../core/security/authorization/fastify-security'
import { TableEntity } from '../table/table.entity'
import { TableViewEntity } from './table-view.entity'
import { tableViewService } from './table-view.service'

export const tableViewController: FastifyPluginAsyncZod = async (fastify) => {
    fastify.post('/', CreateTableViewRoute, async (request, reply) => {
        const view = await tableViewService.create({
            projectId: request.projectId,
            request: request.body,
        })
        await reply.status(StatusCodes.CREATED).send(view)
    })

    fastify.get('/', ListTableViewsRoute, async (request) => {
        return tableViewService.list({
            projectId: request.projectId,
            tableId: request.query.tableId,
        })
    })

    fastify.get('/:id', GetTableViewRoute, async (request) => {
        return tableViewService.getOneOrThrow({
            projectId: request.projectId,
            id: request.params.id,
        })
    })

    fastify.post('/:id', UpdateTableViewRoute, async (request) => {
        return tableViewService.update({
            projectId: request.projectId,
            id: request.params.id,
            request: request.body,
        })
    })

    fastify.delete('/:id', DeleteTableViewRoute, async (request, reply) => {
        await tableViewService.delete({
            projectId: request.projectId,
            id: request.params.id,
        })
        await reply.status(StatusCodes.NO_CONTENT).send()
    })
}

const CreateTableViewRoute = {
    config: {
        security: securityAccess.project([PrincipalType.USER, PrincipalType.ENGINE, PrincipalType.SERVICE], Permission.WRITE_TABLE, {
            type: ProjectResourceType.TABLE,
            tableName: TableEntity,
            entitySourceType: EntitySourceType.BODY,
            lookup: {
                paramKey: 'tableId',
                entityField: 'id',
            },
        }),
    },
    schema: {
        tags: ['tables'],
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        body: CreateTableViewRequest,
        response: {
            [StatusCodes.CREATED]: TableView,
        },
    },
}

const ListTableViewsRoute = {
    config: {
        security: securityAccess.project([PrincipalType.USER, PrincipalType.ENGINE, PrincipalType.SERVICE], Permission.READ_TABLE, {
            type: ProjectResourceType.TABLE,
            tableName: TableEntity,
            entitySourceType: EntitySourceType.QUERY,
            lookup: {
                paramKey: 'tableId',
                entityField: 'id',
            },
        }),
    },
    schema: {
        tags: ['tables'],
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        querystring: ListTableViewsRequest,
        response: {
            [StatusCodes.OK]: z.array(TableView),
        },
    },
}

const GetTableViewRoute = {
    config: {
        security: securityAccess.project([PrincipalType.USER, PrincipalType.ENGINE, PrincipalType.SERVICE], Permission.READ_TABLE, {
            type: ProjectResourceType.TABLE,
            tableName: TableViewEntity,
        }),
    },
    schema: {
        tags: ['tables'],
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        params: z.object({
            id: ApId,
        }),
        response: {
            [StatusCodes.OK]: TableView,
        },
    },
}

const UpdateTableViewRoute = {
    config: {
        security: securityAccess.project([PrincipalType.USER, PrincipalType.ENGINE, PrincipalType.SERVICE], Permission.WRITE_TABLE, {
            type: ProjectResourceType.TABLE,
            tableName: TableViewEntity,
        }),
    },
    schema: {
        tags: ['tables'],
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        params: z.object({
            id: ApId,
        }),
        body: UpdateTableViewRequest,
        response: {
            [StatusCodes.OK]: TableView,
        },
    },
}

const DeleteTableViewRoute = {
    config: {
        security: securityAccess.project([PrincipalType.USER, PrincipalType.ENGINE, PrincipalType.SERVICE], Permission.WRITE_TABLE, {
            type: ProjectResourceType.TABLE,
            tableName: TableViewEntity,
        }),
    },
    schema: {
        tags: ['tables'],
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        params: z.object({
            id: ApId,
        }),
        response: {
            [StatusCodes.NO_CONTENT]: z.never(),
        },
    },
}
