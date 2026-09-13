import { isNil } from '@activepieces/core-utils';
import {
  LogSliceRef,
  StepOutputStatus,
  StepOutputType,
} from '@activepieces/shared';
import { t } from 'i18next';
import {
  ChevronRight,
  CircleAlert,
  Download,
  GitFork,
  Repeat,
  SquareArrowOutUpRight,
} from 'lucide-react';

import { ImageWithColorBackground } from '@/components/custom/image-with-color-background';
import { TextWithTooltip } from '@/components/custom/text-with-tooltip';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { StepStatusIcon } from '@/features/flow-runs';
import { downloadFile } from '@/lib/dom-utils';
import { formatUtils } from '@/lib/format-utils';
import { cn } from '@/lib/utils';

import {
  TimelineBranchNode,
  TimelineIterationNode,
  TimelineLoadMoreNode,
  TimelineLoopNode,
  TimelineNode,
  TimelineNodeStatus,
  TimelineRouterNode,
  TimelineStepNode,
} from './run-timeline-tree';

const ERROR_SUMMARY_MAX_LENGTH = 160;

type StepMetadataMap = Map<
  string,
  { logoUrl?: string; displayName?: string } | undefined
>;

type TimelineRowProps = {
  node: TimelineNode | TimelineLoadMoreNode;
  isExpanded: boolean;
  isSelected: boolean;
  onToggle: (node: TimelineNode) => void;
  onSelectStep: (node: TimelineStepNode) => void;
  stepMetadata: StepMetadataMap;
  onLoadMoreIterations?: (loopNodeId: string) => void;
};

const TimelineRow = ({
  node,
  isExpanded,
  isSelected,
  onToggle,
  onSelectStep,
  stepMetadata,
  onLoadMoreIterations,
}: TimelineRowProps) => {
  if (node.kind === 'load-more-iterations') {
    return (
      <LoadMoreIterationsRow node={node} onLoadMore={onLoadMoreIterations} />
    );
  }
  if (node.kind === 'step') {
    return (
      <StepRow
        node={node}
        isSelected={isSelected}
        onSelectStep={onSelectStep}
        stepMetadata={stepMetadata}
      />
    );
  }
  if (node.kind === 'router') {
    return (
      <RouterRow
        node={node}
        isExpanded={isExpanded}
        isSelected={isSelected}
        onToggle={onToggle}
        onSelectStep={onSelectStep}
        stepMetadata={stepMetadata}
      />
    );
  }
  if (node.kind === 'branch') {
    return (
      <BranchRow node={node} isExpanded={isExpanded} onToggle={onToggle} />
    );
  }
  if (node.kind === 'loop') {
    return (
      <LoopRow
        node={node}
        isExpanded={isExpanded}
        isSelected={isSelected}
        onToggle={onToggle}
        onSelectStep={onSelectStep}
        stepMetadata={stepMetadata}
      />
    );
  }
  return (
    <IterationRow node={node} isExpanded={isExpanded} onToggle={onToggle} />
  );
};
TimelineRow.displayName = 'TimelineRow';

const RowShell = ({
  depth,
  children,
  isError = false,
  isSelected = false,
  onClick,
}: {
  depth: number;
  children: React.ReactNode;
  isError?: boolean;
  isSelected?: boolean;
  onClick?: () => void;
}) => (
  <div
    role="treeitem"
    onClick={onClick}
    className={cn(
      'group flex min-h-9 w-full items-center gap-1.5 rounded-md pr-2 text-sm',
      onClick && 'cursor-pointer hover:bg-accent',
      isSelected && 'bg-accent',
      isError && 'bg-destructive-50/60 hover:bg-destructive-50',
    )}
    style={{ paddingLeft: `${depth * 16 + 8}px` }}
  >
    {children}
  </div>
);

// The failure stays visible on the collapsed parent: this is the primary
// signal for deciding whether to retry, so it renders whether open or not.
const ErrorSummaryChip = ({
  errorSummary,
}: {
  errorSummary: TimelineStepNode['errorSummary'];
}) => {
  if (!errorSummary) {
    return null;
  }
  const message = errorSummary.message
    ? truncateErrorMessage(errorSummary.message)
    : null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className="ml-auto flex max-w-[45%] shrink-0 items-center gap-1 rounded border border-destructive-200 bg-destructive-50 px-1.5 py-0.5 text-xs text-destructive-700 dark:border-destructive-800 dark:bg-destructive-900/60 dark:text-destructive-200"
          onClick={(e) => e.stopPropagation()}
        >
          <CircleAlert className="size-3 shrink-0" />
          <span className="truncate">
            {errorSummary.stepDisplayName}
            {message ? `: ${message}` : ''}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm whitespace-pre-wrap break-words">
        {errorSummary.stepDisplayName}
        {errorSummary.message ? `: ${errorSummary.message}` : ''}
      </TooltipContent>
    </Tooltip>
  );
};

const NodeStatusIcon = ({ status }: { status: TimelineNodeStatus }) => {
  if (status === 'SKIPPED') {
    return (
      <span className="flex size-4 items-center text-xss text-muted-foreground/50">
        —
      </span>
    );
  }
  return <StepStatusIcon status={status} size="4" />;
};

const StepLogo = ({
  logoUrl,
  displayName,
}: {
  logoUrl?: string;
  displayName: string;
}) => {
  if (!logoUrl) {
    return (
      <span className="size-5 shrink-0 rounded border border-border bg-muted" />
    );
  }
  return (
    <ImageWithColorBackground
      src={logoUrl}
      alt={displayName}
      border={true}
      roundedCorner={true}
      className="size-5 shrink-0 rounded p-0.5"
    />
  );
};

const ExpandChevron = ({
  isExpanded,
  onClick,
}: {
  isExpanded: boolean;
  onClick?: (e: React.MouseEvent) => void;
}) => (
  <button
    type="button"
    aria-label={isExpanded ? t('Collapse') : t('Expand')}
    onClick={(e) => {
      e.stopPropagation();
      onClick?.(e);
    }}
    className="flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
  >
    <ChevronRight
      className={cn(
        'size-4 transition-transform',
        isExpanded && 'rotate-90',
      )}
    />
  </button>
);

const StepRow = ({
  node,
  isSelected,
  onSelectStep,
  stepMetadata,
}: {
  node: TimelineStepNode;
  isSelected: boolean;
  onSelectStep: (node: TimelineStepNode) => void;
  stepMetadata: StepMetadataMap;
}) => {
  const logoUrl = stepMetadata.get(node.stepName)?.logoUrl;
  const duration = node.output?.duration;
  const isSliced = node.output?.outputType === StepOutputType.SLICE;
  const slicedOutputRef = isSliced
    ? (node.output?.output as LogSliceRef | undefined)
    : undefined;
  const hasOutput =
    !isNil(node.output) && node.status !== StepOutputStatus.RUNNING;

  return (
    <RowShell
      depth={node.depth}
      isSelected={isSelected}
      isError={node.status === StepOutputStatus.FAILED}
      onClick={() => onSelectStep(node)}
    >
      <span className="flex size-5 shrink-0 items-center justify-center">
        <NodeStatusIcon status={node.status} />
      </span>
      <StepLogo logoUrl={logoUrl} displayName={node.stepDisplayName} />
      <TextWithTooltip tooltipMessage={node.stepDisplayName}>
        <span
          className={cn('truncate', {
            'text-muted-foreground line-through': node.status === 'SKIPPED',
          })}
        >
          {node.stepDisplayName}
        </span>
      </TextWithTooltip>
      {!isNil(duration) && duration > 0 && (
        <span className="shrink-0 text-xs text-muted-foreground">
          {formatUtils.formatDuration(duration, true)}
        </span>
      )}
      <ErrorSummaryChip errorSummary={node.errorSummary} />
      {hasOutput && (
        <div
          className={cn(
            'flex shrink-0 items-center gap-0.5',
            node.errorSummary
              ? 'ml-1 opacity-0 transition-opacity group-hover:opacity-100'
              : 'ml-auto',
          )}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectStep(node);
                }}
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label={t('View input and output')}
              >
                <SquareArrowOutUpRight className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t('View input and output')}</TooltipContent>
          </Tooltip>
          {isSliced && slicedOutputRef ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <a
                  href={slicedOutputRef.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  download
                  onClick={(e) => e.stopPropagation()}
                  className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label={t('Download output file')}
                >
                  <Download className="size-3.5" />
                </a>
              </TooltipTrigger>
              <TooltipContent>
                {`${t('Download output')} (${formatUtils.formatStorageSize(
                  slicedOutputRef.size,
                )})`}
              </TooltipContent>
            </Tooltip>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    const value = node.output?.output;
                    const isPlainString = typeof value === 'string';
                    void downloadFile({
                      obj: isPlainString
                        ? (value as string)
                        : JSON.stringify(value ?? null, null, 2),
                      fileName: `${node.stepName}-output`,
                      extension: isPlainString ? 'txt' : 'json',
                    });
                  }}
                  className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label={t('Download output')}
                >
                  <Download className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{t('Download output')}</TooltipContent>
            </Tooltip>
          )}
        </div>
      )}
    </RowShell>
  );
};

const RouterRow = ({
  node,
  isExpanded,
  isSelected,
  onToggle,
  onSelectStep,
  stepMetadata,
}: {
  node: TimelineRouterNode;
  isExpanded: boolean;
  isSelected: boolean;
  onToggle: (node: TimelineNode) => void;
  onSelectStep: (node: TimelineStepNode) => void;
  stepMetadata: StepMetadataMap;
}) => {
  const matchedCount = node.branches.filter((branch) => branch.matched).length;
  const logoUrl =
    stepMetadata.get(node.step.stepName)?.logoUrl ??
    'https://cdn.activepieces.com/pieces/new-core/router.svg';
  return (
    <RowShell
      depth={node.depth}
      isSelected={isSelected}
      isError={!!node.errorSummary}
      onClick={() => onSelectStep(node.step)}
    >
      <ExpandChevron
        isExpanded={isExpanded}
        onClick={() => onToggle(node)}
      />
      <NodeStatusIcon status={node.step.status} />
      <StepLogo logoUrl={logoUrl} displayName={node.step.stepDisplayName} />
      <GitFork className="size-3.5 shrink-0 text-muted-foreground" />
      <TextWithTooltip tooltipMessage={node.step.stepDisplayName}>
        <span className="truncate font-medium">
          {node.step.stepDisplayName}
        </span>
      </TextWithTooltip>
      <Badge variant="secondary" className="shrink-0 text-xss">
        {matchedCount}/{node.branches.length}
      </Badge>
      <ErrorSummaryChip errorSummary={node.errorSummary} />
    </RowShell>
  );
};

const BranchRow = ({
  node,
  isExpanded,
  onToggle,
}: {
  node: TimelineBranchNode;
  isExpanded: boolean;
  onToggle: (node: TimelineNode) => void;
}) => {
  const isLeaf = node.children.length === 0;
  return (
    <RowShell
      depth={node.depth}
      isError={node.status === StepOutputStatus.FAILED}
      onClick={isLeaf || !node.matched ? undefined : () => onToggle(node)}
    >
      {isLeaf || !node.matched ? (
        <span className="size-4 shrink-0" />
      ) : (
        <ExpandChevron
          isExpanded={isExpanded}
          onClick={() => onToggle(node)}
        />
      )}
      <NodeStatusIcon status={node.status} />
      <span
        className={cn(
          'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-xss',
          node.matched
            ? 'border-primary/40 text-primary'
            : 'border-border text-muted-foreground/60',
        )}
      >
        {node.branchIndex + 1}
      </span>
      <TextWithTooltip tooltipMessage={node.branchName}>
        <span
          className={cn('truncate', {
            'text-muted-foreground': !node.matched,
            'font-medium': node.matched,
          })}
        >
          {node.branchName}
        </span>
      </TextWithTooltip>
      {!node.matched && (
        <Badge
          variant="outline"
          className="shrink-0 text-xss text-muted-foreground"
        >
          {t('Not matched')}
        </Badge>
      )}
      {node.isFallback && (
        <Badge
          variant="outline"
          className="shrink-0 text-xss text-muted-foreground"
        >
          {t('Fallback')}
        </Badge>
      )}
      <ErrorSummaryChip errorSummary={node.errorSummary} />
    </RowShell>
  );
};

const LoopRow = ({
  node,
  isExpanded,
  isSelected,
  onToggle,
  onSelectStep,
  stepMetadata,
}: {
  node: TimelineLoopNode;
  isExpanded: boolean;
  isSelected: boolean;
  onToggle: (node: TimelineNode) => void;
  onSelectStep: (node: TimelineStepNode) => void;
  stepMetadata: StepMetadataMap;
}) => {
  const logoUrl =
    stepMetadata.get(node.step.stepName)?.logoUrl ??
    'https://cdn.activepieces.com/pieces/new-core/loop.svg';
  const failedCount = node.iterations.filter(
    (iteration) => iteration.status === StepOutputStatus.FAILED,
  ).length;
  return (
    <RowShell
      depth={node.depth}
      isSelected={isSelected}
      isError={!!node.errorSummary}
      onClick={() => onSelectStep(node.step)}
    >
      <ExpandChevron
        isExpanded={isExpanded}
        onClick={() => onToggle(node)}
      />
      <NodeStatusIcon status={node.step.status} />
      <StepLogo logoUrl={logoUrl} displayName={node.step.stepDisplayName} />
      <Repeat className="size-3.5 shrink-0 text-muted-foreground" />
      <TextWithTooltip tooltipMessage={node.step.stepDisplayName}>
        <span className="truncate font-medium">
          {node.step.stepDisplayName}
        </span>
      </TextWithTooltip>
      <Badge variant="secondary" className="shrink-0 text-xss">
        {t('{count} items', { count: node.iterations.length })}
      </Badge>
      {failedCount > 0 && (
        <Badge
          variant="outline"
          className="shrink-0 border-destructive-200 text-xss text-destructive-700 dark:border-destructive-800 dark:text-destructive-200"
        >
          {t('{count} failed', { count: failedCount })}
        </Badge>
      )}
      <ErrorSummaryChip errorSummary={node.errorSummary} />
    </RowShell>
  );
};

const IterationRow = ({
  node,
  isExpanded,
  onToggle,
}: {
  node: TimelineIterationNode;
  isExpanded: boolean;
  onToggle: (node: TimelineNode) => void;
}) => {
  const isLeaf = node.children.length === 0;
  return (
    <RowShell
      depth={node.depth}
      isError={node.status === StepOutputStatus.FAILED}
      onClick={isLeaf ? undefined : () => onToggle(node)}
    >
      {isLeaf ? (
        <span className="size-4 shrink-0" />
      ) : (
        <ExpandChevron
          isExpanded={isExpanded}
          onClick={() => onToggle(node)}
        />
      )}
      <NodeStatusIcon status={node.status} />
      <span className="shrink-0 text-xs text-muted-foreground">
        {`#${node.iterationIndex + 1}`}
      </span>
      <ErrorSummaryChip errorSummary={node.errorSummary} />
    </RowShell>
  );
};

const LoadMoreIterationsRow = ({
  node,
  onLoadMore,
}: {
  node: TimelineLoadMoreNode;
  onLoadMore?: (loopNodeId: string) => void;
}) => (
  <div
    className="flex py-1"
    style={{ paddingLeft: `${node.depth * 16 + 24}px` }}
  >
    <Button
      variant="ghost"
      size="sm"
      className="h-6 text-xs"
      onClick={() => onLoadMore?.(node.loopNodeId)}
    >
      {t('Load {count} more iterations', {
        count: node.remainingCount,
      })}
    </Button>
  </div>
);

const truncateErrorMessage = (message: string): string => {
  const singleLine = message.split('\n')[0] ?? message;
  return singleLine.length > ERROR_SUMMARY_MAX_LENGTH
    ? `${singleLine.slice(0, ERROR_SUMMARY_MAX_LENGTH)}…`
    : singleLine;
};

export type { TimelineStepNode };
