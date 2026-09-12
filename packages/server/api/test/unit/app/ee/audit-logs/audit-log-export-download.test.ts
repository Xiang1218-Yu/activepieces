import { Readable } from 'node:stream'
import { AuditLogExportFormat, AuditLogExportStatus, FileCompression, FileLocation, FileType } from '@activepieces/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getPlatformFileOrThrowMock = vi.fn()
const openDataStreamMock = vi.fn()

vi.mock('../../../../../src/app/file/file.service', () => ({
    fileService: vi.fn(() => ({
        getPlatformFileOrThrow: getPlatformFileOrThrowMock,
        openDataStream: openDataStreamMock,
    })),
}))

const getFileStreamMock = vi.fn()
const getS3SignedUrlWithExpiryMock = vi.fn()

vi.mock('../../../../../src/app/file/s3-helper', () => ({
    s3Helper: vi.fn(() => ({
        getFileStream: getFileStreamMock,
        getS3SignedUrlWithExpiry: getS3SignedUrlWithExpiryMock,
    })),
}))

const isEnabledMock = vi.fn()

vi.mock('../../../../../src/app/file/signed-file-transport', () => ({
    signedFileTransport: {
        isEnabled: (...args: unknown[]) => isEnabledMock(...args),
    },
}))

const redeemTokenMock = vi.fn()

vi.mock('../../../../../src/app/ee/audit-logs/audit-log-export-token-service', () => ({
    auditLogExportTokenService: vi.fn(() => ({
        redeemToken: redeemTokenMock,
    })),
}))

const findOneByMock = vi.fn()

vi.mock('../../../../../src/app/core/db/repo-factory', () => ({
    repoFactory: vi.fn(() => () => ({
        findOneBy: findOneByMock,
    })),
}))

import { auditLogExportService, DownloadTransport } from '../../../../../src/app/ee/audit-logs/audit-log-export-service'

const log = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
} as never

const claims = {
    exportId: 'export-1',
    platformId: 'platform-1',
    fileId: 'file-1',
    jti: 'jti-1',
}

const exportRecord = {
    id: 'export-1',
    platformId: 'platform-1',
    fileId: 'file-1',
    status: AuditLogExportStatus.COMPLETED,
    format: AuditLogExportFormat.JSON,
    fileName: 'audit-log-export.json',
}

const s3File = {
    id: 'file-1',
    location: FileLocation.S3,
    s3Key: 'platform/platform-1/AUDIT_LOG_EXPORT/file-1',
    compression: FileCompression.NONE,
    type: FileType.AUDIT_LOG_EXPORT,
    size: 5_000_000,
}

const dbFile = {
    id: 'file-1',
    location: FileLocation.DB,
    s3Key: null,
    compression: FileCompression.NONE,
    type: FileType.AUDIT_LOG_EXPORT,
    size: 12,
}

describe('auditLogExportService.prepareDownload', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        redeemTokenMock.mockResolvedValue(claims)
        findOneByMock.mockResolvedValue(exportRecord)
        getPlatformFileOrThrowMock.mockResolvedValue(s3File)
    })

    it('returns a short-lived presigned redirect for S3 without reading any bytes', async () => {
        isEnabledMock.mockReturnValue(true)
        getS3SignedUrlWithExpiryMock.mockResolvedValue('https://s3.example/signed')

        const download = await auditLogExportService(log).prepareDownload({ token: 'tok' })

        expect(download.kind).toBe(DownloadTransport.REDIRECT)
        if (download.kind !== DownloadTransport.REDIRECT) {
            throw new Error('expected redirect')
        }
        expect(download.redirectUrl).toBe('https://s3.example/signed')
        expect(getFileStreamMock).not.toHaveBeenCalled()
        expect(getS3SignedUrlWithExpiryMock).toHaveBeenCalledWith(expect.objectContaining({
            s3Key: s3File.s3Key,
            expiresInSeconds: 900,
        }))
        expect(openDataStreamMock).not.toHaveBeenCalled()
    })

    it('opens a stream (never a full buffer) when presigned redirects are disabled', async () => {
        isEnabledMock.mockReturnValue(false)
        getPlatformFileOrThrowMock.mockResolvedValue(dbFile)
        const chunks = ['{"metadata":', '{}', '}']
        openDataStreamMock.mockResolvedValue(Readable.from(chunks))

        const download = await auditLogExportService(log).prepareDownload({ token: 'tok' })

        expect(download.kind).toBe(DownloadTransport.STREAM)
        if (download.kind !== DownloadTransport.STREAM) {
            throw new Error('expected stream')
        }
        expect(download.size).toBe(12)
        const received = await streamToString(download.stream)
        expect(received).toBe('{"metadata":{}}')
        expect(getS3SignedUrlWithExpiryMock).not.toHaveBeenCalled()
        expect(openDataStreamMock).toHaveBeenCalledTimes(1)
    })

    it('404s when the file belongs to a different platform or type', async () => {
        getPlatformFileOrThrowMock.mockRejectedValue(new Error('File not found'))
        await expect(auditLogExportService(log).prepareDownload({ token: 'tok' })).rejects.toThrow()
    })
})

async function streamToString(stream: Readable): Promise<string> {
    let result = ''
    for await (const chunk of stream) {
        result += chunk.toString()
    }
    return result
}
