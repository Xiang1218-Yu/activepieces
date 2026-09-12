import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { entitiesMustBeOwnedByCurrentProject } from '../authentication/authorization'
import { fieldController } from './field/field.controller'
import { recordController } from './record/record.controller'
import { tableViewController } from './table-view/table-view.controller'
import { tablesController } from './table/table.controller'

export const tablesModule: FastifyPluginAsyncZod = async (app) => {
    app.addHook('preSerialization', entitiesMustBeOwnedByCurrentProject)

    await app.register(tablesController, { prefix: '/v1/tables' })
    await app.register(fieldController, { prefix: '/v1/fields' })
    await app.register(recordController, { prefix: '/v1/records' })
    await app.register(tableViewController, { prefix: '/v1/table-views' })
}
