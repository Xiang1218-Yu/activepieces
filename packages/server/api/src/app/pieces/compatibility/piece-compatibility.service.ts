import { ActivepiecesError, ErrorCode, isNil } from '@activepieces/core-utils'
import { PieceMetadataModel } from '@activepieces/pieces-framework'
import {
    CheckPieceCompatibilityRequest,
    FlowAction,
    FlowActionType,
    FlowCompatibilityResult,
    FlowCompatibilityStatus,
    flowStructureUtil,
    FlowTrigger,
    FlowTriggerType,
    FlowVersion,
    MAX_PROJECT_FLOWS_PER_CHECK,
    PieceCompatibilityReport,
    PieceCompatibilitySummary,
    PieceStepCompatibilityVerdict,
    ProjectFlowVersionSource,
} from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { In } from 'typeorm'
import { z } from 'zod'
import { flowRepo } from '../../flows/flow/flow.repo'
import { flowVersionRepo } from '../../flows/flow-version/flow-version.service'
import { projectService } from '../../project/project-service'
import { pieceMetadataService } from '../metadata/piece-metadata-service'
import { assessPieceStep } from './piece-compatibility-diff'

/**
 * Orchestrates the piece compatibility check: resolves both piece versions,
 * collects the flow versions to check (pasted JSON or read from a project)
 * and assesses every step that uses the piece. Each flow version is checked
 * in isolation — a malformed or failing flow degrades to an ERROR row and
 * never hides the results of the remaining flows.
 */
export const pieceCompatibilityService = (log: FastifyBaseLogger): { check: (params: CheckParams) => Promise<PieceCompatibilityReport> } => ({
    async check({ platformId, request }: CheckParams): Promise<PieceCompatibilityReport> {
        const [fromPiece, toPiece] = await Promise.all([
            pieceMetadataService(log).getOrThrow({
                name: request.pieceName,
                version: request.fromVersion,
                platformId,
            }),
            pieceMetadataService(log).getOrThrow({
                name: request.pieceName,
                version: request.toVersion,
                platformId,
            }),
        ])

        const targets = await resolveFlowVersionTargets({ source: request.source, platformId, log })
        const flows = targets.map((target) => assessTarget({ target, fromPiece, toPiece, pieceName: request.pieceName, log }))

        return {
            pieceName: request.pieceName,
            fromVersion: fromPiece.version,
            toVersion: toPiece.version,
            generatedAt: new Date().toISOString(),
            summary: buildSummary(flows),
            flows,
        }
    },
})

type CheckParams = {
    platformId: string | undefined
    request: CheckPieceCompatibilityRequest
}

type FlowVersionTarget = {
    flowId: string | null
    flowVersionId: string | null
    flowDisplayName: string | null
    projectId: string | null
    projectName: string | null
    trigger: unknown
}

type ResolvedTarget = FlowVersionTarget | ErroredTarget

type ErroredTarget = {
    error: string
    flowId: string | null
    flowVersionId: string | null
    flowDisplayName: string | null
}

const PastedFlowVersion = z.object({
    id: z.string().optional(),
    flowId: z.string().optional(),
    displayName: z.string().optional(),
    trigger: z.record(z.string(), z.unknown()),
})

const FlowVersionIdentity = z.object({
    id: z.string().optional(),
    flowId: z.string().optional(),
    displayName: z.string().optional(),
})

async function resolveFlowVersionTargets({ source, platformId, log }: ResolveTargetsParams): Promise<ResolvedTarget[]> {
    if (source.type === 'PASTED') {
        return source.flowVersions.map((raw) => {
            const parsed = PastedFlowVersion.safeParse(raw)
            if (parsed.success) {
                return {
                    flowId: parsed.data.flowId ?? null,
                    flowVersionId: parsed.data.id ?? null,
                    flowDisplayName: parsed.data.displayName ?? null,
                    projectId: null,
                    projectName: null,
                    trigger: parsed.data.trigger,
                }
            }
            // Surface whatever identity the payload still carries so the failed
            // row can be traced back to its flow.
            const identity = FlowVersionIdentity.safeParse(raw)
            return {
                error: `Invalid flow version payload: ${parsed.error.issues[0]?.message ?? 'expected an object with a trigger'}`,
                flowId: identity.success ? identity.data.flowId ?? null : null,
                flowVersionId: identity.success ? identity.data.id ?? null : null,
                flowDisplayName: identity.success ? identity.data.displayName ?? null : null,
            }
        })
    }
    return loadProjectTargets({ source, platformId, log })
}

async function loadProjectTargets({ source, platformId, log }: LoadProjectTargetsParams): Promise<FlowVersionTarget[]> {
    const project = await projectService(log).getOne(source.projectId)
    if (isNil(project) || project.platformId !== platformId) {
        throw new ActivepiecesError({
            code: ErrorCode.ENTITY_NOT_FOUND,
            params: {
                entityType: 'project',
                entityId: source.projectId,
            },
        })
    }

    const flows = await flowRepo().find({
        where: {
            projectId: source.projectId,
            ...(!isNil(source.flowIds) ? { id: In(source.flowIds) } : {}),
        },
    })
    if (flows.length > MAX_PROJECT_FLOWS_PER_CHECK) {
        throw new ActivepiecesError({
            code: ErrorCode.VALIDATION,
            params: {
                message: `Project has ${flows.length} flows, which exceeds the limit of ${MAX_PROJECT_FLOWS_PER_CHECK} per check. Pass flowIds to check a subset.`,
            },
        })
    }
    if (flows.length === 0) {
        return []
    }

    const versions = await flowVersionRepo().find({
        where: { flowId: In(flows.map((flow) => flow.id)) },
        order: { created: 'DESC' },
    })
    const selected = selectLatestAndPublished(versions, flows.map((flow) => flow.publishedVersionId))

    return selected.map((version) => ({
        flowId: version.flowId,
        flowVersionId: version.id,
        flowDisplayName: version.displayName,
        projectId: project.id,
        projectName: project.displayName,
        trigger: version.trigger,
    }))
}

function selectLatestAndPublished(versions: FlowVersion[], publishedVersionIds: (string | null | undefined)[]): FlowVersion[] {
    const publishedIds = new Set(publishedVersionIds.filter((id): id is string => !isNil(id)))
    const selected = new Map<string, FlowVersion>()
    const latestSeen = new Set<string>()
    for (const version of versions) {
        // versions arrive newest-first: the first occurrence per flow is the latest
        if (!latestSeen.has(version.flowId)) {
            latestSeen.add(version.flowId)
            selected.set(version.id, version)
        }
        if (publishedIds.has(version.id)) {
            selected.set(version.id, version)
        }
    }
    return [...selected.values()]
}

type AssessTargetParams = {
    target: ResolvedTarget
    fromPiece: PieceMetadataModel
    toPiece: PieceMetadataModel
    pieceName: string
    log: FastifyBaseLogger
}

function assessTarget({ target, fromPiece, toPiece, pieceName, log }: AssessTargetParams): FlowCompatibilityResult {
    if ('error' in target) {
        return {
            status: FlowCompatibilityStatus.ERROR,
            flowId: target.flowId,
            flowVersionId: target.flowVersionId,
            flowDisplayName: target.flowDisplayName,
            projectId: null,
            projectName: null,
            error: target.error,
            steps: [],
        }
    }
    const location = {
        flowId: target.flowId,
        flowVersionId: target.flowVersionId,
        flowDisplayName: target.flowDisplayName,
        projectId: target.projectId,
        projectName: target.projectName,
    }
    try {
        const steps = flowStructureUtil.getAllSteps(target.trigger as FlowTrigger)
        const results = steps
            .filter((step) => isPieceStepForPiece(step, pieceName))
            .map((step) => assessPieceStep({ step, fromPiece, toPiece }))
        return {
            status: results.length === 0 ? FlowCompatibilityStatus.NOT_USING_PIECE : FlowCompatibilityStatus.CHECKED,
            ...location,
            steps: results,
        }
    }
    catch (error) {
        log.warn({ err: error, flowVersionId: target.flowVersionId }, '[pieceCompatibilityService] failed to check flow version, continuing with remaining flows')
        return {
            status: FlowCompatibilityStatus.ERROR,
            ...location,
            error: error instanceof Error ? error.message : String(error),
            steps: [],
        }
    }
}

function isPieceStepForPiece(step: FlowAction | FlowTrigger, pieceName: string): boolean {
    if (step.type !== FlowActionType.PIECE && step.type !== FlowTriggerType.PIECE) {
        return false
    }
    const settings = step.settings as { pieceName?: unknown } | undefined
    return settings?.pieceName === pieceName
}

function buildSummary(flows: FlowCompatibilityResult[]): PieceCompatibilitySummary {
    const steps = flows.flatMap((flow) => flow.steps)
    const countByVerdict = (verdict: PieceStepCompatibilityVerdict): number => steps.filter((step) => step.verdict === verdict).length
    return {
        flowsChecked: flows.filter((flow) => flow.status !== FlowCompatibilityStatus.ERROR).length,
        flowsErrored: flows.filter((flow) => flow.status === FlowCompatibilityStatus.ERROR).length,
        flowsNotUsingPiece: flows.filter((flow) => flow.status === FlowCompatibilityStatus.NOT_USING_PIECE).length,
        stepsChecked: steps.length,
        compatibleSteps: countByVerdict(PieceStepCompatibilityVerdict.COMPATIBLE),
        displayOnlySteps: countByVerdict(PieceStepCompatibilityVerdict.DISPLAY_ONLY),
        reauthRequiredSteps: countByVerdict(PieceStepCompatibilityVerdict.REAUTH_REQUIRED),
        incompatibleSteps: countByVerdict(PieceStepCompatibilityVerdict.INCOMPATIBLE),
    }
}

type ResolveTargetsParams = {
    source: CheckPieceCompatibilityRequest['source']
    platformId: string | undefined
    log: FastifyBaseLogger
}

type LoadProjectTargetsParams = {
    source: ProjectFlowVersionSource
    platformId: string | undefined
    log: FastifyBaseLogger
}
