import { isNil } from '@activepieces/core-utils';
import {
  FlowVersionDiff,
  FlowVersionDiffChangeType,
  FlowVersionDiffSection,
  FlowVersionDiffValueChange,
  FlowVersionMetadata,
  FlowVersionState,
} from '@activepieces/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { t } from 'i18next';
import {
  ArrowLeft,
  ArrowRight,
  GitCompare,
  Plus,
  Trash2,
  Pencil,
  MoveRight,
} from 'lucide-react';
import { ReactNode, useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { DataFetchErrorState } from '@/components/custom/data-fetch-error-state';
import { FormattedDate } from '@/components/custom/formatted-date';
import { LoadingSpinner } from '@/components/custom/spinner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  FLOW_VERSION_COMPARE_FROM_PARAM,
  FLOW_VERSION_COMPARE_TO_PARAM,
  flowHooks,
  flowsApi,
  flowVersionDiffHooks,
} from '@/features/flows';
import { authenticationSession } from '@/lib/authentication-session';

const FlowVersionComparePage = () => {
  const { flowId } = useParams<{ flowId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const fromVersionId =
    searchParams.get(FLOW_VERSION_COMPARE_FROM_PARAM) ?? undefined;
  const toVersionId =
    searchParams.get(FLOW_VERSION_COMPARE_TO_PARAM) ?? undefined;

  const {
    data: flowVersionPage,
    isLoading: isLoadingVersions,
    isError: isVersionsError,
  } = flowHooks.useListFlowVersions(flowId!);

  const versions = useMemo(
    () => flowVersionPage?.data ?? [],
    [flowVersionPage],
  );

  const { data: flow, isLoading: isLoadingFlow } = useQuery({
    queryKey: ['flow-name', flowId],
    queryFn: () => flowsApi.get(flowId!),
    enabled: !!flowId,
  });

  const {
    data: diff,
    isLoading: isLoadingDiff,
    isError: isDiffError,
    error: diffError,
  } = flowVersionDiffHooks.useGetFlowVersionDiff({
    flowId: flowId!,
    fromVersionId,
    toVersionId,
  });

  const updateSelection = ({ from, to }: { from?: string; to?: string }) => {
    const params = new URLSearchParams(searchParams);
    if (isNil(from)) {
      params.delete(FLOW_VERSION_COMPARE_FROM_PARAM);
    } else {
      params.set(FLOW_VERSION_COMPARE_FROM_PARAM, from);
    }
    if (isNil(to)) {
      params.delete(FLOW_VERSION_COMPARE_TO_PARAM);
    } else {
      params.set(FLOW_VERSION_COMPARE_TO_PARAM, to);
    }
    setSearchParams(params, { replace: true });
  };

  const swap = () => updateSelection({ from: toVersionId, to: fromVersionId });

  const sameVersionSelected =
    !!fromVersionId && !!toVersionId && fromVersionId === toVersionId;
  const hasSelection = !!fromVersionId && !!toVersionId;

  const goBack = () => {
    navigate(
      authenticationSession.appendProjectRoutePrefix(`/flows/${flowId}`),
    );
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background">
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto flex max-w-5xl flex-col gap-4">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={goBack}>
              <ArrowLeft className="mr-1 size-4" />
              {t('Back to builder')}
            </Button>
          </div>

          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold">
              {isLoadingFlow || !flow ? t('Flow') : flow.version.displayName}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t(
                'Select two versions of this flow to compare their triggers, steps, inputs, connections and notes.',
              )}
            </p>
          </div>

          {isLoadingVersions && (
            <div className="flex h-40 items-center justify-center">
              <LoadingSpinner></LoadingSpinner>
            </div>
          )}

          {isVersionsError && (
            <DataFetchErrorState
              entity={t('flow versions')}
              onRetry={() =>
                queryClient.invalidateQueries({
                  queryKey: ['flow-versions', flowId],
                })
              }
            ></DataFetchErrorState>
          )}

          {!isLoadingVersions && !isVersionsError && (
            <div className="flex flex-wrap items-end gap-3">
              <VersionSelect
                label={t('From version')}
                versions={versions}
                value={fromVersionId}
                excludedValue={toVersionId}
                onChange={(value) =>
                  updateSelection({ from: value, to: toVersionId })
                }
              ></VersionSelect>
              <Button
                variant="outline"
                size="icon"
                className="mb-0.5"
                onClick={swap}
                disabled={!fromVersionId && !toVersionId}
                title={t('Swap versions')}
              >
                <ArrowRight className="size-4" />
              </Button>
              <VersionSelect
                label={t('To version')}
                versions={versions}
                value={toVersionId}
                excludedValue={fromVersionId}
                onChange={(value) =>
                  updateSelection({ from: fromVersionId, to: value })
                }
              ></VersionSelect>
            </div>
          )}

          {sameVersionSelected && (
            <InlineError>
              {t('Select two different versions to compare.')}
            </InlineError>
          )}

          {!isLoadingVersions && !isVersionsError && versions.length < 2 && (
            <InlineError>
              {t('This flow needs at least two versions to compare.')}
            </InlineError>
          )}

          {hasSelection && !sameVersionSelected && (
            <>
              {isLoadingDiff && (
                <div className="flex h-40 items-center justify-center">
                  <LoadingSpinner></LoadingSpinner>
                </div>
              )}
              {isDiffError && (
                <DiffErrorState
                  error={diffError}
                  onRetry={() =>
                    queryClient.invalidateQueries({
                      queryKey: [
                        'flow-version-diff',
                        flowId,
                        fromVersionId,
                        toVersionId,
                      ],
                    })
                  }
                ></DiffErrorState>
              )}
              {!isLoadingDiff && !isDiffError && diff && (
                <DiffView diff={diff}></DiffView>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

FlowVersionComparePage.displayName = 'FlowVersionComparePage';
export { FlowVersionComparePage };

function VersionSelect({
  label,
  versions,
  value,
  excludedValue,
  onChange,
}: {
  label: string;
  versions: FlowVersionMetadata[];
  value?: string;
  excludedValue?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex w-72 flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder={t('Select version')} />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {versions.map((version, index) => {
              const versionNumber = versions.length - index;
              return (
                <SelectItem
                  key={version.id}
                  value={version.id}
                  disabled={version.id === excludedValue}
                >
                  <span className="flex items-center gap-2">
                    <span>#{versionNumber}</span>
                    <FormattedDate
                      date={new Date(version.created)}
                      includeTime={true}
                    ></FormattedDate>
                    {version.state === FlowVersionState.DRAFT && (
                      <Badge variant="outline" className="text-[10px]">
                        {t('Draft')}
                      </Badge>
                    )}
                  </span>
                </SelectItem>
              );
            })}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}

function InlineError({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {children}
    </div>
  );
}

function DiffErrorState({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}) {
  const message = useMemo(() => {
    const data = (
      error as { response?: { data?: { params?: { message?: string } } } }
    )?.response?.data;
    if (data?.params?.message === 'flowVersionDiff_sameVersion') {
      return t('Select two different versions to compare.');
    }
    if (data?.params?.message === 'flowVersionDiff_crossFlow') {
      return t(
        'Both versions must belong to the same flow. Open the compare page from a single flow.',
      );
    }
    return t(
      'We could not load this comparison. One of the versions may have been deleted.',
    );
  }, [error]);

  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border py-10">
      <p className="px-4 text-center text-sm font-medium">{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        {t('Try again')}
      </Button>
    </div>
  );
}

function DiffView({ diff }: { diff: FlowVersionDiff }) {
  const stats = useMemo(() => {
    const countByType = (
      items: { changeType: FlowVersionDiffChangeType }[],
      type: FlowVersionDiffChangeType,
    ) => items.filter((item) => item.changeType === type).length;
    return {
      added:
        countByType(diff.steps, FlowVersionDiffChangeType.ADDED) +
        countByType(diff.connections, FlowVersionDiffChangeType.ADDED) +
        countByType(diff.notes, FlowVersionDiffChangeType.ADDED),
      removed:
        countByType(diff.steps, FlowVersionDiffChangeType.REMOVED) +
        countByType(diff.connections, FlowVersionDiffChangeType.REMOVED) +
        countByType(diff.notes, FlowVersionDiffChangeType.REMOVED),
      modified:
        countByType(diff.steps, FlowVersionDiffChangeType.MODIFIED) +
        countByType(diff.connections, FlowVersionDiffChangeType.MODIFIED) +
        (diff.trigger.changed ? 1 : 0),
      moved: countByType(diff.steps, FlowVersionDiffChangeType.MOVED),
    };
  }, [diff]);

  if (!diff.hasChanges) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border py-16 text-center">
        <GitCompare className="size-8 text-muted-foreground" />
        <p className="text-sm font-medium">
          {t('These versions are identical')}
        </p>
        <p className="max-w-md text-xs text-muted-foreground">
          {t(
            'No differences were found in triggers, steps, inputs, connections or notes.',
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2 text-xs">
        <ChangeCountBadge
          count={stats.added}
          kind={FlowVersionDiffChangeType.ADDED}
        />
        <ChangeCountBadge
          count={stats.removed}
          kind={FlowVersionDiffChangeType.REMOVED}
        />
        <ChangeCountBadge
          count={stats.modified}
          kind={FlowVersionDiffChangeType.MODIFIED}
        />
        <ChangeCountBadge
          count={stats.moved}
          kind={FlowVersionDiffChangeType.MOVED}
        />
      </div>

      {diff.trigger.changed && (
        <DiffSection title={t('Trigger')}>
          <ChangeRow
            icon={<Pencil className="size-4" />}
            kind={FlowVersionDiffChangeType.MODIFIED}
            title={t('Trigger settings')}
          >
            <ChangeDetails changes={diff.trigger.changes} />
          </ChangeRow>
        </DiffSection>
      )}

      {diff.steps.length > 0 && (
        <DiffSection title={t('Steps')}>
          {diff.steps.map((step) => (
            <StepChangeRow
              key={`${step.stepName}-${step.changeType}`}
              step={step}
            />
          ))}
        </DiffSection>
      )}

      {diff.connections.length > 0 && (
        <DiffSection title={t('Connections')}>
          {diff.connections.map((connection, index) => (
            <ChangeRow
              key={`${connection.stepName}-${connection.inputKey}-${index}`}
              icon={changeIcon(connection.changeType)}
              kind={connection.changeType}
              title={`${connection.stepDisplayName} · ${connection.inputKey}`}
            >
              <ChangeDetails
                changes={[
                  {
                    path: connection.inputKey,
                    label: connection.inputKey,
                    before: connection.before,
                    after: connection.after,
                  },
                ]}
              />
            </ChangeRow>
          ))}
        </DiffSection>
      )}

      {diff.notes.length > 0 && (
        <DiffSection title={t('Notes')}>
          {diff.notes.map((note) => (
            <ChangeRow
              key={note.noteId}
              icon={changeIcon(note.changeType)}
              kind={note.changeType}
              title={t('Note')}
            >
              <ChangeDetails changes={note.changes} />
            </ChangeRow>
          ))}
        </DiffSection>
      )}
    </div>
  );
}

function ChangeCountBadge({
  count,
  kind,
}: {
  count: number;
  kind: FlowVersionDiffChangeType;
}) {
  if (count === 0) {
    return null;
  }
  return (
    <Badge className={kindBadgeClass(kind)}>
      {changeIcon(kind)}
      <span className="ml-1">{count}</span>
    </Badge>
  );
}

function DiffSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="border-b bg-muted/40 px-4 py-2 text-sm font-semibold">
        {title}
      </div>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

function StepChangeRow({ step }: { step: FlowVersionDiff['steps'][number] }) {
  return (
    <ChangeRow
      icon={changeIcon(step.changeType)}
      kind={step.changeType}
      title={step.stepDisplayName}
      subtitle={
        <span className="flex flex-wrap items-center gap-1">
          <code className="text-[10px] text-muted-foreground">
            {step.stepName}
          </code>
          {step.sections.map((section) => (
            <Badge key={section} variant="outline" className="text-[10px]">
              {sectionLabel(section)}
            </Badge>
          ))}
          {formatStepLocation(step) && (
            <span className="text-[10px] text-muted-foreground">
              {formatStepLocation(step)}
            </span>
          )}
        </span>
      }
    >
      {step.changes.length > 0 && <ChangeDetails changes={step.changes} />}
    </ChangeRow>
  );
}

function formatStepLocation(step: FlowVersionDiff['steps'][number]): string {
  if (step.changeType !== FlowVersionDiffChangeType.MOVED) {
    return '';
  }
  const { previousParentStepName, parentStepName } = step;
  if (!previousParentStepName && parentStepName) {
    return t('Moved into {{name}}', { name: parentStepName });
  }
  if (previousParentStepName && !parentStepName) {
    return t('Moved out of {{name}}', { name: previousParentStepName });
  }
  if (
    previousParentStepName &&
    parentStepName &&
    previousParentStepName !== parentStepName
  ) {
    return t('Moved from {{from}} into {{to}}', {
      from: previousParentStepName,
      to: parentStepName,
    });
  }
  return t('Moved to a new position');
}

function ChangeRow({
  icon,
  kind,
  title,
  subtitle,
  children,
}: {
  icon: ReactNode;
  kind: FlowVersionDiffChangeType;
  title: string;
  subtitle?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 border-b px-4 py-3 last:border-b-0">
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 ${kindIconClass(kind)}`}>{icon}</span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-sm font-medium">{title}</span>
          {subtitle}
        </div>
      </div>
      {children && <div className="pl-7">{children}</div>}
    </div>
  );
}

function ChangeDetails({ changes }: { changes: FlowVersionDiffValueChange[] }) {
  if (changes.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-1.5">
      {changes.map((change, index) => (
        <div
          key={`${change.path}-${index}`}
          className="grid grid-cols-[minmax(0,140px)_1fr_1fr] items-start gap-2 text-xs"
        >
          <span className="font-medium text-muted-foreground">
            {fieldLabel(change.label)}
          </span>
          <ValueCell
            value={change.before}
            masked={change.beforeMasked}
            empty={t('(none)')}
          />
          <ValueCell
            value={change.after}
            masked={change.afterMasked}
            empty={t('(none)')}
          />
        </div>
      ))}
    </div>
  );
}

function ValueCell({
  value,
  masked,
  empty,
}: {
  value: unknown;
  masked?: boolean;
  empty: string;
}) {
  if (masked) {
    return (
      <span className="flex items-center gap-1 rounded bg-warning/10 px-2 py-1 font-mono text-warning-700 dark:text-warning-300">
        {typeof value === 'string' && value.length > 0 ? value : MASKED_LABEL}
      </span>
    );
  }
  if (isNil(value) || value === '') {
    return <span className="text-muted-foreground/60">{empty}</span>;
  }
  if (typeof value === 'string') {
    return (
      <span className="break-words rounded bg-muted px-2 py-1 font-mono">
        {value}
      </span>
    );
  }
  return (
    <pre className="max-h-40 overflow-auto rounded bg-muted px-2 py-1 font-mono text-[11px]">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

const MASKED_LABEL = '••••••••';

function changeIcon(kind: FlowVersionDiffChangeType): ReactNode {
  switch (kind) {
    case FlowVersionDiffChangeType.ADDED:
      return <Plus className="size-4" />;
    case FlowVersionDiffChangeType.REMOVED:
      return <Trash2 className="size-4" />;
    case FlowVersionDiffChangeType.MOVED:
      return <MoveRight className="size-4" />;
    case FlowVersionDiffChangeType.MODIFIED:
    default:
      return <Pencil className="size-4" />;
  }
}

function kindIconClass(kind: FlowVersionDiffChangeType): string {
  switch (kind) {
    case FlowVersionDiffChangeType.ADDED:
      return 'text-success';
    case FlowVersionDiffChangeType.REMOVED:
      return 'text-destructive';
    case FlowVersionDiffChangeType.MOVED:
      return 'text-info';
    default:
      return 'text-warning';
  }
}

function kindBadgeClass(kind: FlowVersionDiffChangeType): string {
  switch (kind) {
    case FlowVersionDiffChangeType.ADDED:
      return 'bg-success/15 text-success-700 dark:text-success';
    case FlowVersionDiffChangeType.REMOVED:
      return 'bg-destructive/15 text-destructive';
    case FlowVersionDiffChangeType.MOVED:
      return 'bg-info/15 text-info-700 dark:text-info-300';
    default:
      return 'bg-warning/15 text-warning-700 dark:text-warning-300';
  }
}

function sectionLabel(section: FlowVersionDiffSection): string {
  switch (section) {
    case FlowVersionDiffSection.TRIGGER:
      return t('Trigger');
    case FlowVersionDiffSection.ROUTER:
      return t('Router');
    case FlowVersionDiffSection.LOOP:
      return t('Loop');
    case FlowVersionDiffSection.INPUT:
      return t('Input');
    case FlowVersionDiffSection.CONNECTION:
      return t('Connection');
    case FlowVersionDiffSection.ACTION:
    default:
      return t('Action');
  }
}

function fieldLabel(label: string): string {
  const known: Record<string, string> = {
    displayName: t('Name'),
    stepType: t('Type'),
    skip: t('Skipped'),
    pieceName: t('Piece'),
    actionOrTriggerName: t('Action/Trigger'),
    pieceVersion: t('Piece version'),
    loopItems: t('Loop items'),
    sourceCode: t('Code'),
    packageJson: t('Dependencies'),
    routerExecutionType: t('Execution type'),
    continueOnFailure: t('Continue on failure'),
    retryOnFailure: t('Retry on failure'),
    triggerType: t('Trigger type'),
    content: t('Content'),
    position: t('Position'),
    color: t('Color'),
  };
  if (known[label]) {
    return known[label];
  }
  if (label.startsWith('branch_')) {
    return t('Branch');
  }
  return label;
}
