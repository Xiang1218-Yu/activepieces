import { ErrorCode } from '@activepieces/core-utils';
import {
  ApFlagId,
  FlowRetryStrategy,
  FlowRunWithRetryError,
  canRetryFlowRun,
  getFlowRunRetryUnavailableReason,
} from '@activepieces/shared';
import { useMutation } from '@tanstack/react-query';
import { t } from 'i18next';
import { ExternalLink, Redo, RotateCw } from 'lucide-react';
import { useRef } from 'react';

import { Button } from '@/components/ui/button';
import { internalErrorToast } from '@/components/ui/sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { flowRunsApi } from '@/features/flow-runs/api/flow-runs-api';
import { flowRunUtils } from '@/features/flow-runs/utils/flow-run-utils';
import { flagsHooks } from '@/hooks/flags-hooks';
import { authenticationSession } from '@/lib/authentication-session';
import { formatUtils } from '@/lib/format-utils';
import { useNewWindow } from '@/lib/navigation-utils';
import { cn } from '@/lib/utils';

type FailedRetryRunsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  failedRuns: Required<FlowRunWithRetryError>[];
  skippedRuns: Required<FlowRunWithRetryError>[];
  onRetried: (
    resultRuns: FlowRunWithRetryError[],
    attemptedRunIds: string[],
  ) => void;
};

export const FailedRetryRunsDialog = ({
  open,
  onOpenChange,
  failedRuns,
  skippedRuns,
  onRetried,
}: FailedRetryRunsDialogProps) => {
  const openNewWindow = useNewWindow();
  const projectId = authenticationSession.getProjectId()!;
  const { data: retentionDays } = flagsHooks.useFlag<number>(
    ApFlagId.EXECUTION_DATA_RETENTION_DAYS,
  );
  const retryableRuns = [...failedRuns, ...skippedRuns];
  const lastRequestedRunIds = useRef<string[]>([]);
  const retryLatestMutation = useMutation<
    FlowRunWithRetryError[],
    Error,
    void
  >({
    mutationFn: async () => {
      const flowRunIds = retryableRuns
        .filter((run) =>
          canRetryFlowRun({
            status: run.status,
            archivedAt: run.archivedAt,
            strategy: FlowRetryStrategy.ON_LATEST_VERSION,
          }),
        )
        .map((run) => run.id);
      lastRequestedRunIds.current = flowRunIds;
      if (flowRunIds.length === 0) {
        return [];
      }
      return flowRunsApi.bulkRetry({
        projectId,
        flowRunIds,
        strategy: FlowRetryStrategy.ON_LATEST_VERSION,
        includeArchived: true,
      });
    },
    onSuccess: (runs) => {
      onRetried(runs, lastRequestedRunIds.current);
    },
    onError: () => internalErrorToast(),
  });
  const retryFromFailedStepMutation = useMutation<
    FlowRunWithRetryError[],
    Error,
    void
  >({
    mutationFn: async () => {
      const flowRunIds = retryableRuns
        .filter((run) =>
          canRetryFlowRun({
            status: run.status,
            archivedAt: run.archivedAt,
            strategy: FlowRetryStrategy.FROM_FAILED_STEP,
          }),
        )
        .map((run) => run.id);
      lastRequestedRunIds.current = flowRunIds;
      if (flowRunIds.length === 0) {
        return [];
      }
      return flowRunsApi.bulkRetry({
        projectId,
        flowRunIds,
        strategy: FlowRetryStrategy.FROM_FAILED_STEP,
        includeArchived: true,
      });
    },
    onSuccess: (runs) => {
      onRetried(runs, lastRequestedRunIds.current);
    },
    onError: () => internalErrorToast(),
  });
  const retryRunMutation = useMutation<
    FlowRunWithRetryError[],
    Error,
    { flowRunId: string; strategy: FlowRetryStrategy }
  >({
    mutationFn: async ({
      flowRunId,
      strategy,
    }: {
      flowRunId: string
      strategy: FlowRetryStrategy
    }) => {
      lastRequestedRunIds.current = [flowRunId];
      return flowRunsApi.bulkRetry({
        projectId,
        flowRunIds: [flowRunId],
        strategy,
        includeArchived: true,
      });
    },
    onSuccess: (runs) => {
      onRetried(runs, lastRequestedRunIds.current);
    },
    onError: () => internalErrorToast(),
  });
  const latestVersionRetryableCount = retryableRuns.filter((run) =>
    canRetryFlowRun({
      status: run.status,
      archivedAt: run.archivedAt,
      strategy: FlowRetryStrategy.ON_LATEST_VERSION,
    }),
  ).length;
  const failedRetryableCount = retryableRuns.filter((run) =>
    canRetryFlowRun({
      status: run.status,
      archivedAt: run.archivedAt,
      strategy: FlowRetryStrategy.FROM_FAILED_STEP,
    }),
  ).length;


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {failedRuns.length > 0 && skippedRuns.length > 0
              ? t('Failed and skipped retries')
              : skippedRuns.length > 0
                ? t('Skipped retries')
                : t('Failed Retries')}
          </DialogTitle>
        </DialogHeader>
        {(latestVersionRetryableCount > 0 || failedRetryableCount > 0) && (
          <div className="flex gap-2">
            {latestVersionRetryableCount > 0 && (
              <Button
                size="sm"
                variant="outline"
                loading={retryLatestMutation.isPending}
                onClick={() => retryLatestMutation.mutate()}
              >
                <RotateCw className="size-4 mr-1" />
                {t('Retry {{count}} on latest version', {
                  count: latestVersionRetryableCount,
                })}
              </Button>
            )}
            {failedRetryableCount > 0 && (
              <Button
                size="sm"
                variant="outline"
                loading={retryFromFailedStepMutation.isPending}
                onClick={() => retryFromFailedStepMutation.mutate()}
              >
                <Redo className="size-4 mr-1" />
                {t('Retry {{count}} from failed step', {
                  count: failedRetryableCount,
                })}
              </Button>
            )}
          </div>
        )}
        <ScrollArea className="max-h-[400px]">
          <ul className="flex flex-col gap-3 pr-3">
            {retryableRuns.map((run) => {
              const { Icon, variant } = flowRunUtils.getStatusIcon(run.status);
              const canRetryOnLatestVersion = canRetryFlowRun({
                status: run.status,
                archivedAt: run.archivedAt,
                strategy: FlowRetryStrategy.ON_LATEST_VERSION,
              });
              const canRetryFromFailedStep = canRetryFlowRun({
                status: run.status,
                archivedAt: run.archivedAt,
                strategy: FlowRetryStrategy.FROM_FAILED_STEP,
              });
              return (
                <li
                  key={run.id}
                  className="flex items-start justify-between gap-3 rounded-md border p-3"
                >
                  <div className="flex flex-col gap-1 min-w-0">
                    <div className="flex items-center gap-1.5 text-sm font-medium">
                      <Icon
                        className={cn('size-4 shrink-0', {
                          'text-destructive': variant === 'error',
                          'text-success': variant === 'success',
                          'text-muted-foreground': variant === 'default',
                        })}
                      />
                      <span className="truncate">
                        {run.skipped ? t('Skipped') : t('Failed')} ·{' '}
                        {formatUtils.convertEnumToHumanReadable(run.status)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {run.error?.errorCode ===
                      ErrorCode.FLOW_RUN_RETRY_OUTSIDE_RETENTION
                        ? t(
                            'Retry is only available for {failedJobRetentionDays} after a run fails.',
                            {
                              failedJobRetentionDays: retentionDays,
                            },
                          )
                        : getRetryErrorMessage(run.error.errorMessage)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {canRetryOnLatestVersion
                        ? t('Available: retry on latest version')
                        : canRetryFromFailedStep
                          ? t('Available: retry from failed step')
                          : getFlowRunRetryUnavailableReason({
                              status: run.status,
                              archivedAt: run.archivedAt,
                              strategy:
                                FlowRetryStrategy.ON_LATEST_VERSION,
                            }) ?? t('No retry is available for this run')}
                    </p>
                  </div>
                  <div className="flex shrink-0">
                    {canRetryOnLatestVersion && (
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={retryRunMutation.isPending}
                        onClick={() =>
                          retryRunMutation.mutate({
                            flowRunId: run.id,
                            strategy: FlowRetryStrategy.ON_LATEST_VERSION,
                          })
                        }
                      >
                        <RotateCw className="size-4" />
                        <span className="sr-only">{t('Retry')}</span>
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        openNewWindow(
                          authenticationSession.appendProjectRoutePrefix(
                            `/runs/${run.id}`,
                          ),
                        )
                      }
                    >
                      <ExternalLink className="size-4" />
                      <span className="sr-only">{t('Open run')}</span>
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};

function getRetryErrorMessage(message: string): string {
  const translated = t(message);
  return translated === message ? message : translated;
}
