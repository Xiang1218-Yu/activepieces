import { Readable } from 'node:stream'
import { AuditLogExportFilters, AuditLogExportFormat } from '@activepieces/shared'
import { RedactedApplicationEvent } from './audit-event-redaction'

const CSV_COLUMNS = [
    'id',
    'created',
    'action',
    'userId',
    'userEmail',
    'projectId',
    'projectDisplayName',
    'ip',
    'data',
] as const

type AuditLogExportMetadata = {
    format: AuditLogExportFormat
    generatedAt: string
    filters: AuditLogExportFilters
}

type BuildExportStreamParams = {
    format: AuditLogExportFormat
    filters: AuditLogExportFilters
    eventBatches: AsyncGenerator<RedactedApplicationEvent[]>
    onEventCount: (totalCount: number) => void
}

export const auditLogExportSerializer = {
    buildReadable(params: BuildExportStreamParams): Readable {
        if (params.format === AuditLogExportFormat.JSON) {
            return Readable.from(buildJsonChunks(params), { objectMode: false })
        }
        return Readable.from(buildCsvLines(params), { objectMode: false })
    },
}

async function* buildCsvLines({ filters, eventBatches, onEventCount }: BuildExportStreamParams): AsyncGenerator<string> {
    yield buildCsvMetadataHeader(filters)
    yield `${CSV_COLUMNS.join(',')}\n`
    let count = 0
    for await (const events of eventBatches) {
        for (const event of events) {
            yield `${buildCsvRow(event)}\n`
        }
        count += events.length
        onEventCount(count)
    }
}

async function* buildJsonChunks({ format, filters, eventBatches, onEventCount }: BuildExportStreamParams): AsyncGenerator<string> {
    const metadata: AuditLogExportMetadata = {
        format,
        generatedAt: new Date().toISOString(),
        filters,
    }
    yield `{"metadata":${JSON.stringify(metadata)},"events":[`
    let count = 0
    let isFirst = true
    for await (const events of eventBatches) {
        for (const event of events) {
            yield `${isFirst ? '' : ','}${JSON.stringify(event)}`
            isFirst = false
        }
        count += events.length
        onEventCount(count)
    }
    yield ']}'
}

function buildCsvMetadataHeader(filters: AuditLogExportFilters): string {
    const metadata: AuditLogExportMetadata = {
        format: AuditLogExportFormat.CSV,
        generatedAt: new Date().toISOString(),
        filters,
    }
    return `# ${JSON.stringify(metadata)}\n`
}

function buildCsvRow(event: RedactedApplicationEvent): string {
    return [
        event.id,
        event.created,
        event.action,
        event.userId ?? '',
        event.userEmail ?? '',
        event.projectId ?? '',
        event.projectDisplayName ?? '',
        event.ip ?? '',
        JSON.stringify(event.data),
    ].map(escapeCsvCell).join(',')
}

function escapeCsvCell(value: string): string {
    if (/[",\n\r]/.test(value)) {
        return `"${value.replace(/"/g, '""')}"`
    }
    return value
}
