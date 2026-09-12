import { BaseModelSchema } from '@activepieces/core-utils'
import { z } from 'zod'

export enum FormSessionEvent {
    VISIT = 'VISIT',
    START = 'START',
    SUBMIT = 'SUBMIT',
    FAILURE = 'FAILURE',
    TIMEOUT = 'TIMEOUT',
}

export enum FormSessionAttribution {
    ANONYMOUS = 'ANONYMOUS',
    AUTHENTICATED = 'AUTHENTICATED',
}

export enum FormSessionStatus {
    VISITED = 'VISITED',
    STARTED = 'STARTED',
    SUBMITTED = 'SUBMITTED',
    FAILED = 'FAILED',
    TIMED_OUT = 'TIMED_OUT',
    ABANDONED = 'ABANDONED',
}

export const FORM_SESSION_ID_HEADER = 'x-ap-form-session'

export const ResolveFormSessionRunRequestBody = z.object({
    flowId: z.string().min(1),
    sessionId: z.string().min(1),
    submittedAt: z.string().datetime(),
})

export type ResolveFormSessionRunRequestBody = z.infer<typeof ResolveFormSessionRunRequestBody>

export const FORM_SESSION_ABANDONMENT_MS = 30 * 60 * 1000

export const StartFormSessionRequestBody = z.object({
    flowId: z.string().min(1),
    useDraft: z.boolean().optional().default(false),
})

export type StartFormSessionRequestBody = z.infer<typeof StartFormSessionRequestBody>

export const StartFormSessionResponse = z.object({
    sessionId: z.string(),
})

export type StartFormSessionResponse = z.infer<typeof StartFormSessionResponse>

export const TrackFormSessionEventRequestBody = z.object({
    flowId: z.string().min(1),
    sessionId: z.string().min(1),
    event: z.nativeEnum(FormSessionEvent),
    fieldName: z.string().max(200).optional(),
    reachedFields: z.array(z.string().max(200)).max(100).optional(),
})

export type TrackFormSessionEventRequestBody = z.infer<typeof TrackFormSessionEventRequestBody>

export const TrackFormFieldInteractionRequestBody = z.object({
    flowId: z.string().min(1),
    sessionId: z.string().min(1),
    fieldName: z.string().max(200),
    reachedFieldNames: z.array(z.string().max(200)).max(100).optional(),
})

export type TrackFormFieldInteractionRequestBody = z.infer<typeof TrackFormFieldInteractionRequestBody>

export const ListFormAnalyticsRequestQuery = z.object({
    projectId: z.string(),
    flowId: z.string().optional(),
    flowVersionId: z.string().optional(),
    createdAfter: z.string().datetime().optional(),
    createdBefore: z.string().datetime().optional(),
    attribution: z.nativeEnum(FormSessionAttribution).optional(),
})

export type ListFormAnalyticsRequestQuery = z.infer<typeof ListFormAnalyticsRequestQuery>

export const FormFunnelStage = z.object({
    key: z.nativeEnum(FormSessionStatus),
    label: z.string(),
    count: z.number().int().nonnegative(),
})

export type FormFunnelStage = z.infer<typeof FormFunnelStage>

export const FormFieldAbandonment = z.object({
    fieldName: z.string(),
    fieldLabel: z.string(),
    reached: z.number().int().nonnegative(),
    interacted: z.number().int().nonnegative(),
    abandonedAt: z.number().int().nonnegative(),
    abandonmentRate: z.number(),
})

export type FormFieldAbandonment = z.infer<typeof FormFieldAbandonment>

export const FormAnalyticsRow = z.object({
    date: z.string(),
    flowId: z.string(),
    flowVersionId: z.string(),
    attribution: z.nativeEnum(FormSessionAttribution),
    funnel: z.array(FormFunnelStage),
    fields: z.array(FormFieldAbandonment),
})

export type FormAnalyticsRow = z.infer<typeof FormAnalyticsRow>

export const FormAnalyticsResponse = z.object({
    data: z.array(FormAnalyticsRow),
})

export type FormAnalyticsResponse = z.infer<typeof FormAnalyticsResponse>

export const FormSession = z.object({
    ...BaseModelSchema,
    projectId: z.string(),
    flowId: z.string(),
    flowVersionId: z.string().nullable(),
    visitorKey: z.string(),
    attribution: z.nativeEnum(FormSessionAttribution),
    userId: z.string().nullable(),
    status: z.nativeEnum(FormSessionStatus),
    runId: z.string().nullable(),
    useDraft: z.boolean(),
    lastEventAt: z.string(),
})

export type FormSession = z.infer<typeof FormSession>

export const FormFieldInteraction = z.object({
    ...BaseModelSchema,
    projectId: z.string(),
    flowId: z.string(),
    flowVersionId: z.string().nullable(),
    sessionId: z.string(),
    fieldName: z.string(),
    fieldLabel: z.string(),
    reached: z.boolean(),
    interacted: z.boolean(),
    attribution: z.nativeEnum(FormSessionAttribution),
})

export type FormFieldInteraction = z.infer<typeof FormFieldInteraction>
