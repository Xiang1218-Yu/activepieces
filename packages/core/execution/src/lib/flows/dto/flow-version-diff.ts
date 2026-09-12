import { z } from 'zod'

export const FlowVersionDiffChangeType = {
    ADDED: 'ADDED',
    REMOVED: 'REMOVED',
    MODIFIED: 'MODIFIED',
    MOVED: 'MOVED',
} as const

export const FlowVersionDiffSection = {
    TRIGGER: 'TRIGGER',
    ACTION: 'ACTION',
    ROUTER: 'ROUTER',
    LOOP: 'LOOP',
    INPUT: 'INPUT',
    CONNECTION: 'CONNECTION',
    NOTE: 'NOTE',
} as const

export type FlowVersionDiffChangeType =
    (typeof FlowVersionDiffChangeType)[keyof typeof FlowVersionDiffChangeType]
export type FlowVersionDiffSection =
    (typeof FlowVersionDiffSection)[keyof typeof FlowVersionDiffSection]
export type StepSection =
    | typeof FlowVersionDiffSection.ACTION
    | typeof FlowVersionDiffSection.ROUTER
    | typeof FlowVersionDiffSection.LOOP
    | typeof FlowVersionDiffSection.INPUT

const changeTypeSchema = z.enum([
    FlowVersionDiffChangeType.ADDED,
    FlowVersionDiffChangeType.REMOVED,
    FlowVersionDiffChangeType.MODIFIED,
    FlowVersionDiffChangeType.MOVED,
])

const connectionChangeTypeSchema = z.enum([
    FlowVersionDiffChangeType.ADDED,
    FlowVersionDiffChangeType.REMOVED,
    FlowVersionDiffChangeType.MODIFIED,
])

const stepSectionSchema = z.enum([
    FlowVersionDiffSection.ACTION,
    FlowVersionDiffSection.ROUTER,
    FlowVersionDiffSection.LOOP,
    FlowVersionDiffSection.INPUT,
])

export const MASKED_VALUE = '••••••••'

export const FlowVersionDiffValueChangeSchema = z.object({
    path: z.string(),
    label: z.string(),
    before: z.unknown().optional(),
    after: z.unknown().optional(),
    beforeMasked: z.boolean().optional(),
    afterMasked: z.boolean().optional(),
})
export type FlowVersionDiffValueChange = z.infer<
    typeof FlowVersionDiffValueChangeSchema
>

export const FlowVersionStepChangeSchema = z.object({
    changeType: changeTypeSchema,
    stepName: z.string(),
    stepDisplayName: z.string(),
    sections: z.array(stepSectionSchema),
    parentStepName: z.string().nullable().optional(),
    previousParentStepName: z.string().nullable().optional(),
    index: z.number().int().optional(),
    previousIndex: z.number().int().optional(),
    changes: z.array(FlowVersionDiffValueChangeSchema),
})
export type FlowVersionStepChange = z.infer<
    typeof FlowVersionStepChangeSchema
>

export const FlowVersionConnectionChangeSchema = z.object({
    changeType: connectionChangeTypeSchema,
    stepName: z.string(),
    stepDisplayName: z.string(),
    inputKey: z.string(),
    before: z.string().optional(),
    after: z.string().optional(),
})
export type FlowVersionConnectionChange = z.infer<
    typeof FlowVersionConnectionChangeSchema
>

export const FlowVersionNoteChangeSchema = z.object({
    changeType: changeTypeSchema,
    noteId: z.string(),
    changes: z.array(FlowVersionDiffValueChangeSchema),
})
export type FlowVersionNoteChange = z.infer<
    typeof FlowVersionNoteChangeSchema
>

export const FlowVersionDiffSchema = z.object({
    flowId: z.string(),
    fromVersionId: z.string(),
    toVersionId: z.string(),
    fromVersion: z.object({
        displayName: z.string(),
        created: z.string(),
        state: z.string(),
    }),
    toVersion: z.object({
        displayName: z.string(),
        created: z.string(),
        state: z.string(),
    }),
    trigger: z.object({
        changed: z.boolean(),
        changes: z.array(FlowVersionDiffValueChangeSchema),
    }),
    steps: z.array(FlowVersionStepChangeSchema),
    connections: z.array(FlowVersionConnectionChangeSchema),
    notes: z.array(FlowVersionNoteChangeSchema),
    hasChanges: z.boolean(),
})
export type FlowVersionDiff = z.infer<typeof FlowVersionDiffSchema>

export const FlowVersionDiffRequest = z
    .object({
        fromVersionId: z.string().min(1),
        toVersionId: z.string().min(1),
    })
    .refine((data) => data.fromVersionId !== data.toVersionId, {
        message: 'flowVersionDiff_sameVersion',
        path: ['toVersionId'],
    })
export type FlowVersionDiffRequest = z.infer<typeof FlowVersionDiffRequest>
