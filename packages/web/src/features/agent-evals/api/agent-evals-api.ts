import {
  AgentEvalCase,
  AgentEvalCaseResult,
  AgentEvalRun,
  AgentEvalSuite,
  CreateAgentEvalRunRequest,
  CreateAgentEvalSuiteRequest,
  ListAgentEvalCaseResultsRequest,
  UpdateAgentEvalSuiteRequest,
  UpsertAgentEvalCaseRequest,
} from '@activepieces/shared';

import { api } from '@/lib/api';

const base = (projectId: string) => `/v1/projects/${projectId}/agent-eval`;

export const agentEvalsApi = {
  listSuites(projectId: string, agentId?: string): Promise<AgentEvalSuite[]> {
    return api.get<AgentEvalSuite[]>(`${base(projectId)}/suites`, {
      ...(agentId ? { agentId } : {}),
    });
  },
  getSuite(projectId: string, suiteId: string): Promise<AgentEvalSuite> {
    return api.get<AgentEvalSuite>(`${base(projectId)}/suites/${suiteId}`);
  },
  createSuite(
    projectId: string,
    request: CreateAgentEvalSuiteRequest,
  ): Promise<AgentEvalSuite> {
    return api.post<AgentEvalSuite>(`${base(projectId)}/suites`, request);
  },
  updateSuite(
    projectId: string,
    suiteId: string,
    request: UpdateAgentEvalSuiteRequest,
  ): Promise<AgentEvalSuite> {
    return api.post<AgentEvalSuite>(
      `${base(projectId)}/suites/${suiteId}`,
      request,
    );
  },
  deleteSuite(projectId: string, suiteId: string): Promise<void> {
    return api.delete<void>(`${base(projectId)}/suites/${suiteId}`);
  },
  listCases(projectId: string, suiteId: string): Promise<AgentEvalCase[]> {
    return api.get<AgentEvalCase[]>(
      `${base(projectId)}/suites/${suiteId}/cases`,
    );
  },
  addCase(
    projectId: string,
    suiteId: string,
    request: UpsertAgentEvalCaseRequest,
  ): Promise<AgentEvalCase> {
    return api.post<AgentEvalCase>(
      `${base(projectId)}/suites/${suiteId}/cases`,
      request,
    );
  },
  updateCase(
    projectId: string,
    suiteId: string,
    caseId: string,
    request: UpsertAgentEvalCaseRequest,
  ): Promise<AgentEvalCase> {
    return api.post<AgentEvalCase>(
      `${base(projectId)}/suites/${suiteId}/cases/${caseId}`,
      request,
    );
  },
  deleteCase(
    projectId: string,
    suiteId: string,
    caseId: string,
  ): Promise<void> {
    return api.delete<void>(
      `${base(projectId)}/suites/${suiteId}/cases/${caseId}`,
    );
  },
  startRun(
    projectId: string,
    request: CreateAgentEvalRunRequest,
  ): Promise<AgentEvalRun> {
    return api.post<AgentEvalRun>(`${base(projectId)}/runs`, request);
  },
  listRuns(projectId: string, suiteId?: string): Promise<AgentEvalRun[]> {
    return api.get<AgentEvalRun[]>(`${base(projectId)}/runs`, {
      ...(suiteId ? { suiteId } : {}),
    });
  },
  getRun(projectId: string, runId: string): Promise<AgentEvalRun> {
    return api.get<AgentEvalRun>(`${base(projectId)}/runs/${runId}`);
  },
  listResults(
    projectId: string,
    runId: string,
    request?: ListAgentEvalCaseResultsRequest,
  ): Promise<AgentEvalCaseResult[]> {
    return api.get<AgentEvalCaseResult[]>(
      `${base(projectId)}/runs/${runId}/results`,
      request ?? {},
    );
  },
};
