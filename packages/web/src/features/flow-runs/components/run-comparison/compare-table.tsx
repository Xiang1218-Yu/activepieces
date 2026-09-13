import {
  CompareRunColumn,
  CompareStepRow,
  RunErrorCategory,
  RunOutputSummary,
  StepOutputStatus,
} from '@activepieces/shared';
import { t } from 'i18next';
import {
  AlertTriangle,
  CircleCheck,
  CircleX,
  Minus,
  ShieldAlert,
  Timer,
} from 'lucide-react';

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { flowRunUtils } from '@/features/flow-runs/utils/flow-run-utils';
import { formatUtils } from '@/lib/format-utils';
import { cn } from '@/lib/utils';

type CompareTableProps = {
  columns: CompareRunColumn[];
  rows: CompareStepRow[];
  onOpenRun: (flowRunId: string, newWindow?: boolean) => void;
};

function CompareTable({ columns, rows, onOpenRun }: CompareTableProps) {
  const distinctVersionCount = new Set(
    columns.map((column) => column.flowVersionId),
  ).size;

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 min-w-48 bg-muted/50 p-2 text-left text-xs font-medium text-muted-foreground">
              {t('Step')}
            </th>
            {columns.map((column) => (
              <ColumnHeader
                key={column.flowRunId}
                column={column}
                multipleVersions={distinctVersionCount > 1}
                onOpenRun={onOpenRun}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          <TriggerRow columns={columns} />
          {rows.map((row) => (
            <StepRowView
              key={row.rowKey}
              row={row}
              columns={columns}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ColumnHeader({
  column,
  multipleVersions,
  onOpenRun,
}: {
  column: CompareRunColumn;
  multipleVersions: boolean;
  onOpenRun: (flowRunId: string, newWindow?: boolean) => void;
}) {
  const { Icon } = flowRunUtils.getStatusIcon(column.status);
  return (
    <th className="min-w-56 max-w-72 align-top p-2">
      <button
        className="flex w-full flex-col items-start gap-1 rounded p-1 text-left hover:bg-accent"
        onClick={(event) =>
          onOpenRun(column.flowRunId, event.metaKey || event.ctrlKey)
        }
      >
        <div className="flex w-full items-center gap-1.5">
          <Icon className="size-4 shrink-0" />
          <span className="truncate text-xs font-medium">
            {column.flowDisplayName ?? column.flowId}
          </span>
        </div>
        <span className="text-[11px] font-normal text-muted-foreground">
          {formatUtils.formatDateWithTime(new Date(column.created), true)}
        </span>
        <div className="flex flex-wrap items-center gap-1">
          <ErrorCategoryBadge category={column.errorCategory} />
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className={cn(
                  'rounded px-1.5 py-0.5 text-[10px]',
                  multipleVersions
                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {column.versionShort}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {multipleVersions
                ? t(
                    'These runs executed on different flow versions',
                  )
                : t('Flow version')}
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="flex items-center gap-2 text-[11px] font-normal text-muted-foreground">
          {column.durationMs !== null && (
            <span className="flex items-center gap-0.5">
              <Timer className="size-3" />
              {formatUtils.formatDuration(column.durationMs, true)}
            </span>
          )}
          {column.queueMs !== null && column.queueMs > 0 && (
            <span>
              {t('queue')} {formatUtils.formatDuration(column.queueMs, true)}
            </span>
          )}
        </div>
      </button>
    </th>
  );
}

function ErrorCategoryBadge({ category }: { category: RunErrorCategory }) {
  if (category === RunErrorCategory.NONE) {
    return null;
  }
  return (
    <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
      {formatUtils.convertEnumToHumanReadable(category)}
    </span>
  );
}

function TriggerRow({ columns }: { columns: CompareRunColumn[] }) {
  return (
    <tr className="border-t bg-muted/30">
      <td className="sticky left-0 z-10 bg-muted/30 p-2 text-xs font-medium">
        {t('Trigger')}
      </td>
      {columns.map((column) => (
        <td key={column.flowRunId} className="p-2 align-top">
          {column.trigger.present ? (
            <StepStatusCell
              status={column.trigger.status}
              durationMs={column.trigger.durationMs ?? null}
              errorMessage={column.trigger.errorMessage ?? null}
            />
          ) : (
            <MissingCell label={t('No trigger output')} />
          )}
        </td>
      ))}
    </tr>
  );
}

function StepRowView({
  row,
  columns,
}: {
  row: CompareStepRow;
  columns: CompareRunColumn[];
}) {
  const versionScoped = row.onlyInVersionIds.length > 0;
  return (
    <tr className="border-t">
      <td className="sticky left-0 z-10 bg-background p-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-medium">
            {row.displayName ?? row.stepName}
          </span>
          {versionScoped && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex w-fit items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="size-3" />
                  {t('Version-specific step')}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {t(
                  'This step exists only in some of the compared flow versions',
                )}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </td>
      {columns.map((column) => {
        const cell = column.steps[row.rowKey];
        const existsInThisVersion =
          !versionScoped || row.onlyInVersionIds.includes(column.flowVersionId);
        return (
          <td key={column.flowRunId} className="p-2 align-top">
            {cell?.present ? (
              <CellContent
                status={cell.status}
                durationMs={cell.durationMs ?? null}
                outputSummary={cell.outputSummary}
                errorMessage={cell.errorMessage ?? null}
                outputOffloaded={cell.outputOffloaded ?? false}
              />
            ) : (
              <MissingCell
                label={
                  existsInThisVersion
                    ? t('Missing output')
                    : t('Not in this version')
                }
              />
            )}
          </td>
        );
      })}
    </tr>
  );
}

function CellContent({
  status,
  durationMs,
  outputSummary,
  errorMessage,
  outputOffloaded,
}: {
  status?: string;
  durationMs: number | null;
  outputSummary?: RunOutputSummary;
  errorMessage: string | null;
  outputOffloaded: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <StepStatusCell
        status={status}
        durationMs={durationMs}
        errorMessage={errorMessage}
      />
      {outputSummary && (
        <OutputSummaryView
          summary={outputSummary}
          offloaded={outputOffloaded}
        />
      )}
    </div>
  );
}

function StepStatusCell({
  status,
  durationMs,
  errorMessage,
}: {
  status?: string;
  durationMs: number | null;
  errorMessage: string | null;
}) {
  if (!status) {
    return <MissingCell label={t('No status recorded')} />;
  }
  const failed = status === StepOutputStatus.FAILED;
  const succeeded = status === StepOutputStatus.SUCCEEDED;
  return (
    <div className="flex items-center gap-1.5 text-xs">
      {failed ? (
        <CircleX className="size-3.5 shrink-0 text-destructive" />
      ) : succeeded ? (
        <CircleCheck className="size-3.5 shrink-0 text-success-600" />
      ) : (
        <Minus className="size-3.5 shrink-0 text-muted-foreground" />
      )}
      <span className="text-muted-foreground">
        {formatUtils.convertEnumToHumanReadable(status)}
      </span>
      {durationMs !== null && (
        <span className="text-muted-foreground">
          · {formatUtils.formatDuration(durationMs, true)}
        </span>
      )}
      {failed && errorMessage && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-help truncate text-destructive">
              {errorMessage.slice(0, 60)}
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-md whitespace-pre-wrap">
            {errorMessage}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

function OutputSummaryView({
  summary,
  offloaded,
}: {
  summary: RunOutputSummary;
  offloaded: boolean;
}) {
  const isEmpty = summary.kind === 'empty' || summary.preview.length === 0;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex max-w-64 items-center gap-1 rounded bg-muted px-1.5 py-1 text-[11px] text-muted-foreground">
          {summary.hasRedactedValue && (
            <ShieldAlert className="size-3 shrink-0 text-warning" />
          )}
          <span className="truncate font-mono">
            {offloaded
              ? t('Offloaded output ({{size}})', { size: summary.preview })
              : isEmpty
                ? t('Empty output')
                : summary.preview}
          </span>
          {summary.truncated && (
            <span className="shrink-0 text-[10px]">{t('truncated')}</span>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-lg whitespace-pre-wrap break-all font-mono text-xs">
        {summary.preview}
        {summary.arrayLength !== undefined && (
          <div className="mt-1 font-sans text-muted-foreground">
            {t('Array length')}: {summary.arrayLength}
          </div>
        )}
        {summary.hasRedactedValue && (
          <div className="mt-1 font-sans text-warning">
            {t('Contains redacted sensitive values')}
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

function MissingCell({ label }: { label: string }) {
  return (
    <span className="flex items-center gap-1 text-xs italic text-muted-foreground/70">
      <Minus className="size-3.5" />
      {label}
    </span>
  );
}

export { CompareTable };
