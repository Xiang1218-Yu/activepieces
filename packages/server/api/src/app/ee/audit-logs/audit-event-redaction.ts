import { ApplicationEvent } from '@activepieces/shared'

const REDACTION_PLACEHOLDER = '[REDACTED]'
const MAX_DEPTH = 20

const SENSITIVE_KEY_PATTERN = /(^|[-_ ])(password|passwd|secret|token|api[-_ ]?key|apikey|access[-_ ]?key|refresh[-_ ]?token|private[-_ ]?key|client[-_ ]?secret|authorization|credential)s?$/i

function isSensitiveKey(key: string): boolean {
    const normalized = key
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .replace(/[_\s]+/g, '-')
        .toLowerCase()
    return SENSITIVE_KEY_PATTERN.test(normalized)
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export type RedactedApplicationEvent = Omit<ApplicationEvent, 'data'> & {
    data: JsonValue
}

export const auditEventRedaction = {
    redactEvent(event: ApplicationEvent): RedactedApplicationEvent {
        return {
            ...event,
            data: redactValue(event.data),
        }
    },
}

function redactValue(value: unknown, depth = 0): JsonValue {
    if (value === null || value === undefined) {
        return null
    }
    if (Array.isArray(value)) {
        if (depth >= MAX_DEPTH) {
            return []
        }
        return value.map((item) => redactValue(item, depth + 1))
    }
    if (typeof value === 'object') {
        if (depth >= MAX_DEPTH) {
            return {}
        }
        const entries = Object.entries(value).map(([key, nested]): [string, JsonValue] => {
            if (isSensitiveKey(key)) {
                return [key, REDACTION_PLACEHOLDER]
            }
            return [key, redactValue(nested, depth + 1)]
        })
        return Object.fromEntries(entries)
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return value
    }
    return String(value)
}
