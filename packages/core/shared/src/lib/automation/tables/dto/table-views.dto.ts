import { z } from 'zod'
import { TableViewConfig } from '../table-view'

export const ListTableViewsRequest = z.object({
    tableId: z.string(),
})

export type ListTableViewsRequest = z.infer<typeof ListTableViewsRequest>

export const CreateTableViewRequest = z.object({
    projectId: z.string(),
    tableId: z.string(),
    name: z.string().min(1).max(200),
    config: TableViewConfig,
})

export type CreateTableViewRequest = z.infer<typeof CreateTableViewRequest>

export const UpdateTableViewRequest = z.object({
    projectId: z.string(),
    name: z.string().min(1).max(200).optional(),
    config: TableViewConfig.optional(),
    expectedVersion: z.number().int().nonnegative(),
})

export type UpdateTableViewRequest = z.infer<typeof UpdateTableViewRequest>
