import {
  AgentEvalCaseResult,
  AgentEvalCaseStatus,
  AgentEvalResultSortBy,
  AgentEvalRunStatus,
  AgentEvalToolCallStatus,
} from '@activepieces/shared';
import { t } from 'i18next';
import {
  ArrowDownWideNarrow,
  ArrowLeft,
  ArrowUpNarrowWide,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { DataFetchErrorState } from '@/components/custom/data-fetch-error-state';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  EvalCaseStatusBadge,
  EvalRunStatusBadge,
  formatCredits,
  formatDurationMs,
} from '@/features/agent-evals/components/eval-status-badges';
import { agentEvalQueries } from '@/features/agent-evals/hooks/agent-evals-hooks';
import { projectCollectionUtils } from '@/features/projects';
import { cn } from '@/lib/utils';

const SORT_OPTIONS: { value: AgentEvalResultSortBy; label: () => string }[] = [
  { value: AgentEvalResultSortBy.STATUS, label: () => t('Status') },
  { value: AgentEvalResultSortBy.COST, label: () => t('Cost') },
  { value: AgentEvalResultSortBy.DURATION, label: () => t('Duration') },
  { value: AgentEvalResultSortBy.NAME, label: () => t('Name') },
];

const STATUS_FILTER_OPTIONS: {
  value: AgentEvalCaseStatus | 'all';
  label: () => string;
}[] = [
  { value: 'all', label: () => t('All results') },
  { value: AgentEvalCaseStatus.SUCCESS, label: () => t('Success') },
  { value: AgentEvalCaseStatus.FAILED, label: () => t('Failed') },
  {
    value: AgentEvalCaseStatus.NEEDS_APPROVAL,
    label: () => t('Needs approval'),
  },
  { value: AgentEvalCaseStatus.TIMEOUT, label: () => t('Timed out') },
  { value: AgentEvalCaseStatus.SKIPPED, label: () => t('Skipped') },
];

const AgentEvalRunPage = () => {
  const { agentId, runId } = useParams<{ agentId: string; runId: string }>();
  const { project } = projectCollectionUtils.useCurrentProject();
  const navigate = useNavigate();

  const [sortBy, setSortBy] = useState<AgentEvalResultSortBy>(
    AgentEvalResultSortBy.STATUS,
  );
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [statusFilter, setStatusFilter] = useState<AgentEvalCaseStatus | 'all'>(
    'all',
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const run = agentEvalQueries.useRun(project.id, runId ?? '');
  const isRunning = run.data?.status === AgentEvalRunStatus.RUNNING;
  const results = agentEvalQueries.useResults(
    project.id,
    runId ?? '',
    {
      sortBy,
      sortOrder,
      ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
    },
    isRunning,
  );

  if (run.isLoading) {
    return (
      <div className="flex w-full flex-col gap-4 px-12 py-8">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (run.isError || !run.data) {
    return (
      <div className="px-12 py-8">
        <DataFetchErrorState
          entity={t('eval run')}
          onRetry={() => run.refetch()}
        />
      </div>
    );
  }

  const totals = run.data.totals;

  return (
    <div className="flex w-full flex-col gap-6 px-12 py-8">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('Back to suite')}
          onClick={() =>
            navigate(
              `/projects/${project.id}/agents/${agentId}/evals/suites/${run.data?.suiteId}`,
            )
          }
        >
          <ArrowLeft size={16} />
        </Button>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-[-0.01em]">
              {t('Eval run')}
            </h1>
            <EvalRunStatusBadge status={run.data.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {run.data.agentVersion === 'DRAFT' ? t('Draft') : t('Published')}
            {run.data.modelName ? ` · ${run.data.modelName}` : ''}
            {' · '}
            {run.data.toolExecution === 'DRY' ? t('Dry run') : t('Live tools')}
            {' · '}
            {t('up to {count} at once', { count: run.data.maxConcurrency })}
            {run.data.maxCostCredits != null &&
              ` · ${t('budget {count} credits', { count: run.data.maxCostCredits })}`}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <TotalCard label={t('Succeeded')} value={totals.succeeded} tone="text-emerald-700" />
        <TotalCard label={t('Failed')} value={totals.failed} tone="text-destructive" />
        <TotalCard
          label={t('Needs approval')}
          value={totals.needsApproval}
          tone="text-amber-700"
        />
        <TotalCard label={t('Timed out')} value={totals.timedOut} tone="text-orange-700" />
        <TotalCard
          label={t('Remaining')}
          value={totals.pending + totals.running}
          tone="text-muted-foreground"
        />
        <TotalCard
          label={t('Credits used')}
          value={formatCredits(totals.creditsUsed)}
          tone="text-foreground"
        />
      </div>

      <div className="flex items-center gap-2">
        <Select
          value={sortBy}
          onValueChange={(value) => setSortBy(value as AgentEvalResultSortBy)}
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {t('Sort: {label}', { label: option.label() })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="icon"
          aria-label={t('Toggle sort direction')}
          onClick={() =>
            setSortOrder((current) => (current === 'asc' ? 'desc' : 'asc'))
          }
        >
          {sortOrder === 'asc' ? (
            <ArrowUpNarrowWide size={15} />
          ) : (
            <ArrowDownWideNarrow size={15} />
          )}
        </Button>
        <Select
          value={statusFilter}
          onValueChange={(value) =>
            setStatusFilter(value as AgentEvalCaseStatus | 'all')
          }
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTER_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isRunning && (
          <span className="ms-auto text-[13px] text-muted-foreground">
            {t('Running — results refresh automatically')}
          </span>
        )}
      </div>

      <div className="overflow-x-auto rounded-[10px] border border-border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-8" />
              <TableHead>{t('Case')}</TableHead>
              <TableHead>{t('Status')}</TableHead>
              <TableHead>{t('Tools')}</TableHead>
              <TableHead>{t('Cost')}</TableHead>
              <TableHead>{t('Duration')}</TableHead>
              <TableHead className="hidden xl:table-cell">
                {t('Final answer')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(results.data ?? []).map((result) => (
              <ResultRows
                key={result.id}
                result={result}
                expanded={expandedId === result.id}
                onToggle={() =>
                  setExpandedId((current) =>
                    current === result.id ? null : result.id,
                  )
                }
              />
            ))}
            {(results.data ?? []).length === 0 && !results.isLoading && (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={7}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  {t('No results match this filter')}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

const TotalCard = ({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone: string;
}) => (
  <div className="flex flex-col gap-1 rounded-[10px] border border-border px-4 py-3">
    <span className="text-xs text-muted-foreground">{label}</span>
    <span className={cn('text-xl font-semibold tabular-nums', tone)}>
      {value}
    </span>
  </div>
);

const ResultRows = ({
  result,
  expanded,
  onToggle,
}: {
  result: AgentEvalCaseResult;
  expanded: boolean;
  onToggle: () => void;
}) => (
  <>
    <TableRow className="cursor-pointer" onClick={onToggle}>
      <TableCell>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </TableCell>
      <TableCell>
        <span className="text-sm font-medium">{result.caseName}</span>
      </TableCell>
      <TableCell>
        <EvalCaseStatusBadge status={result.status} />
      </TableCell>
      <TableCell className="text-sm tabular-nums">
        {result.toolCalls.length}
      </TableCell>
      <TableCell className="text-sm tabular-nums">
        {formatCredits(result.creditsUsed)}
      </TableCell>
      <TableCell className="text-sm tabular-nums">
        {formatDurationMs(result.durationMs)}
      </TableCell>
      <TableCell className="hidden max-w-[320px] xl:table-cell">
        <span className="line-clamp-2 text-[13px] text-muted-foreground">
          {result.output ?? result.error ?? '—'}
        </span>
      </TableCell>
    </TableRow>
    {expanded && (
      <TableRow className="hover:bg-transparent">
        <TableCell colSpan={7} className="bg-muted/40">
          <div className="flex flex-col gap-4 py-3">
            <DetailSection title={t('Message sent')}>
              <p className="whitespace-pre-wrap text-[13px] leading-5">
                {result.renderedMessage}
              </p>
            </DetailSection>
            {result.toolCalls.length > 0 && (
              <DetailSection title={t('Tool calls')}>
                <div className="flex flex-col gap-2">
                  {result.toolCalls.map((toolCall, index) => (
                    <div
                      key={`${toolCall.toolName}-${index}`}
                      className="rounded-md border border-border bg-background p-3"
                    >
                      <div className="flex items-center gap-2">
                        <code className="text-xs font-semibold">
                          {toolCall.toolName}
                        </code>
                        <ToolCallStatusLabel status={toolCall.status} />
                      </div>
                      {toolCall.input !== undefined && (
                        <pre className="mt-2 max-h-40 overflow-auto rounded bg-muted p-2 text-[11px] leading-4">
                          {JSON.stringify(toolCall.input, null, 2)}
                        </pre>
                      )}
                      {toolCall.errorText && (
                        <p className="mt-2 text-[12px] text-destructive">
                          {toolCall.errorText}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </DetailSection>
            )}
            {result.output != null && (
              <DetailSection title={t('Final answer')}>
                <p className="whitespace-pre-wrap text-[13px] leading-5">
                  {result.output}
                </p>
              </DetailSection>
            )}
            {result.error != null && (
              <DetailSection title={t('Note')}>
                <p className="text-[13px] leading-5 text-muted-foreground">
                  {result.error}
                </p>
              </DetailSection>
            )}
          </div>
        </TableCell>
      </TableRow>
    )}
  </>
);

const DetailSection = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) => (
  <div className="flex flex-col gap-1.5">
    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {title}
    </span>
    {children}
  </div>
);

const ToolCallStatusLabel = ({
  status,
}: {
  status: AgentEvalToolCallStatus;
}) => {
  const label = {
    [AgentEvalToolCallStatus.COMPLETED]: t('completed'),
    [AgentEvalToolCallStatus.ERROR]: t('error'),
    [AgentEvalToolCallStatus.DRY_RUN]: t('simulated'),
    [AgentEvalToolCallStatus.AWAITING_APPROVAL]: t('awaiting approval'),
  }[status];
  return (
    <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
      {label}
    </span>
  );
};

export default AgentEvalRunPage;
