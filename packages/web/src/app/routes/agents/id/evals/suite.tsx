import { AgentEvalCase } from '@activepieces/shared';
import { t } from 'i18next';
import {
  ArrowLeft,
  FlaskConical,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { DataFetchErrorState } from '@/components/custom/data-fetch-error-state';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { CaseEditorDialog } from '@/features/agent-evals/components/case-editor-dialog';
import {
  EvalRunStatusBadge,
  formatCredits,
} from '@/features/agent-evals/components/eval-status-badges';
import { StartRunDialog } from '@/features/agent-evals/components/start-run-dialog';
import {
  agentEvalMutations,
  agentEvalQueries,
} from '@/features/agent-evals/hooks/agent-evals-hooks';
import { agentsQueries } from '@/features/agents/hooks/agents-hooks';
import { projectCollectionUtils } from '@/features/projects';

const AgentEvalSuitePage = () => {
  const { agentId, suiteId } = useParams<{ agentId: string; suiteId: string }>();
  const { project } = projectCollectionUtils.useCurrentProject();
  const navigate = useNavigate();

  const agent = agentsQueries.useAgent({ id: agentId ?? '' });
  const suite = agentEvalQueries.useSuite(project.id, suiteId ?? '');
  const cases = agentEvalQueries.useCases(project.id, suiteId ?? '');
  const runs = agentEvalQueries.useRuns(project.id, suiteId);

  const [editingCase, setEditingCase] = useState<AgentEvalCase | null>(null);
  const [caseDialogOpen, setCaseDialogOpen] = useState(false);
  const [runDialogOpen, setRunDialogOpen] = useState(false);

  if (suite.isLoading || agent.isLoading) {
    return (
      <div className="flex w-full flex-col gap-4 px-12 py-8">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (suite.isError || !suite.data || !agent.data) {
    return (
      <div className="px-12 py-8">
        <DataFetchErrorState
          entity={t('eval suite')}
          onRetry={() => suite.refetch()}
        />
      </div>
    );
  }

  const caseList = cases.data ?? [];

  return (
    <div className="flex w-full flex-col gap-8 px-12 py-8">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('Back to suites')}
          onClick={() =>
            navigate(`/projects/${project.id}/agents/${agentId}/evals`)
          }
        >
          <ArrowLeft size={16} />
        </Button>
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="truncate text-2xl font-semibold tracking-[-0.01em]">
            {suite.data.name}
          </h1>
          {suite.data.description && (
            <p className="text-sm text-muted-foreground">
              {suite.data.description}
            </p>
          )}
        </div>
        <div className="ms-auto flex items-center gap-2">
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => {
              setEditingCase(null);
              setCaseDialogOpen(true);
            }}
          >
            <Plus size={15} />
            {t('Add case')}
          </Button>
          <Button className="gap-2" onClick={() => setRunDialogOpen(true)}>
            <FlaskConical size={15} />
            {t('Run evals')}
          </Button>
        </div>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">
          {t('Test cases')}
          <span className="ms-2 text-sm font-normal text-muted-foreground">
            {caseList.length}
          </span>
        </h2>
        {cases.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : caseList.length === 0 ? (
          <p className="rounded-[10px] border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            {t(
              'No cases yet. Add one with a message — use {{variables}} for the parts that change per case.',
            )}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-[10px] border border-border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>{t('Case')}</TableHead>
                  <TableHead className="hidden lg:table-cell">
                    {t('Message')}
                  </TableHead>
                  <TableHead className="hidden md:table-cell">
                    {t('Variables')}
                  </TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {caseList.map((evalCase) => (
                  <CaseRow
                    key={evalCase.id}
                    evalCase={evalCase}
                    projectId={project.id}
                    suiteId={suiteId ?? ''}
                    onEdit={() => {
                      setEditingCase(evalCase);
                      setCaseDialogOpen(true);
                    }}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t('Runs')}</h2>
        {(runs.data ?? []).length === 0 ? (
          <p className="rounded-[10px] border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            {t('No runs yet — pick a version and a model, then run the suite.')}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-[10px] border border-border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>{t('Started')}</TableHead>
                  <TableHead>{t('Status')}</TableHead>
                  <TableHead>{t('Version')}</TableHead>
                  <TableHead>{t('Tools')}</TableHead>
                  <TableHead>{t('Results')}</TableHead>
                  <TableHead>{t('Credits')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(runs.data ?? []).map((run) => (
                  <TableRow
                    key={run.id}
                    className="cursor-pointer"
                    onClick={() =>
                      navigate(
                        `/projects/${project.id}/agents/${agentId}/evals/runs/${run.id}`,
                      )
                    }
                  >
                    <TableCell className="text-sm">
                      {new Date(run.created).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <EvalRunStatusBadge status={run.status} />
                    </TableCell>
                    <TableCell className="text-sm">
                      {run.agentVersion === 'DRAFT' ? t('Draft') : t('Published')}
                      {run.modelName ? ` · ${run.modelName}` : ''}
                    </TableCell>
                    <TableCell className="text-sm">
                      {run.toolExecution === 'DRY' ? t('Dry run') : t('Live')}
                    </TableCell>
                    <TableCell className="text-sm">
                      {t('{passed} passed, {failed} failed, {approval} to approve', {
                        passed: run.totals.succeeded,
                        failed: run.totals.failed + run.totals.timedOut,
                        approval: run.totals.needsApproval,
                      })}
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatCredits(run.totals.creditsUsed)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <CaseEditorDialog
        projectId={project.id}
        suite={suite.data}
        evalCase={editingCase}
        open={caseDialogOpen}
        onOpenChange={setCaseDialogOpen}
      />
      <StartRunDialog
        projectId={project.id}
        agent={agent.data}
        suiteId={suiteId ?? ''}
        caseCount={caseList.length}
        open={runDialogOpen}
        onOpenChange={setRunDialogOpen}
      />
    </div>
  );
};

const CaseRow = ({
  evalCase,
  projectId,
  suiteId,
  onEdit,
}: {
  evalCase: AgentEvalCase;
  projectId: string;
  suiteId: string;
  onEdit: () => void;
}) => {
  const deleteCase = agentEvalMutations.useDeleteCase(projectId, suiteId);
  const variableEntries = Object.entries(evalCase.variables);
  return (
    <TableRow className="cursor-pointer" onClick={onEdit}>
      <TableCell>
        <span className="text-sm font-medium">{evalCase.name}</span>
      </TableCell>
      <TableCell className="hidden max-w-[360px] lg:table-cell">
        <span className="line-clamp-2 whitespace-pre-wrap text-[13px] text-muted-foreground">
          {evalCase.messageTemplate}
        </span>
      </TableCell>
      <TableCell className="hidden md:table-cell">
        <div className="flex max-w-[220px] flex-wrap gap-1">
          {variableEntries.length === 0 ? (
            <span className="text-xs text-muted-foreground">—</span>
          ) : (
            variableEntries.map(([name, value]) => (
              <code
                key={name}
                className="max-w-[200px] truncate rounded bg-muted px-1.5 py-0.5 text-[11px]"
                title={`${name} = ${value}`}
              >
                {`${name}=${value}`}
              </code>
            ))
          )}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('Edit case')}
            onClick={(event) => {
              event.stopPropagation();
              onEdit();
            }}
          >
            <Pencil size={14} className="text-muted-foreground" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('Delete case')}
            onClick={(event) => {
              event.stopPropagation();
              deleteCase.mutate(evalCase.id);
            }}
          >
            <Trash2 size={14} className="text-muted-foreground" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
};

export default AgentEvalSuitePage;
