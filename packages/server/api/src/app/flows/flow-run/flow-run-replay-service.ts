import { ActivepiecesError, ErrorCode, isNil, ProjectId } from '@activepieces/core-utils'
import { AppConnectionStatus, AUTHENTICATION_PROPERTY_NAME, FileType, FlowRun, FlowRunReplayBlocker, FlowRunReplayBlockerCode, FlowRunReplayStep, FlowTriggerType, FlowVersion, LogSliceRef, Step, StepOutput, StepOutputStatus, StepOutputType, flowStructureUtil } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { ArrayContains, In } from 'typeorm'
import { AppConnectionEntity } from '../../app-connection/app-connection.entity'
import { repoFactory } from '../../core/db/repo-factory'
import { fileService } from '../../file/file.service'
import { pieceMetadataService } from '../../pieces/metadata/piece-metadata-service'
import { projectService } from '../../project/project-service'
import { flowVersionService } from '../flow-version/flow-version.service'

const appConnectionRepo = repoFactory(AppConnectionEntity)

export const flowRunReplayService = (log: FastifyBaseLogger) => ({
    async prepare({ sourceRun, projectId }: PrepareParams): Promise<PrepareResult> {
        const flowVersion = await flowVersionService(log).getOneOrThrow(sourceRun.flowVersionId)

        const allSteps = flowStructureUtil.getAllSteps(flowVersion.trigger)
        const connectionStatusByExternalId = await loadConnectionStatuses({
            steps: allSteps,
            projectId,
        })
        const platformId = await projectService(log).getPlatformId(projectId)
        const unavailablePieces = await findUnavailablePieces({
            steps: allSteps,
            projectId,
            platformId,
            log,
        })

        const triggerStep = sourceRun.steps?.[flowVersion.trigger.name]
        const { blockers: triggerBlockers } = await resolveTriggerOutput({
            triggerStep,
            triggerName: flowVersion.trigger.name,
            triggerDisplayName: flowVersion.trigger.displayName,
            projectId,
            log,
        })

        const replaySteps = allSteps.map((step, index) => {
            const blockers: FlowRunReplayBlocker[] = []
            const pieceName = 'pieceName' in step.settings ? step.settings.pieceName : undefined
            const pieceVersion = 'pieceVersion' in step.settings ? step.settings.pieceVersion : undefined
            const connectionExternalId = getConnectionExternalId(step)
            const connectionStatus = connectionExternalId
                ? connectionStatusByExternalId.get(connectionExternalId)
                : undefined

            if (index === 0) {
                blockers.push(...triggerBlockers)
            }
            if (connectionExternalId && isNil(connectionStatus)) {
                blockers.push({
                    code: FlowRunReplayBlockerCode.CONNECTION_MISSING,
                    stepName: step.name,
                    stepDisplayName: step.displayName,
                    connectionExternalId,
                })
            }
            else if (connectionExternalId && connectionStatus !== AppConnectionStatus.ACTIVE) {
                blockers.push({
                    code: FlowRunReplayBlockerCode.CONNECTION_ERROR,
                    stepName: step.name,
                    stepDisplayName: step.displayName,
                    connectionExternalId,
                })
            }
            if (pieceName && pieceVersion && unavailablePieces.has(`${pieceName}@${pieceVersion}`)) {
                blockers.push({
                    code: FlowRunReplayBlockerCode.PIECE_UNAVAILABLE,
                    stepName: step.name,
                    stepDisplayName: step.displayName,
                    pieceName,
                    pieceVersion,
                })
            }

            const replayStep: FlowRunReplayStep = {
                name: step.name,
                displayName: step.displayName,
                order: index + 1,
                isTrigger: index === 0,
                blockers,
                ...(pieceName ? { pieceName } : {}),
                ...(pieceVersion ? { pieceVersion } : {}),
                ...(connectionExternalId ? { connectionExternalId } : {}),
                ...(connectionStatus ? { connectionStatus } : {}),
            }
            return replayStep
        })

        const blockers = replaySteps.flatMap(step => step.blockers)
        return {
            sourceRunId: sourceRun.id,
            flowId: sourceRun.flowId,
            flowVersionId: flowVersion.id,
            flowDisplayName: flowVersion.displayName,
            sourceRunCreated: sourceRun.created,
            ...(flowVersion.trigger.type === FlowTriggerType.PIECE ? { triggerType: FlowTriggerType.PIECE } : {}),
            steps: replaySteps,
            blockers,
            canReplay: blockers.length === 0,
        }
    },

    async resolveTriggerPayload({ sourceRun, projectId }: PrepareParams): Promise<ResolveTriggerPayloadResult> {
        const flowVersion = await flowVersionService(log).getOneOrThrow(sourceRun.flowVersionId)
        const triggerStep = sourceRun.steps?.[flowVersion.trigger.name]
        const { output, blockers, executeTrigger } = await resolveTriggerOutput({
            triggerStep,
            triggerName: flowVersion.trigger.name,
            triggerDisplayName: flowVersion.trigger.displayName,
            projectId,
            log,
        })
        if (blockers.length > 0 || isNil(output)) {
            throw new ActivepiecesError({
                code: ErrorCode.VALIDATION,
                params: {
                    message: blockers[0]?.code === FlowRunReplayBlockerCode.TRIGGER_INPUT_FILE_EXPIRED
                        ? 'A file attached to the original trigger input has expired, so this run cannot be replayed.'
                        : 'The original trigger input is no longer available; run replay preparation to see the details.',
                },
            })
        }
        return {
            payload: output,
            flowVersion,
            executeTrigger,
        }
    },
})

async function resolveTriggerOutput(params: ResolveTriggerOutputParams): Promise<ResolvedTriggerOutput> {
    const { triggerStep, triggerName, triggerDisplayName, projectId, log } = params
    const blockers: FlowRunReplayBlocker[] = []
    if (isNil(triggerStep) || isNil(triggerStep.output)) {
        blockers.push({
            code: FlowRunReplayBlockerCode.TRIGGER_PAYLOAD_MISSING,
            stepName: triggerName,
            stepDisplayName: triggerDisplayName,
        })
        return { output: undefined, blockers, executeTrigger: false }
    }

    const executeTrigger = triggerStep.status === StepOutputStatus.FAILED
    let output: unknown = triggerStep.output
    if (triggerStep.outputType === StepOutputType.SLICE) {
        const ref = isLogSliceRef(output) ? output : undefined
        const file = isNil(ref)
            ? undefined
            : await fileService(log).getDataOrUndefined({
                projectId,
                fileId: ref.fileId,
                type: FileType.FLOW_RUN_LOG_SLICE,
            })
        if (isNil(ref) || isNil(file)) {
            blockers.push({
                code: FlowRunReplayBlockerCode.TRIGGER_INPUT_FILE_EXPIRED,
                stepName: triggerName,
                stepDisplayName: triggerDisplayName,
                ...(ref ? { fileId: ref.fileId } : {}),
            })
            return { output: undefined, blockers, executeTrigger }
        }
        output = JSON.parse(file.data.toString('utf-8'))
    }

    const expiredFileIds = await findExpiredStepFiles({ payload: output, projectId, log })
    for (const fileId of expiredFileIds) {
        blockers.push({
            code: FlowRunReplayBlockerCode.TRIGGER_INPUT_FILE_EXPIRED,
            stepName: triggerName,
            stepDisplayName: triggerDisplayName,
            fileId,
        })
    }
    return blockers.length === 0
        ? { output, blockers, executeTrigger }
        : { output: undefined, blockers, executeTrigger }
}

function isLogSliceRef(value: unknown): value is LogSliceRef {
    const ref = asRecord(value)
    if (isNil(ref)) {
        return false
    }
    return typeof ref.fileId === 'string'
        && typeof ref.size === 'number'
        && typeof ref.url === 'string'
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return undefined
    }
    return Object.fromEntries(Object.entries(value))
}

const CONNECTION_TEMPLATE_PATTERN = /\{\{\s*connections\[\s*'([^']*)'(?:\s*,\s*'[^']*')*\s*\]\s*\}\}/

function getConnectionExternalId(step: Step): string | undefined {
    if (!('pieceName' in step.settings)) {
        return undefined
    }
    const auth = step.settings.input?.[AUTHENTICATION_PROPERTY_NAME]
    if (typeof auth !== 'string' || auth.length === 0) {
        return undefined
    }
    const templateMatch = auth.match(CONNECTION_TEMPLATE_PATTERN)
    if (templateMatch) {
        return templateMatch[1]
    }
    return auth
}

async function loadConnectionStatuses(params: LoadConnectionStatusesParams): Promise<Map<string, AppConnectionStatus>> {
    const { steps, projectId } = params
    const externalIds = [...new Set(steps
        .map(step => getConnectionExternalId(step))
        .filter((externalId): externalId is string => !isNil(externalId)))]
    if (externalIds.length === 0) {
        return new Map()
    }
    const connections = await appConnectionRepo().find({
        where: {
            externalId: In(externalIds),
            projectIds: ArrayContains([projectId]),
        },
    })
    const byExternalId = new Map<string, AppConnectionStatus>()
    for (const connection of connections) {
        byExternalId.set(connection.externalId, connection.status)
    }
    return byExternalId
}

async function findUnavailablePieces(params: FindUnavailablePiecesParams): Promise<Set<string>> {
    const { steps, projectId, platformId, log } = params
    const refs = new Map<string, { pieceName: string, pieceVersion: string }>()
    for (const step of steps) {
        if ('pieceName' in step.settings) {
            refs.set(`${step.settings.pieceName}@${step.settings.pieceVersion}`, {
                pieceName: step.settings.pieceName,
                pieceVersion: step.settings.pieceVersion,
            })
        }
    }
    const unavailable = new Set<string>()
    await Promise.all([...refs.values()].map(async (ref) => {
        const piece = await pieceMetadataService(log).get({
            name: ref.pieceName,
            version: ref.pieceVersion,
            projectId,
            platformId,
        })
        if (isNil(piece)) {
            unavailable.add(`${ref.pieceName}@${ref.pieceVersion}`)
        }
    }))
    return unavailable
}

async function findExpiredStepFiles(params: FindExpiredStepFilesParams): Promise<string[]> {
    const { payload, projectId, log } = params
    const fileIds = extractReferencedFileIds(payload)
    if (fileIds.length === 0) {
        return []
    }
    const missing: string[] = []
    for (const fileId of fileIds) {
        const exists = await fileService(log).exists({ projectId, fileId, type: FileType.FLOW_STEP_FILE })
        if (!exists) {
            missing.push(fileId)
        }
    }
    return [...new Set(missing)]
}

const STEP_FILE_URL_PATTERN = /\/v1\/files\/([A-Za-z0-9]{21})(?:\?|[/]|$)/g

function extractReferencedFileIds(value: unknown): string[] {
    const fileIds: string[] = []
    const walk = (node: unknown, seen: Set<unknown>): void => {
        if (isNil(node) || typeof node === 'number' || typeof node === 'boolean') {
            return
        }
        if (typeof node === 'string') {
            for (const match of node.matchAll(STEP_FILE_URL_PATTERN)) {
                fileIds.push(match[1])
            }
            return
        }
        if (typeof node !== 'object') {
            return
        }
        if (seen.has(node)) {
            return
        }
        seen.add(node)
        if (Array.isArray(node)) {
            for (const item of node) {
                walk(item, seen)
            }
            return
        }
        const record = asRecord(node)
        if (isNil(record)) {
            return
        }
        for (const child of Object.values(record)) {
            walk(child, seen)
        }
    }
    walk(value, new Set())
    return fileIds
}

type ResolveTriggerOutputParams = {
    triggerStep: StepOutput | undefined
    triggerName: string
    triggerDisplayName: string
    projectId: ProjectId
    log: FastifyBaseLogger
}

type ResolvedTriggerOutput = {
    output: unknown | undefined
    blockers: FlowRunReplayBlocker[]
    executeTrigger: boolean
}

type PrepareParams = {
    sourceRun: FlowRun
    projectId: ProjectId
}

type PrepareResult = {
    sourceRunId: string
    flowId: string
    flowVersionId: string
    flowDisplayName: string
    sourceRunCreated: string
    triggerType?: FlowTriggerType
    steps: FlowRunReplayStep[]
    blockers: FlowRunReplayBlocker[]
    canReplay: boolean
}

type ResolveTriggerPayloadResult = {
    payload: unknown
    flowVersion: FlowVersion
    executeTrigger: boolean
}

type LoadConnectionStatusesParams = {
    steps: Step[]
    projectId: ProjectId
}

type FindExpiredStepFilesParams = {
    payload: unknown
    projectId: ProjectId
    log: FastifyBaseLogger
}

type FindUnavailablePiecesParams = {
    steps: Step[]
    projectId: ProjectId
    platformId: string
    log: FastifyBaseLogger
}
