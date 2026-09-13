import { apId } from '@activepieces/core-utils';
import {
  AddNoteRequest,
  FlowOperationType,
  NoteColorVariant,
  Note,
  UpdateNoteRequest,
  flowStructureUtil,
} from '@activepieces/shared';
import { StoreApi } from 'zustand';

import { authenticationSession } from '@/lib/authentication-session';

import { BuilderState } from '../builder-hooks';
import { flowCanvasUtils } from '../flow-canvas/utils/flow-canvas-utils';

export enum NoteDragOverlayMode {
  CREATE = 'create',
  MOVE = 'move',
}

export type NotesState = {
  addNote: (
    request: Omit<
      AddNoteRequest,
      'id' | 'resolved' | 'lastUpdatedBy' | 'stepName'
    >,
  ) => void;
  deleteNote: (id: string) => void;
  moveNote: (id: string, position: { x: number; y: number }) => void;
  resizeNote: (id: string, size: { width: number; height: number }) => void;
  draggedNote: Note | null;
  updateContent: (id: string, content: string) => void;
  updateNoteColor: (id: string, color: NoteColorVariant) => void;
  setNoteResolved: (id: string, resolved: boolean) => void;
  attachNoteToStep: (
    id: string,
    stepName: string,
    position: { x: number; y: number },
  ) => void;
  detachNoteFromStep: (id: string, position: { x: number; y: number }) => void;
  detachNotesFromSteps: (stepNames: string[]) => void;
  setDraggedNote: (
    note: Note | null,
    mode: NoteDragOverlayMode | null,
    offset?: { x: number; y: number },
  ) => void;
  noteDragOverlayMode: NoteDragOverlayMode | null;
  setNoteDragOverlayMode: (
    noteDragOverlayMode: NoteDragOverlayMode | null,
  ) => void;
  getNoteById: (id: string) => Note | null;
  draggedNoteOffset: { x: number; y: number } | null;
};

const buildUpdateNoteRequest = (
  note: Note,
  updates: Partial<UpdateNoteRequest>,
): UpdateNoteRequest => {
  return {
    id: note.id,
    content: note.content,
    color: note.color,
    position: note.position,
    size: note.size,
    resolved: note.resolved,
    lastUpdatedBy: authenticationSession.getCurrentUserId() ?? null,
    stepName: note.stepName,
    ...updates,
  };
};

export const createNotesState = (
  get: StoreApi<BuilderState>['getState'],
  set: StoreApi<BuilderState>['setState'],
): NotesState => {
  const updateNote = (id: string, updates: Partial<UpdateNoteRequest>) => {
    const note = get().getNoteById(id);
    if (!note) {
      return;
    }
    get().applyOperation({
      type: FlowOperationType.UPDATE_NOTE,
      request: buildUpdateNoteRequest(note, updates),
    });
  };
  return {
    noteDragOverlayMode: null,
    setNoteDragOverlayMode: (
      noteDragOverlayMode: NoteDragOverlayMode | null,
    ) => {
      set({ noteDragOverlayMode });
    },
    addNote: (request) => {
      const id = apId();
      get().applyOperation({
        type: FlowOperationType.ADD_NOTE,
        request: {
          resolved: false,
          lastUpdatedBy: null,
          stepName: null,
          ...request,
          id,
        },
      });
      const notes = get().flowVersion.notes.map((note) => {
        if (note.id !== id) {
          return note;
        }
        const currentUserId = authenticationSession.getCurrentUserId() ?? null;
        return {
          ...note,
          ownerId: currentUserId,
          lastUpdatedBy: currentUserId,
        };
      });
      set(() => {
        return {
          flowVersion: {
            ...get().flowVersion,
            notes,
          },
          draggedNote: null,
          noteDragOverlayMode: null,
        };
      });
    },
    updateContent: (id: string, content: string) => {
      updateNote(id, { content });
    },
    deleteNote: (id: string) => {
      get().applyOperation({
        type: FlowOperationType.DELETE_NOTE,
        request: {
          id: id,
        },
      });
    },
    moveNote: (id: string, position: { x: number; y: number }) => {
      set(() => {
        return {
          noteDragOverlayMode: null,
          draggedNote: null,
        };
      });
      updateNote(id, { position });
    },
    resizeNote: (id: string, size: { width: number; height: number }) => {
      set(() => {
        return {
          noteDragOverlayMode: null,
          draggedNote: null,
        };
      });
      updateNote(id, { size });
    },
    setNoteResolved: (id: string, resolved: boolean) => {
      if (get().readonly) {
        return;
      }
      updateNote(id, { resolved });
    },
    attachNoteToStep: (
      id: string,
      stepName: string,
      position: { x: number; y: number },
    ) => {
      updateNote(id, { stepName, position });
    },
    detachNoteFromStep: (id: string, position: { x: number; y: number }) => {
      updateNote(id, { stepName: null, position });
    },
    detachNotesFromSteps: (stepNames: string[]) => {
      const { flowVersion, canvasOrientation } = get();
      const removedStepNames = new Set(
        stepNames.flatMap((stepName) => {
          const step = flowStructureUtil.getStep(
            stepName,
            flowVersion.trigger,
          );
          if (!step) {
            return [];
          }
          return flowStructureUtil
            .getAllChildSteps(step)
            .map((childStep) => childStep.name);
        }),
      );
      const attachedNotes = flowVersion.notes.filter(
        (note) => note.stepName && removedStepNames.has(note.stepName),
      );
      if (attachedNotes.length === 0) {
        return;
      }
      const graph = flowCanvasUtils.createFlowGraph({
        version: flowVersion,
        notes: flowVersion.notes,
        orientation: canvasOrientation,
      });
      attachedNotes.forEach((note) => {
        const noteNode = graph.nodes.find((node) => node.id === note.id);
        if (noteNode) {
          updateNote(note.id, {
            stepName: null,
            position: noteNode.position,
          });
        }
      });
    },
    draggedNote: null,
    draggedNoteOffset: null,
    setDraggedNote: (
      note: Note | null,
      mode: NoteDragOverlayMode | null,
      offset?: { x: number; y: number },
    ) => {
      set({
        draggedNote: note,
        noteDragOverlayMode: mode,
        draggedNoteOffset: offset ?? null,
      });
    },
    getNoteById: (id: string) => {
      return get().flowVersion.notes.find((note) => note.id === id) ?? null;
    },
    updateNoteColor: (id: string, color: NoteColorVariant) => {
      updateNote(id, { color });
    },
  };
};
