import { AuditLogExport, AuditLogExportFormat, AuditLogExportStatus, Platform } from '@activepieces/shared'
import { EntitySchema } from 'typeorm'
import { BaseColumnSchemaPart } from '../../database/database-common'

type AuditLogExportSchema = AuditLogExport & {
    platform: Platform
}

export const AuditLogExportEntity = new EntitySchema<AuditLogExportSchema>({
    name: 'audit_log_export',
    columns: {
        ...BaseColumnSchemaPart,
        platformId: {
            type: String,
        },
        requestedById: {
            type: String,
            nullable: true,
        },
        format: {
            type: String,
            default: AuditLogExportFormat.CSV,
        },
        status: {
            type: String,
            default: AuditLogExportStatus.PENDING,
        },
        fileId: {
            type: String,
            nullable: true,
        },
        fileName: {
            type: String,
            nullable: true,
        },
        filters: {
            type: 'jsonb',
            nullable: true,
        },
        eventCount: {
            type: Number,
            default: 0,
        },
        errorMessage: {
            type: String,
            nullable: true,
        },
        completedAt: {
            type: 'timestamp with time zone',
            nullable: true,
        },
    },
    indices: [
        {
            name: 'idx_audit_log_export_platform_id_created',
            columns: ['platformId', 'created'],
        },
        {
            name: 'idx_audit_log_export_status',
            columns: ['status'],
        },
    ],
    relations: {
        platform: {
            type: 'many-to-one',
            target: 'platform',
            cascade: true,
            onDelete: 'CASCADE',
            joinColumn: {
                name: 'platformId',
                referencedColumnName: 'id',
            },
        },
    },
})
