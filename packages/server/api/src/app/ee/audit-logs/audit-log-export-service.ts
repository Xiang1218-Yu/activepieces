import { Readable } from 'node:stream'
import { ActivepiecesError, apId, ErrorCode, isNil, tryCatch } from '@activepieces/core-utils'
import {
    AuditLogExport,
    AuditLogExportFilters,
    AuditLogExportFormat,
    AuditLogExportStatus,
    FileCompression,
    FileType,
} from '@activepieces/shared'
import dayjs from 'dayjs'
import { FastifyBaseLogger } from 'fastify'
import { LessThan } from 'typeorm'
import { repoFactory } from '../../core/db/repo-factory'
import { fileService } from '../../file/file.service'
import { enforceByteLimit } from '../../file/files-service'
import { s3Helper } from '../../file/s3-helper'
import { signedFileTransport } from '../../file/signed-file-transport'
import { domainHelper } from '../../helper/domain-helper'
import { exceptionHandler } from '../../helper/exception-handler'
import { system } from '../../helper/system/system'
import { AppSystemProp } from '../../helper/system/system-props'
import { auditEventRedaction, RedactedApplicationEvent } from './audit-event-redaction'
import { auditLogService } from './audit-event-service'
import { AuditLogExportEntity } from './audit-log-export-entity'
import { auditLogExportSerializer } from './audit-log-export-serializer'
import { auditLogExportTokenService } from './audit-log-export-token-service'

const auditLogExportRepo = repoFactory(AuditLogExportEntity)

const BATCH_SIZE = 1000
const EXPORT_RETENTION_DAYS = 7
const LIST_LIMIT = 50
const MAX_EXPORT_ATTEMPTS = 3
const DOWNLOAD_REDIRECT_TTL_SECONDS = 900

export const auditLogExportService = (log: FastifyBaseLogger) => ({
    async create(params: CreateParams): Promise<AuditLogExport> {
        const record = await auditLogExportRepo().save({
            id: apId(),
            platformId: params.platformId,
            requestedById: params.requestedById,
            format: params.format,
            status: AuditLogExportStatus.PENDING,
            filters: params.filters,
            eventCount: 0,
            created: dayjs().toISOString(),
            updated: dayjs().toISOString(),
        })
        return record
    },
    async listForPlatform({ platformId }: { platformId: string }): Promise<AuditLogExport[]> {
        return auditLogExportRepo().find({
            where: { platformId },
            order: { created: 'DESC' },
            take: LIST_LIMIT,
        })
    },
    async getOneOrThrow(params: { id: string, platformId: string }): Promise<AuditLogExport> {
        const record = await auditLogExportRepo().findOneBy({
            id: params.id,
            platformId: params.platformId,
        })
        if (isNil(record)) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: {
                    entityType: 'auditLogExport',
                    entityId: params.id,
                    message: 'Audit log export not found',
                },
            })
        }
        return record
    },
    async getOneTimeDownloadUrl(params: { id: string, platformId: string }): Promise<DownloadLinkResult> {
        const record = await this.getOneOrThrow(params)
        if (record.status !== AuditLogExportStatus.COMPLETED || isNil(record.fileId)) {
            throw new ActivepiecesError({
                code: ErrorCode.VALIDATION,
                params: { message: 'Audit log export is not ready for download' },
            })
        }
        await fileService(log).getPlatformFileOrThrow({
            platformId: record.platformId,
            fileId: record.fileId,
            type: FileType.AUDIT_LOG_EXPORT,
        })
        const { token, expiresAt } = await auditLogExportTokenService(log).issueToken({
            exportId: record.id,
            platformId: record.platformId,
            fileId: record.fileId,
        })
        const downloadUrl = await domainHelper.getPublicApiUrl({
            path: `v1/audit-events/exports/${record.id}/download?token=${token}`,
        })
        return {
            downloadUrl,
            expiresAt,
        }
    },
    async prepareDownload(params: { token: string }): Promise<PreparedDownload> {
        const claims = await auditLogExportTokenService(log).redeemToken(params.token)
        const record = await auditLogExportRepo().findOneBy({
            id: claims.exportId,
            platformId: claims.platformId,
        })
        if (isNil(record) || record.fileId !== claims.fileId) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: {
                    entityType: 'auditLogExport',
                    entityId: claims.exportId,
                    message: 'Audit log export not found',
                },
            })
        }
        const file = await fileService(log).getPlatformFileOrThrow({
            platformId: claims.platformId,
            fileId: claims.fileId,
            type: FileType.AUDIT_LOG_EXPORT,
        })
        const fileName = record.fileName ?? `audit-log-export.${record.format}`
        if (signedFileTransport.isEnabled(file) && !isNil(file.s3Key)) {
            const redirectUrl = await s3Helper(log).getS3SignedUrlWithExpiry({
                s3Key: file.s3Key,
                fileName,
                expiresInSeconds: DOWNLOAD_REDIRECT_TTL_SECONDS,
            })
            return {
                kind: DownloadTransportMode.REDIRECT,
                redirectUrl,
                fileName,
            }
        }
        const stream = await fileService(log).openDataStream(file)
        return {
            kind: DownloadTransportMode.STREAM,
            stream,
            fileName,
            size: file.size ?? null,
        }
    },
    async runExport(params: RunExportParams): Promise<void> {
        const { exportId, maxAttempts = MAX_EXPORT_ATTEMPTS, attemptNumber = 1 } = params
        const record = await auditLogExportRepo().findOneBy({ id: exportId })
        if (isNil(record)) {
            throw new Error(`Audit log export ${exportId} not found`)
        }
        if (record.status === AuditLogExportStatus.COMPLETED) {
            return
        }
        await auditLogExportRepo().update({ id: exportId }, {
            status: AuditLogExportStatus.RUNNING,
            attempts: Math.max(record.attempts ?? 0, attemptNumber),
            updated: dayjs().toISOString(),
        })
        const filters = normalizeFilters(record.filters)
        let eventCount = 0
        const redactedBatches = async function* (): AsyncGenerator<RedactedApplicationEvent[]> {
            for await (const batch of auditLogService(log).streamAll({
                platformId: record.platformId,
                filters,
                batchSize: BATCH_SIZE,
                log,
            })) {
                yield batch.map(auditEventRedaction.redactEvent)
            }
        }

        const fileName = buildFileName({ format: record.format, createdAt: record.created })
        const maxFileSizeInBytes = system.getNumberOrThrow(AppSystemProp.MAX_FILE_SIZE_MB) * 1024 * 1024
        const { data: savedFile, error } = await tryCatch(() =>
            fileService(log).save({
                platformId: record.platformId,
                type: FileType.AUDIT_LOG_EXPORT,
                fileName,
                compression: FileCompression.NONE,
                data: auditLogExportSerializer.buildReadable({
                    format: record.format,
                    filters,
                    eventBatches: redactedBatches(),
                    onEventCount: (count) => {
                        eventCount = count
                    },
                }).pipe(enforceByteLimit(maxFileSizeInBytes)),
                metadata: {
                    mimetype: record.format === AuditLogExportFormat.CSV ? 'text/csv' : 'application/json',
                },
            }),
        )

        if (error !== null) {
            const errorCode = extractErrorCode(error)
            const isNonRetriable = errorCode === ErrorCode.FILE_TOO_LARGE
            const isFinalAttempt = isNonRetriable || attemptNumber >= maxAttempts
            const errorMessage = isNonRetriable
                ? 'Audit log export exceeded the maximum file size; narrow the filters and try again'
                : error.message
            if (isFinalAttempt) {
                await auditLogExportRepo().update({ id: exportId }, {
                    status: AuditLogExportStatus.FAILED,
                    errorMessage,
                    attempts: attemptNumber,
                    updated: dayjs().toISOString(),
                })
                exceptionHandler.handle(error, log)
                log.error({ exportId, attemptNumber, maxAttempts, errorMessage }, '[auditLogExportService#runExport] export failed permanently')
                return
            }
            await auditLogExportRepo().update({ id: exportId }, {
                status: AuditLogExportStatus.RUNNING,
                errorMessage: null,
                attempts: attemptNumber,
                updated: dayjs().toISOString(),
            })
            log.warn({ exportId, attemptNumber, maxAttempts, errorMessage }, '[auditLogExportService#runExport] export attempt failed, scheduling retry')
            throw error
        }

        await auditLogExportRepo().update({ id: exportId }, {
            status: AuditLogExportStatus.COMPLETED,
            fileId: savedFile.id,
            fileName,
            eventCount,
            errorMessage: null,
            completedAt: dayjs().toISOString(),
            updated: dayjs().toISOString(),
        })
        log.info({ exportId, eventCount, fileId: savedFile.id }, '[auditLogExportService#runExport] export completed')
    },
    async deleteStaleExports(): Promise<void> {
        const cutoff = dayjs().subtract(EXPORT_RETENTION_DAYS, 'days').toISOString()
        const staleExports = await auditLogExportRepo().find({
            where: { created: LessThan(cutoff) },
            take: 1000,
        })
        for (const record of staleExports) {
            const fileId = record.fileId
            if (!isNil(fileId)) {
                const { data: file, error } = await tryCatch(() => fileService(log).getPlatformFileOrThrow({
                    platformId: record.platformId,
                    fileId,
                    type: FileType.AUDIT_LOG_EXPORT,
                }))
                if (error === null && !isNil(file)) {
                    await fileService(log).deleteByPlatform({ platformId: record.platformId, fileId: file.id })
                }
            }
            await auditLogExportRepo().delete({ id: record.id })
        }
    },
})

function normalizeFilters(filters: AuditLogExport['filters'] | null | undefined): AuditLogExportFilters {
    if (isNil(filters)) {
        return {}
    }
    return filters
}

function extractErrorCode(error: unknown): string | undefined {
    if (typeof error !== 'object' || error === null) {
        return undefined
    }
    const candidate = error as { error?: { code?: unknown }, code?: unknown }
    if (typeof candidate.error?.code === 'string') {
        return candidate.error.code
    }
    return typeof candidate.code === 'string' ? candidate.code : undefined
}

function buildFileName(params: { format: AuditLogExportFormat, createdAt: string }): string {
    return `audit-log-export-${dayjs(params.createdAt).format('YYYYMMDD-HHmmss')}.${params.format}`
}

type CreateParams = {
    platformId: string
    requestedById?: string
    format: AuditLogExportFormat
    filters: AuditLogExportFilters
}

type RunExportParams = {
    exportId: string
    maxAttempts?: number
    attemptNumber?: number
}

type DownloadLinkResult = {
    downloadUrl: string
    expiresAt: string
}

enum DownloadTransportMode {
    REDIRECT = 'REDIRECT',
    STREAM = 'STREAM',
}

type PreparedDownload =
    | {
        kind: DownloadTransportMode.REDIRECT
        redirectUrl: string
        fileName: string
    }
    | {
        kind: DownloadTransportMode.STREAM
        stream: Readable
        fileName: string
        size: number | null
    }

export { DownloadTransportMode as DownloadTransport }
export type { PreparedDownload }
