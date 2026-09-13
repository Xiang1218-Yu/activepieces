import { ActivepiecesError, apId, ErrorCode, isNil, sanitizeObjectForPostgresql } from '@activepieces/core-utils'
import { AgentEvalCase, AgentEvalSuite, CreateAgentEvalSuiteRequest, MAX_EVAL_CASES_PER_SUITE, UpdateAgentEvalSuiteRequest, UpsertAgentEvalCaseRequest } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { repoFactory } from '../../../core/db/repo-factory'
import { agentService } from '../agent-service'
import { AgentEvalCaseEntity, AgentEvalSuiteEntity } from './agent-eval-entities'

const suiteRepo = repoFactory(AgentEvalSuiteEntity)
const caseRepo = repoFactory(AgentEvalCaseEntity)

export const agentEvalSuiteService = (log: FastifyBaseLogger) => ({
    async create({ projectId, platformId, userId, request }: CreateParams): Promise<AgentEvalSuite> {
        // The suite binds to one agent; make sure it lives in this project before anything hangs off it.
        await agentService(log).getOneOrThrow({ id: request.agentId, projectId, userId })
        return suiteRepo().save({
            id: apId(),
            projectId,
            agentId: request.agentId,
            name: request.name,
            description: request.description ?? null,
            variableNames: request.variableNames ?? [],
        })
    },

    async list({ projectId, agentId }: ListParams): Promise<AgentEvalSuite[]> {
        return suiteRepo().find({
            where: {
                projectId,
                ...(isNil(agentId) ? {} : { agentId }),
            },
            order: { updated: 'DESC' },
        })
    },

    async getOneOrThrow({ id, projectId }: GetParams): Promise<AgentEvalSuite> {
        const suite = await suiteRepo().findOneBy({ id, projectId })
        if (isNil(suite)) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: { entityId: id, entityType: 'AgentEvalSuite' },
            })
        }
        return suite
    },

    async update({ id, projectId, request }: UpdateParams): Promise<AgentEvalSuite> {
        const suite = await this.getOneOrThrow({ id, projectId })
        return suiteRepo().save({
            ...suite,
            ...(request.name !== undefined ? { name: request.name } : {}),
            ...(request.description !== undefined ? { description: request.description } : {}),
            ...(request.variableNames !== undefined ? { variableNames: request.variableNames } : {}),
        })
    },

    async delete({ id, projectId }: GetParams): Promise<void> {
        await this.getOneOrThrow({ id, projectId })
        await suiteRepo().delete({ id })
    },

    async addCase({ suiteId, projectId, request }: CaseParams): Promise<AgentEvalCase> {
        await this.getOneOrThrow({ id: suiteId, projectId })
        const count = await caseRepo().countBy({ suiteId })
        if (count >= MAX_EVAL_CASES_PER_SUITE) {
            throw new ActivepiecesError({
                code: ErrorCode.VALIDATION,
                params: { message: `A suite holds at most ${MAX_EVAL_CASES_PER_SUITE} cases` },
            })
        }
        const maxSort = await caseRepo().maximum('sortOrder', { suiteId })
        return caseRepo().save({
            id: apId(),
            suiteId,
            name: request.name,
            messageTemplate: request.messageTemplate,
            variables: sanitizeObjectForPostgresql(request.variables),
            expectedOutput: request.expectedOutput ?? null,
            sortOrder: request.sortOrder ?? (typeof maxSort === 'number' ? maxSort + 1 : 0),
        })
    },

    async updateCase({ suiteId, projectId, caseId, request }: UpdateCaseParams): Promise<AgentEvalCase> {
        await this.getOneOrThrow({ id: suiteId, projectId })
        const existing = await this.getCaseOrThrow({ suiteId, caseId })
        return caseRepo().save({
            ...existing,
            name: request.name,
            messageTemplate: request.messageTemplate,
            variables: sanitizeObjectForPostgresql(request.variables),
            expectedOutput: request.expectedOutput ?? null,
            ...(request.sortOrder !== undefined ? { sortOrder: request.sortOrder } : {}),
        })
    },

    async deleteCase({ suiteId, projectId, caseId }: DeleteCaseParams): Promise<void> {
        await this.getOneOrThrow({ id: suiteId, projectId })
        await this.getCaseOrThrow({ suiteId, caseId })
        await caseRepo().delete({ id: caseId })
    },

    async listCases({ suiteId, projectId }: ListCasesParams): Promise<AgentEvalCase[]> {
        await this.getOneOrThrow({ id: suiteId, projectId })
        return caseRepo().find({
            where: { suiteId },
            order: { sortOrder: 'ASC', created: 'ASC' },
        })
    },

    async getCaseOrThrow({ suiteId, caseId }: { suiteId: string, caseId: string }): Promise<AgentEvalCase> {
        const evalCase = await caseRepo().findOneBy({ id: caseId, suiteId })
        if (isNil(evalCase)) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: { entityId: caseId, entityType: 'AgentEvalCase' },
            })
        }
        return evalCase
    },
})

type CreateParams = {
    projectId: string
    platformId: string
    userId: string
    request: CreateAgentEvalSuiteRequest
}

type ListParams = {
    projectId: string
    agentId?: string
}

type GetParams = {
    id: string
    projectId: string
}

type UpdateParams = {
    id: string
    projectId: string
    request: UpdateAgentEvalSuiteRequest
}

type CaseParams = {
    suiteId: string
    projectId: string
    request: UpsertAgentEvalCaseRequest
}

type UpdateCaseParams = CaseParams & {
    caseId: string
}

type DeleteCaseParams = {
    suiteId: string
    projectId: string
    caseId: string
}

type ListCasesParams = {
    suiteId: string
    projectId: string
}
