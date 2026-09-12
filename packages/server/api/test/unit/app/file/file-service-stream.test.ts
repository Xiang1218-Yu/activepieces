import { Readable } from 'node:stream'
import { FileCompression, FileLocation, FileType } from '@activepieces/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockFindOne = vi.fn()
const mockFindOneBy = vi.fn()

vi.mock('../../../../src/app/file/file.entity', () => ({
    FileEntity: {},
}))

vi.mock('../../../../src/app/core/db/repo-factory', () => ({
    repoFactory: vi.fn(() => () => ({
        findOne: mockFindOne,
        findOneBy: mockFindOneBy,
        save: vi.fn(),
        find: vi.fn(),
        delete: vi.fn(),
        update: vi.fn(),
    })),
}))

vi.mock('../../../../src/app/project/project-repo', () => ({
    projectRepo: vi.fn(() => ({ find: vi.fn() })),
}))

vi.mock('../../../../src/app/helper/system/system', () => ({
    system: {
        getOrThrow: vi.fn().mockReturnValue('30'),
        getNumberOrThrow: vi.fn().mockReturnValue(25),
        getNumber: vi.fn().mockReturnValue(undefined),
        get: vi.fn().mockReturnValue(undefined),
    },
}))

vi.mock('../../../../src/app/helper/exception-handler', () => ({
    exceptionHandler: { handle: vi.fn() },
}))

const getFileStreamMock = vi.fn()

vi.mock('../../../../src/app/file/s3-helper', () => ({
    s3Helper: vi.fn(() => ({
        getFileStream: getFileStreamMock,
        getFile: vi.fn(),
        deleteFiles: vi.fn(),
        uploadFile: vi.fn(),
        constructS3Key: vi.fn(),
    })),
}))

vi.mock('../../../../src/app/file/file-compressor', () => ({
    fileCompressor: {
        compress: vi.fn(),
        decompress: vi.fn(),
    },
}))

import { fileService } from '../../../../src/app/file/file.service'

const mockLog = {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    child: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
} as never

describe('fileService streaming reads', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('getPlatformFileOrThrow selects metadata columns only, never the data bytea', async () => {
        mockFindOne.mockResolvedValue({
            id: 'file-1',
            location: FileLocation.DB,
            compression: FileCompression.NONE,
            type: FileType.AUDIT_LOG_EXPORT,
            size: 100,
        })

        const file = await fileService(mockLog).getPlatformFileOrThrow({
            platformId: 'platform-1',
            fileId: 'file-1',
            type: FileType.AUDIT_LOG_EXPORT,
        })

        const findArgs = mockFindOne.mock.calls[0][0]
        expect(findArgs.select).not.toContain('data')
        expect(findArgs.where).toEqual({
            id: 'file-1',
            platformId: 'platform-1',
            type: FileType.AUDIT_LOG_EXPORT,
        })
        expect(file.id).toBe('file-1')
    })

    it('openDataStream streams a DB bytea in chunks instead of returning the whole buffer', async () => {
        const bigBuffer = Buffer.alloc(3_500_000, 0x78)
        mockFindOne.mockResolvedValue({ id: 'file-2', data: bigBuffer })

        const stream = await fileService(mockLog).openDataStream({
            id: 'file-2',
            location: FileLocation.DB,
            s3Key: null,
            compression: FileCompression.NONE,
            type: FileType.AUDIT_LOG_EXPORT,
        })
        expect(stream).toBeInstanceOf(Readable)

        const chunks: Buffer[] = []
        let total = 0
        for await (const chunk of stream) {
            chunks.push(chunk)
            total += chunk.length
        }
        expect(total).toBe(3_500_000)
        expect(chunks.length).toBe(4)
        expect(chunks.slice(0, -1).every((chunk) => chunk.length <= 1_048_576)).toBe(true)
        expect(getFileStreamMock).not.toHaveBeenCalled()
    })

    it('openDataStream rejects compressed files instead of decompressing into memory', async () => {
        await expect(fileService(mockLog).openDataStream({
            id: 'file-3',
            location: FileLocation.DB,
            s3Key: null,
            compression: FileCompression.ZSTD,
            type: FileType.AUDIT_LOG_EXPORT,
        })).rejects.toThrow()
    })
})
