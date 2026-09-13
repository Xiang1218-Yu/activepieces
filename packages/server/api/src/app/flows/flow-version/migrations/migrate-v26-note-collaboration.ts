import { FlowVersion, Note } from '@activepieces/shared'
import { Migration } from '.'

export const migrateV26NoteCollaboration: Migration = {
    targetSchemaVersion: '26',
    migrate: async (flowVersion: FlowVersion): Promise<FlowVersion> => {
        const notes = (flowVersion.notes ?? []).map((note: Note) => ({
            ...note,
            resolved: note.resolved ?? false,
            lastUpdatedBy: note.lastUpdatedBy ?? note.ownerId ?? null,
            stepName: note.stepName ?? null,
        }))
        return {
            ...flowVersion,
            notes,
            schemaVersion: '27',
        }
    },
}
