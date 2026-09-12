import { WebhookRequestCapture } from '@activepieces/shared'
import { EntitySchema } from 'typeorm'
import { BaseColumnSchemaPart } from '../../database/database-common'

export type WebhookRequestCaptureSchema = WebhookRequestCapture

export const WebhookRequestCaptureEntity = new EntitySchema<WebhookRequestCaptureSchema>({
    name: 'webhook_request_capture',
    columns: {
        ...BaseColumnSchemaPart,
        projectId: {
            type: String,
            nullable: false,
        },
        platformId: {
            type: String,
            nullable: false,
        },
        flowId: {
            type: String,
            nullable: false,
        },
        requestId: {
            type: String,
            nullable: false,
        },
        method: {
            type: String,
            nullable: false,
        },
        path: {
            type: String,
            nullable: false,
        },
        headers: {
            type: 'jsonb',
            nullable: false,
        },
        maskedHeaders: {
            type: 'jsonb',
            nullable: false,
            default: '[]',
        },
        queryParams: {
            type: 'jsonb',
            nullable: false,
        },
        body: {
            type: 'jsonb',
            nullable: false,
        },
        clientIpPrefix: {
            type: String,
            nullable: true,
        },
        responseStatus: {
            type: Number,
            nullable: true,
        },
        environment: {
            type: String,
            nullable: false,
        },
        testInput: {
            type: 'jsonb',
            nullable: true,
        },
    },
    indices: [
        {
            columns: ['projectId', 'created'],
            name: 'idx_webhook_capture_project_created',
        },
        {
            columns: ['projectId', 'flowId', 'created'],
            name: 'idx_webhook_capture_project_flow_created',
        },
        {
            columns: ['projectId', 'requestId'],
            name: 'idx_webhook_capture_project_request',
        },
    ],
})
