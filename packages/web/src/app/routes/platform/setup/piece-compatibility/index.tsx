import { SeekPage } from '@activepieces/core-utils';
import {
  CheckPieceCompatibilityRequest,
  FlowCompatibilityResult,
  FlowCompatibilityStatus,
  PieceCompatibilityIssueSeverity,
  PieceCompatibilityReport,
  PieceStepCompatibilityResult,
  PieceStepCompatibilityVerdict,
  ProjectWithLimits,
} from '@activepieces/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { t } from 'i18next';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  Play,
  ShieldAlert,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { DashboardPageHeader } from '@/app/components/dashboard-page-header';
import { SearchableSelect } from '@/components/custom/searchable-select';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { piecesHooks } from '@/features/pieces';
import { pieceCompatibilityApi } from '@/features/platform-admin/api/piece-compatibility-api';
import { api } from '@/lib/api';

type SourceType = 'PROJECT' | 'PASTED';

const VERDICT_RANK: Record<PieceStepCompatibilityVerdict, number> = {
  [PieceStepCompatibilityVerdict.COMPATIBLE]: 0,
  [PieceStepCompatibilityVerdict.DISPLAY_ONLY]: 1,
  [PieceStepCompatibilityVerdict.REAUTH_REQUIRED]: 2,
  [PieceStepCompatibilityVerdict.INCOMPATIBLE]: 3,
};

type VerdictPresentation = {
  label: string;
  variant: 'success' | 'info' | 'warning' | 'destructive';
};

function verdictPresentation(
  verdict: PieceStepCompatibilityVerdict,
): VerdictPresentation {
  switch (verdict) {
    case PieceStepCompatibilityVerdict.COMPATIBLE:
      return { label: t('Compatible'), variant: 'success' };
    case PieceStepCompatibilityVerdict.DISPLAY_ONLY:
      return { label: t('Display changes'), variant: 'info' };
    case PieceStepCompatibilityVerdict.REAUTH_REQUIRED:
      return { label: t('Re-authorization'), variant: 'warning' };
    case PieceStepCompatibilityVerdict.INCOMPATIBLE:
      return { label: t('Incompatible'), variant: 'destructive' };
  }
}

const PieceCompatibilityPage = () => {
  const [pieceName, setPieceName] = useState<string>();
  const [fromVersion, setFromVersion] = useState<string>();
  const [toVersion, setToVersion] = useState<string>();
  const [sourceType, setSourceType] = useState<SourceType>('PROJECT');
  const [projectId, setProjectId] = useState<string>();
  const [pastedJson, setPastedJson] = useState('');
  const [report, setReport] = useState<PieceCompatibilityReport | null>(null);

  const { pieces, isLoading: isPiecesLoading } = piecesHooks.usePieces({
    includeHidden: true,
  });
  const { pieceVersions, isLoading: isVersionsLoading } =
    piecesHooks.usePieceVersions(pieceName ?? '');
  const { data: projects, isLoading: isProjectsLoading } = useQuery({
    queryKey: ['piece-compatibility-projects'],
    queryFn: async () => {
      const response = await api.get<SeekPage<ProjectWithLimits>>(
        '/v1/projects',
        { limit: 1000 },
      );
      return response.data;
    },
    staleTime: 60_000,
  });

  const versionOptions = useMemo(
    () =>
      (pieceVersions ?? []).map((entry) => ({
        value: entry.version,
        label: entry.version,
      })),
    [pieceVersions],
  );

  const { mutate: runCheck, isPending } = useMutation({
    mutationFn: (request: CheckPieceCompatibilityRequest) =>
      pieceCompatibilityApi.check(request),
    onSuccess: (result) => setReport(result),
    onError: () => toast.error(t('Failed to run the compatibility check')),
  });

  const onRunCheck = () => {
    if (!pieceName || !fromVersion || !toVersion) {
      toast.error(t('Select a piece and both versions first'));
      return;
    }
    if (sourceType === 'PROJECT') {
      if (!projectId) {
        toast.error(t('Select a project to read flow versions from'));
        return;
      }
      runCheck({
        pieceName,
        fromVersion,
        toVersion,
        source: { type: 'PROJECT', projectId },
      });
      return;
    }
    const flowVersions = parsePastedFlowVersions(pastedJson);
    if (!flowVersions) {
      toast.error(
        t('Invalid JSON. Paste a flow version object or an array of them.'),
      );
      return;
    }
    runCheck({
      pieceName,
      fromVersion,
      toVersion,
      source: { type: 'PASTED', flowVersions },
    });
  };

  return (
    <>
      <DashboardPageHeader
        title={t('Piece Compatibility Checker')}
        description={t(
          'Check whether flows configured on one piece version are still accepted by another version before enabling automation.',
        )}
      />
      <div className="mx-auto w-full max-w-5xl flex flex-col gap-6 px-4 pb-10">
        <Card>
          <CardHeader>
            <CardTitle>{t('Check configuration')}</CardTitle>
            <CardDescription>
              {t(
                'Pick a piece and two versions, then choose which flow versions to check.',
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="flex flex-col gap-2">
                <Label>{t('Piece')}</Label>
                <SearchableSelect
                  value={pieceName}
                  onChange={(value) => {
                    setPieceName(value ?? undefined);
                    setFromVersion(undefined);
                    setToVersion(undefined);
                  }}
                  options={(pieces ?? []).map((piece) => ({
                    value: piece.name,
                    label: piece.displayName,
                    description: piece.name,
                  }))}
                  placeholder={t('Select a piece')}
                  loading={isPiecesLoading}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label>{t('From version')}</Label>
                <SearchableSelect
                  value={fromVersion}
                  onChange={(value) => setFromVersion(value ?? undefined)}
                  options={versionOptions}
                  placeholder={t('Current version')}
                  disabled={!pieceName}
                  loading={isVersionsLoading}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label>{t('To version')}</Label>
                <SearchableSelect
                  value={toVersion}
                  onChange={(value) => setToVersion(value ?? undefined)}
                  options={versionOptions}
                  placeholder={t('Target version')}
                  disabled={!pieceName}
                  loading={isVersionsLoading}
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label>{t('Flow versions')}</Label>
              <Tabs
                value={sourceType}
                onValueChange={(value) => setSourceType(value as SourceType)}
              >
                <TabsList variant="outline">
                  <TabsTrigger variant="outline" value="PROJECT">
                    {t('Read from project')}
                  </TabsTrigger>
                  <TabsTrigger variant="outline" value="PASTED">
                    {t('Paste JSON')}
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              {sourceType === 'PROJECT' ? (
                <SearchableSelect
                  value={projectId}
                  onChange={(value) => setProjectId(value ?? undefined)}
                  options={(projects ?? []).map((project) => ({
                    value: project.id,
                    label: project.displayName,
                  }))}
                  placeholder={t('Select a project')}
                  loading={isProjectsLoading}
                />
              ) : (
                <Textarea
                  value={pastedJson}
                  onChange={(event) => setPastedJson(event.target.value)}
                  placeholder={t(
                    'Paste a flow version JSON object or an array of flow versions',
                  )}
                  className="min-h-40 font-mono text-xs"
                />
              )}
            </div>

            <div>
              <Button onClick={onRunCheck} disabled={isPending}>
                {isPending ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <Play className="mr-2 size-4" />
                )}
                {t('Run check')}
              </Button>
            </div>
          </CardContent>
        </Card>

        {report && <CompatibilityReportView report={report} />}
      </div>
    </>
  );
};

function parsePastedFlowVersions(raw: string): unknown[] | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.length > 0 ? parsed : null;
    }
    if (typeof parsed === 'object' && parsed !== null) {
      return [parsed];
    }
    return null;
  } catch {
    return null;
  }
}

function worstVerdictOf(
  flow: FlowCompatibilityResult,
): PieceStepCompatibilityVerdict | null {
  if (flow.steps.length === 0) {
    return null;
  }
  return flow.steps
    .map((step) => step.verdict)
    .reduce((worst, verdict) =>
      VERDICT_RANK[verdict] > VERDICT_RANK[worst] ? verdict : worst,
    );
}

const CompatibilityReportView = ({
  report,
}: {
  report: PieceCompatibilityReport;
}) => {
  const projectGroups = useMemo(() => {
    const groups = new Map<string, FlowCompatibilityResult[]>();
    for (const flow of report.flows) {
      const key =
        flow.projectName ?? flow.projectId ?? t('Pasted flow versions');
      groups.set(key, [...(groups.get(key) ?? []), flow]);
    }
    return [...groups.entries()];
  }, [report]);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>
            {t('Summary')} — {report.pieceName} {report.fromVersion} →{' '}
            {report.toVersion}
          </CardTitle>
          <CardDescription>
            {t('Generated at {date}', {
              date: new Date(report.generatedAt).toLocaleString(),
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Badge variant="outline">
            {t('{count} flows checked', { count: report.summary.flowsChecked })}
          </Badge>
          {report.summary.flowsErrored > 0 && (
            <Badge variant="destructive">
              {t('{count} flows failed', {
                count: report.summary.flowsErrored,
              })}
            </Badge>
          )}
          <Badge variant="destructive">
            {t('{count} incompatible', {
              count: report.summary.incompatibleSteps,
            })}
          </Badge>
          <Badge variant="warning">
            {t('{count} need re-authorization', {
              count: report.summary.reauthRequiredSteps,
            })}
          </Badge>
          <Badge variant="info">
            {t('{count} display changes', {
              count: report.summary.displayOnlySteps,
            })}
          </Badge>
          <Badge variant="success">
            {t('{count} compatible', { count: report.summary.compatibleSteps })}
          </Badge>
        </CardContent>
      </Card>

      {projectGroups.map(([projectLabel, flows]) => (
        <Card key={projectLabel}>
          <CardHeader>
            <CardTitle className="text-base">{projectLabel}</CardTitle>
          </CardHeader>
          <CardContent>
            <Accordion
              type="multiple"
              defaultValue={flows.map((_, index) => `${projectLabel}-${index}`)}
            >
              {flows.map((flow, index) => (
                <FlowResultItem
                  key={`${projectLabel}-${index}`}
                  value={`${projectLabel}-${index}`}
                  flow={flow}
                />
              ))}
            </Accordion>
          </CardContent>
        </Card>
      ))}
    </>
  );
};

const FlowResultItem = ({
  flow,
  value,
}: {
  flow: FlowCompatibilityResult;
  value: string;
}) => {
  const worstVerdict = worstVerdictOf(flow);
  return (
    <AccordionItem value={value}>
      <AccordionTrigger>
        <div className="flex flex-1 items-center gap-3 pr-2">
          <span className="font-medium">
            {flow.flowDisplayName ?? t('Unnamed flow')}
          </span>
          <FlowStatusBadge flow={flow} worstVerdict={worstVerdict} />
          <span className="ml-auto text-xs text-muted-foreground">
            {flow.flowVersionId ?? flow.flowId}
          </span>
        </div>
      </AccordionTrigger>
      <AccordionContent>
        {flow.status === FlowCompatibilityStatus.ERROR && (
          <div className="flex items-start gap-2 rounded-md border border-destructive-600 bg-destructive-50 p-3 text-sm text-destructive-700">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>{flow.error}</span>
          </div>
        )}
        {flow.status === FlowCompatibilityStatus.NOT_USING_PIECE && (
          <div className="text-sm text-muted-foreground">
            {t('This flow version does not use the selected piece.')}
          </div>
        )}
        {flow.steps.length > 0 && (
          <div className="flex flex-col gap-3">
            {flow.steps.map((step) => (
              <StepResultRow key={step.stepName} step={step} />
            ))}
          </div>
        )}
      </AccordionContent>
    </AccordionItem>
  );
};

const FlowStatusBadge = ({
  flow,
  worstVerdict,
}: {
  flow: FlowCompatibilityResult;
  worstVerdict: PieceStepCompatibilityVerdict | null;
}) => {
  if (flow.status === FlowCompatibilityStatus.ERROR) {
    return <Badge variant="destructive">{t('Error')}</Badge>;
  }
  if (flow.status === FlowCompatibilityStatus.NOT_USING_PIECE) {
    return <Badge variant="outline">{t('Not using piece')}</Badge>;
  }
  if (!worstVerdict) {
    return null;
  }
  const presentation = verdictPresentation(worstVerdict);
  return <Badge variant={presentation.variant}>{presentation.label}</Badge>;
};

const StepResultRow = ({ step }: { step: PieceStepCompatibilityResult }) => {
  const presentation = verdictPresentation(step.verdict);
  const VerdictIcon = VERDICT_ICONS[step.verdict];
  return (
    <div className="rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <VerdictIcon className="size-4 shrink-0" />
        <span className="font-medium">{step.stepDisplayName}</span>
        <span className="text-xs text-muted-foreground">
          {step.stepName}
          {step.actionOrTriggerName ? ` · ${step.actionOrTriggerName}` : ''} · v
          {step.pieceVersion}
        </span>
        <Badge variant={presentation.variant} className="ml-auto">
          {presentation.label}
        </Badge>
      </div>
      {step.issues.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1.5">
          {step.issues.map((issue, index) => (
            <li
              key={`${issue.code}-${issue.propertyName ?? ''}-${index}`}
              className="flex items-start gap-2 text-sm text-muted-foreground"
            >
              <IssueSeverityIcon severity={issue.severity} />
              <span>
                {issue.propertyName && (
                  <code className="mr-1 rounded bg-muted px-1 text-xs">
                    {issue.propertyName}
                  </code>
                )}
                {issue.message}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

const VERDICT_ICONS: Record<
  PieceStepCompatibilityVerdict,
  typeof CheckCircle2
> = {
  [PieceStepCompatibilityVerdict.COMPATIBLE]: CheckCircle2,
  [PieceStepCompatibilityVerdict.DISPLAY_ONLY]: Info,
  [PieceStepCompatibilityVerdict.REAUTH_REQUIRED]: ShieldAlert,
  [PieceStepCompatibilityVerdict.INCOMPATIBLE]: AlertTriangle,
};

const IssueSeverityIcon = ({
  severity,
}: {
  severity: PieceCompatibilityIssueSeverity;
}) => {
  switch (severity) {
    case PieceCompatibilityIssueSeverity.INCOMPATIBLE:
      return (
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive-600" />
      );
    case PieceCompatibilityIssueSeverity.REAUTH_REQUIRED:
      return (
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning-600" />
      );
    default:
      return <Info className="mt-0.5 size-4 shrink-0 text-blue-600" />;
  }
};

PieceCompatibilityPage.displayName = 'PieceCompatibilityPage';
export { PieceCompatibilityPage };
