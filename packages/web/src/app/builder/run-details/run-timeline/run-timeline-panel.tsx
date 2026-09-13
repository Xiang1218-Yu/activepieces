import { isNil, Permission } from '@activepieces/core-utils';
import {
  FlowAction,
  FlowActionType,
  FlowRetryStrategy,
  FlowRunStatus,
  isFailedState,
  isFlowRunStateTerminal,
  StepOutput,
} from '@activepieces/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Ban, ChevronDown, ListTree, Repeat, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { PermissionNeededTooltip } from '@/components/custom/permission-needed-tooltip';
import { LoadingSpinner } from '@/components/custom/spinner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { VirtualizedList } from '@/components/ui/virtualized-list';
import { flowRunMutations } from '@/features/flow-runs/hooks/flow-run-hooks';
import { stepsHooks } from '@/features/pieces/hooks/steps-hooks';
import { useAuthorization } from '@/hooks/authorization-hooks';
import { authenticationSession } from '@/lib/authentication-session';
import { cn } from '@/lib/utils';

import { useBuilderStateContext } from '../../builder-hooks';
import { TimelineRow } from './run-timeline-row';
import {
  buildRunTimelineTree,
  collectInitiallyExpandedIds,
  flattenTimelineTree,
  TimelineNode,
  TimelineStepNode,
} from './run-timeline-tree';

// Loops commonly fan out into hundreds / thousands of iterations. Rows mount
// lazily through the virtualizer, and iterations themselves are revealed in
// chunks so expanding a huge loop does not flood the DOM on the first click.
const DEFAULT_VISIBLE_ITERATIONS = 50;
const ITERATION_PAGE_SIZE = 50;
const VIRTUALIZE_THRESHOLD = 60;
const ROW_ESTIMATE_HEIGHT = 36;

const RunTimelinePanel = ({ onClose }: { onClose: () => void }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [run, flowVersion, selectedStepName, selectStepByName, setLoopIndex] =
    useBuilderStateContext((state) => [
      state.run,
      state.flowVersion,
      state.selectedStep,
      state.selectStepByName,
      state.setLoopIndex,
    ]);

  const { checkAccess } = useAuthorization();
  const userHasPermissionToWriteRun = checkAccess(Permission.WRITE_RUN);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [hasInitialized, setHasInitialized] = useState(false);
  const [visibleIterations, setVisibleIterations] = useState<
    Record<string, number>
  >({});

  const runSteps = (run?.steps ?? {}) as Record<string, StepOutput>;
  const tree = useMemo(
    () => buildRunTimelineTree(flowVersion.trigger, runSteps),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flowVersion.trigger, run?.steps],
  );

  // Expand the failure path once per run. While a run is live, newly arriving
  // iterations must not collapse user toggles, so initialization is keyed to
  // the run id and only runs again when the run changes.
  useEffect(() => {
    if (!run || hasInitialized) {
      return;
    }
    setExpandedIds(collectInitiallyExpandedIds(tree));
    setVisibleIterations({});
    setHasInitialized(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.id]);

  const allFlowSteps = useMemo(
    () => [flowVersion.trigger, ...collectActions(flowVersion.trigger.nextAction)],
    [flowVersion.trigger],
  );
  const metadataQueries = stepsHooks.useStepsMetadata(allFlowSteps);
  const stepMetadata = useMemo(() => {
    const map = new Map<
      string,
      { logoUrl?: string; displayName?: string } | undefined
    >();
    allFlowSteps.forEach((step, index) => {
      const data = metadataQueries[index]?.data;
      if (data) {
        map.set(step.name, {
          logoUrl: data.logoUrl,
          displayName: data.displayName,
        });
      }
    });
    return map;
  }, [allFlowSteps, metadataQueries]);

  const rows = useMemo(
    () =>
      flattenTimelineTree(
        tree,
        expandedIds,
        visibleIterations,
        DEFAULT_VISIBLE_ITERATIONS,
      ),
    [tree, expandedIds, visibleIterations],
  );

  const retryRunMutation = flowRunMutations.useRetryRun({
    onSuccess: ({ run: newRun }) => {
      navigate(
        authenticationSession.appendProjectRoutePrefix(`/runs/${newRun.id}`),
      );
    },
  });

  const cancelRunMutation = flowRunMutations.useCancelRun();

  if (!run) {
    return null;
  }

  const isTerminal = isFlowRunStateTerminal({
    status: run.status,
    ignoreInternalError: false,
  });
  const canCancel =
    run.status === FlowRunStatus.PAUSED || run.status === FlowRunStatus.QUEUED;
  const failedState = isFailedState(run.status);

  const handleRetry = (strategy: FlowRetryStrategy) => {
    const projectId = authenticationSession.getProjectId();
    if (!projectId || isNil(run)) {
      return;
    }
    retryRunMutation.mutate({
      runId: run.id,
      flowId: run.flowId,
      projectId,
      retryStrategy: strategy,
    });
  };

  const handleCancel = async () => {
    if (isNil(run)) {
      return;
    }
    await cancelRunMutation.mutateAsync(run.id);
    // The run-listener query polls non-terminal runs every 5s and will pick
    // up the CANCELED state; invalidate it so the status flips immediately.
    queryClient.invalidateQueries({ queryKey: ['refetched-run', run.id] });
  };

  const toggleExpanded = (node: TimelineNode) => {
    setExpandedIds((previous) => {
      const next = new Set(previous);
      if (next.has(node.id)) {
        next.delete(node.id);
      } else {
        next.add(node.id);
      }
      return next;
    });
  };

  const loadMoreIterations = (loopNodeId: string) => {
    setVisibleIterations((previous) => ({
      ...previous,
      [loopNodeId]:
        (previous[loopNodeId] ?? DEFAULT_VISIBLE_ITERATIONS) +
        ITERATION_PAGE_SIZE,
    }));
  };

  const handleSelectStep = (node: TimelineStepNode) => {
    // Steps inside loops need every ancestor loop selection applied in
    // outermost-first order, otherwise nested indexes clamp to empty loops.
    node.loopPath.forEach((entry) => {
      setLoopIndex(entry.loopName, entry.iteration);
    });
    selectStepByName(node.stepName);
  };

  return (
    <div
      role="complementary"
      aria-label={t('Run timeline')}
      className="absolute left-2 top-[60px] z-30 flex max-h-[70vh] w-[420px] max-w-[calc(100vw-1rem)] flex-col rounded-lg border border-border bg-background shadow-lg"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <ListTree className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">{t('Run timeline')}</span>
        <div className="ml-auto flex items-center gap-1">
          <RunActions
            isTerminal={isTerminal}
            canCancel={canCancel}
            failedState={failedState}
            hasPermission={userHasPermissionToWriteRun}
            isRetrying={retryRunMutation.isPending}
            isCancelling={cancelRunMutation.isPending}
            onRetry={handleRetry}
            onCancel={handleCancel}
          />
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={onClose}
            aria-label={t('Close timeline')}
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>
      <div role="tree" className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {rows.length === 0 ? (
          <div className="flex h-full items-center justify-center p-6 text-xs text-muted-foreground">
            {t('No steps have been recorded for this run yet.')}
          </div>
        ) : (
          <VirtualizedList
            items={rows}
            estimateSize={ROW_ESTIMATE_HEIGHT}
            virtualizeThreshold={VIRTUALIZE_THRESHOLD}
            getItemKey={(index) => rows[index].id}
            renderItem={(node) => (
              <TimelineRow
                node={node}
                isExpanded={expandedIds.has(node.id)}
                isSelected={
                  node.kind !== 'load-more-iterations' &&
                  isStepRowSelected(node, selectedStepName)
                }
                onToggle={toggleExpanded}
                onSelectStep={handleSelectStep}
                stepMetadata={stepMetadata}
                onLoadMoreIterations={loadMoreIterations}
              />
            )}
          />
        )}
      </div>
    </div>
  );
};

RunTimelinePanel.displayName = 'RunTimelinePanel';
export { RunTimelinePanel };

const isStepRowSelected = (
  node: TimelineNode,
  selectedStepName: string | null,
): boolean => {
  if (node.kind === 'step') {
    return node.stepName === selectedStepName;
  }
  if (node.kind === 'loop' || node.kind === 'router') {
    return node.step.stepName === selectedStepName;
  }
  return false;
};

const collectActions = (firstAction: FlowAction | undefined): FlowAction[] => {
  const collected: FlowAction[] = [];
  const walk = (current: FlowAction | null | undefined) => {
    if (!current) {
      return;
    }
    collected.push(current);
    if (current.type === FlowActionType.ROUTER) {
      current.children.forEach(walk);
    }
    if (current.type === FlowActionType.LOOP_ON_ITEMS) {
      walk(current.firstLoopAction);
    }
    walk(current.nextAction);
  };
  walk(firstAction);
  return collected;
};

const RunActions = ({
  isTerminal,
  canCancel,
  failedState,
  hasPermission,
  isRetrying,
  isCancelling,
  onRetry,
  onCancel,
}: {
  isTerminal: boolean;
  canCancel: boolean;
  failedState: boolean;
  hasPermission: boolean;
  isRetrying: boolean;
  isCancelling: boolean;
  onRetry: (strategy: FlowRetryStrategy) => void;
  onCancel: () => void;
}) => {
  const { t } = useTranslation();
  return (
    <>
      {isTerminal && (
        <PermissionNeededTooltip hasPermission={hasPermission}>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger
              asChild
              disabled={!hasPermission || isRetrying}
            >
              <Button variant="ghost" size="sm" className="h-7 gap-1">
                {isRetrying ? (
                  <LoadingSpinner className="size-3.5" />
                ) : (
                  <Repeat className="size-3.5" />
                )}
                {t('Retry')}
                <ChevronDown className="size-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem
                disabled={!hasPermission}
                onClick={() => onRetry(FlowRetryStrategy.ON_LATEST_VERSION)}
                className="cursor-pointer"
              >
                {t('On latest version')}
              </DropdownMenuItem>
              {failedState && (
                <DropdownMenuItem
                  disabled={!hasPermission}
                  onClick={() =>
                    onRetry(FlowRetryStrategy.FROM_FAILED_STEP)
                  }
                  className="cursor-pointer"
                >
                  {t('From failed step')}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </PermissionNeededTooltip>
      )}
      {canCancel && (
        <PermissionNeededTooltip hasPermission={hasPermission}>
          <Button
            variant="ghost"
            size="sm"
            className={cn('h-7 gap-1', {
              'text-destructive-700 dark:text-destructive-200': hasPermission,
            })}
            disabled={!hasPermission || isCancelling}
            onClick={onCancel}
          >
            {isCancelling ? (
              <LoadingSpinner className="size-3.5" />
            ) : (
              <Ban className="size-3.5" />
            )}
            {t('Cancel run')}
          </Button>
        </PermissionNeededTooltip>
      )}
    </>
  );
};
