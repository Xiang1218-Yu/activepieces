import {
  flowStructureUtil,
  FlowVersion,
  SampleDataFileType,
} from '@activepieces/shared';
import { useQuery, QueryClient } from '@tanstack/react-query';

import { sampleDataApi } from '../api/sample-data-api';

export const sampleDataHooks = {
  useSampleDataForFlow: (
    flowVersion: FlowVersion | undefined,
    projectId: string | undefined,
  ) => {
    return useQuery({
      queryKey: sampleDataKeys.outputs(flowVersion?.id),
      enabled: !!flowVersion,
      staleTime: 0,
      retry: 4,
      refetchOnWindowFocus: false,
      queryFn: async () => {
        return fetchSampleDataForAllSteps({
          flowVersion: flowVersion!,
          projectId: projectId!,
          type: SampleDataFileType.OUTPUT,
        });
      },
    });
  },
  useSampleDataInputForFlow: (
    flowVersion: FlowVersion | undefined,
    projectId: string | undefined,
  ) => {
    return useQuery({
      queryKey: sampleDataKeys.inputs(flowVersion?.id),
      enabled: !!flowVersion,
      staleTime: 0,
      retry: 4,
      refetchOnWindowFocus: false,
      queryFn: async () => {
        return fetchSampleDataForAllSteps({
          flowVersion: flowVersion!,
          projectId: projectId!,
          type: SampleDataFileType.INPUT,
        });
      },
    });
  },
  invalidateSampleData: (flowVersionId: string, queryClient: QueryClient) => {
    queryClient.invalidateQueries({
      queryKey: sampleDataKeys.all(flowVersionId),
    });
  },
};

export async function fetchSampleDataForAllSteps({
  flowVersion,
  projectId,
  type,
}: {
  flowVersion: FlowVersion;
  projectId: string;
  type: SampleDataFileType;
}): Promise<Record<string, unknown>> {
  const steps = flowStructureUtil.getAllSteps(flowVersion.trigger);
  const singleStepSampleData = await Promise.all(
    steps.map(async (step) => {
      if (
        type === SampleDataFileType.INPUT &&
        !step.settings.sampleData?.sampleDataInputFileId
      ) {
        return { [step.name]: undefined };
      }
      return {
        [step.name]: await getSampleData({
          flowVersion,
          stepName: step.name,
          projectId,
          type,
        }),
      };
    }),
  );
  const sampleData: Record<string, unknown> = {};
  singleStepSampleData.forEach((stepData) => {
    Object.assign(sampleData, stepData);
  });
  return sampleData;
}

export function setSampleDataForStep({
  queryClient,
  flowVersionId,
  stepName,
  type,
  value,
}: {
  queryClient: QueryClient;
  flowVersionId: string;
  stepName: string;
  type: SampleDataFileType;
  value: unknown;
}) {
  const key =
    type === SampleDataFileType.OUTPUT
      ? sampleDataKeys.outputs(flowVersionId)
      : sampleDataKeys.inputs(flowVersionId);
  queryClient.setQueryData<Record<string, unknown>>(key, (previous) => ({
    ...(previous ?? {}),
    [stepName]: value,
  }));
}

export const sampleDataKeys = {
  all: (flowVersionId: string) => ['sampleData', flowVersionId] as const,
  outputs: (flowVersionId: string | undefined) =>
    ['sampleData', flowVersionId, 'output'] as const,
  inputs: (flowVersionId: string | undefined) =>
    ['sampleData', flowVersionId, 'input'] as const,
};

async function getSampleData({
  flowVersion,
  stepName,
  projectId,
  type,
}: {
  flowVersion: FlowVersion;
  stepName: string;
  projectId: string;
  type: SampleDataFileType;
}): Promise<unknown> {
  return sampleDataApi
    .get({
      flowId: flowVersion.flowId,
      flowVersionId: flowVersion.id,
      stepName,
      projectId,
      type,
    })
    .catch((error) => {
      console.error(error);
      return undefined;
    });
}
