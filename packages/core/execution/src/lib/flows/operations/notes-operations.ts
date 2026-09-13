import dayjs from 'dayjs'
import { isNil } from '@activepieces/core-utils'
import { FlowVersion } from '../flow-version'
import { Note } from '../note'
import { flowStructureUtil } from '../util/flow-structure-util'
import { AddNoteRequest, DeleteNoteRequest, UpdateNoteRequest } from '.'

const _updateNote = (flowVersion: FlowVersion, request: UpdateNoteRequest): FlowVersion => {
    const newFlowVersion = JSON.parse(JSON.stringify(flowVersion))
    newFlowVersion.notes = newFlowVersion.notes.map((note: Note) => {
        if (note.id === request.id) {
            return { ...note, ...request, updatedAt: dayjs().toISOString() }
        }
        return note
    })
    return newFlowVersion
}

const _deleteNote = (flowVersion: FlowVersion, request: DeleteNoteRequest): FlowVersion => {
    const newFlowVersion = JSON.parse(JSON.stringify(flowVersion))
    newFlowVersion.notes = newFlowVersion.notes.filter((note: Note) => note.id !== request.id)
    return newFlowVersion
}

const _addNote = (flowVersion: FlowVersion, request: AddNoteRequest): FlowVersion => {
    const newFlowVersion = JSON.parse(JSON.stringify(flowVersion))
    newFlowVersion.notes.push({
        resolved: false,
        lastUpdatedBy: null,
        stepName: null,
        ...request,
        createdAt: dayjs().toISOString(),
        updatedAt: dayjs().toISOString(),
    })
    return newFlowVersion
}

const _detachNotesFromSteps = (flowVersion: FlowVersion, stepNames: string[]): FlowVersion => {
    const detachedStepNames = new Set(stepNames)
    const hasAttachedNotes = flowVersion.notes.some((note) => !isNil(note.stepName) && detachedStepNames.has(note.stepName))
    if (!hasAttachedNotes) {
        return flowVersion
    }
    const newFlowVersion = JSON.parse(JSON.stringify(flowVersion))
    newFlowVersion.notes = newFlowVersion.notes.map((note: Note) => {
        if (!isNil(note.stepName) && detachedStepNames.has(note.stepName)) {
            return { ...note, stepName: null }
        }
        return note
    })
    return newFlowVersion
}

const _restoreMovedStepNoteAttachments = (flowVersion: FlowVersion, notesBeforeMove: Note[]): FlowVersion => {
    const existingStepNames = new Set(flowStructureUtil.getAllSteps(flowVersion.trigger).map((step) => step.name))
    const notesBeforeMoveById = new Map(notesBeforeMove.map((note) => [note.id, note]))
    const hasDetachedNotes = flowVersion.notes.some((note) => {
        const noteBeforeMove = notesBeforeMoveById.get(note.id)
        return isNil(note.stepName) && !isNil(noteBeforeMove?.stepName) && existingStepNames.has(noteBeforeMove.stepName)
    })
    if (!hasDetachedNotes) {
        return flowVersion
    }
    return {
        ...flowVersion,
        notes: flowVersion.notes.map((note) => {
            const noteBeforeMove = notesBeforeMoveById.get(note.id)
            if (isNil(note.stepName) && !isNil(noteBeforeMove?.stepName) && existingStepNames.has(noteBeforeMove.stepName)) {
                return { ...note, stepName: noteBeforeMove.stepName }
            }
            return note
        }),
    }
}

export const notesOperations = {
    updateNote: _updateNote,
    deleteNote: _deleteNote,
    addNote: _addNote,
    detachNotesFromSteps: _detachNotesFromSteps,
    restoreMovedStepNoteAttachments: _restoreMovedStepNoteAttachments,
}
