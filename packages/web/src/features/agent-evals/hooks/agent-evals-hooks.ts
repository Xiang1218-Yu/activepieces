import {
  AgentEvalRunStatus,
  CreateAgentEvalRunRequest,
  CreateAgentEvalSuiteRequest,
  ListAgentEvalCaseResultsRequest,
  UpdateAgentEvalSuiteRequest,
  UpsertAgentEvalCaseRequest,
} from '@activepieces/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { internalErrorToast } from '@/components/ui/sonner';

import { agentEvalsApi } from '../api/agent-evals-api';

const EVAL_SUITES_KEY = 'agent-eval-suites';
const EVAL_CASES_KEY = 'agent-eval-cases';
const EVAL_RUNS_KEY = 'agent-eval-runs';
const EVAL_RESULTS_KEY = 'agent-eval-results';

const RUN_POLL_INTERVAL_MS = 3000;

export const agentEvalQueries = {
  useSuites(projectId: string, agentId?: string) {
    return useQuery({
      queryKey: [EVAL_SUITES_KEY, projectId, agentId],
      queryFn: () => agentEvalsApi.listSuites(projectId, agentId),
    });
  },
  useSuite(projectId: string, suiteId: string) {
    return useQuery({
      queryKey: [EVAL_SUITES_KEY, projectId, 'one', suiteId],
      queryFn: () => agentEvalsApi.getSuite(projectId, suiteId),
    });
  },
  useCases(projectId: string, suiteId: string) {
    return useQuery({
      queryKey: [EVAL_CASES_KEY, projectId, suiteId],
      queryFn: () => agentEvalsApi.listCases(projectId, suiteId),
    });
  },
  useRuns(projectId: string, suiteId?: string) {
    return useQuery({
      queryKey: [EVAL_RUNS_KEY, projectId, suiteId],
      queryFn: () => agentEvalsApi.listRuns(projectId, suiteId),
    });
  },
  useRun(projectId: string, runId: string) {
    return useQuery({
      queryKey: [EVAL_RUNS_KEY, projectId, 'one', runId],
      queryFn: () => agentEvalsApi.getRun(projectId, runId),
      refetchInterval: (query) =>
        query.state.data?.status === AgentEvalRunStatus.RUNNING
          ? RUN_POLL_INTERVAL_MS
          : false,
    });
  },
  useResults(
    projectId: string,
    runId: string,
    request?: ListAgentEvalCaseResultsRequest,
    isRunning?: boolean,
  ) {
    return useQuery({
      queryKey: [EVAL_RESULTS_KEY, projectId, runId, request],
      queryFn: () => agentEvalsApi.listResults(projectId, runId, request),
      refetchInterval: isRunning ? RUN_POLL_INTERVAL_MS : false,
    });
  },
};

export const agentEvalMutations = {
  useCreateSuite(projectId: string) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (request: CreateAgentEvalSuiteRequest) =>
        agentEvalsApi.createSuite(projectId, request),
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: [EVAL_SUITES_KEY, projectId],
        });
      },
      onError: () => internalErrorToast(),
    });
  },
  useUpdateSuite(projectId: string, suiteId: string) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (request: UpdateAgentEvalSuiteRequest) =>
        agentEvalsApi.updateSuite(projectId, suiteId, request),
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: [EVAL_SUITES_KEY, projectId],
        });
      },
      onError: () => internalErrorToast(),
    });
  },
  useDeleteSuite(projectId: string) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (suiteId: string) =>
        agentEvalsApi.deleteSuite(projectId, suiteId),
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: [EVAL_SUITES_KEY, projectId],
        });
        queryClient.invalidateQueries({ queryKey: [EVAL_RUNS_KEY, projectId] });
      },
      onError: () => internalErrorToast(),
    });
  },
  useSaveCase(projectId: string, suiteId: string) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: ({
        caseId,
        request,
      }: {
        caseId?: string;
        request: UpsertAgentEvalCaseRequest;
      }) =>
        caseId
          ? agentEvalsApi.updateCase(projectId, suiteId, caseId, request)
          : agentEvalsApi.addCase(projectId, suiteId, request),
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: [EVAL_CASES_KEY, projectId, suiteId],
        });
      },
      onError: () => internalErrorToast(),
    });
  },
  useDeleteCase(projectId: string, suiteId: string) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (caseId: string) =>
        agentEvalsApi.deleteCase(projectId, suiteId, caseId),
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: [EVAL_CASES_KEY, projectId, suiteId],
        });
      },
      onError: () => internalErrorToast(),
    });
  },
  useStartRun(projectId: string) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (request: CreateAgentEvalRunRequest) =>
        agentEvalsApi.startRun(projectId, request),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: [EVAL_RUNS_KEY, projectId] });
      },
      onError: () => internalErrorToast(),
    });
  },
};
