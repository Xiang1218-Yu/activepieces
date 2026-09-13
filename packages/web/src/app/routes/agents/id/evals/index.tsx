import { AgentEvalSuite } from '@activepieces/shared';
import { t } from 'i18next';
import { FlaskConical, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { DataFetchErrorState } from '@/components/custom/data-fetch-error-state';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/custom/empty';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import {
  EvalRunStatusBadge,
  formatCredits,
} from '@/features/agent-evals/components/eval-status-badges';
import {
  agentEvalMutations,
  agentEvalQueries,
} from '@/features/agent-evals/hooks/agent-evals-hooks';
import { agentsQueries } from '@/features/agents/hooks/agents-hooks';
import { projectCollectionUtils } from '@/features/projects';

const AgentEvalSuitesPage = () => {
  const { agentId } = useParams<{ agentId: string }>();
  const { project } = projectCollectionUtils.useCurrentProject();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  const agent = agentsQueries.useAgent({ id: agentId ?? '' });
  const suites = agentEvalQueries.useSuites(project.id, agentId);
  const runs = agentEvalQueries.useRuns(project.id);
  const agentRuns = (runs.data ?? []).filter((run) => run.agentId === agentId);

  const suitePath = (suiteId: string) =>
    `/projects/${project.id}/agents/${agentId}/evals/suites/${suiteId}`;
  const runPath = (runId: string) =>
    `/projects/${project.id}/agents/${agentId}/evals/runs/${runId}`;

  return (
    <div className="flex w-full flex-col gap-8 px-12 py-8">
      <div className="flex items-center gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-[-0.01em]">
            {t('Evals')}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t(
              'Batch-test {agent} against saved cases, then compare outcomes and cost.',
              { agent: agent.data?.displayName ?? t('this agent') },
            )}
          </p>
        </div>
        <Button className="ms-auto gap-2" onClick={() => setCreating(true)}>
          <Plus size={15} />
          {t('New suite')}
        </Button>
      </div>

      {suites.isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : suites.isError ? (
        <DataFetchErrorState
          entity={t('eval suites')}
          onRetry={() => suites.refetch()}
        />
      ) : (suites.data ?? []).length === 0 ? (
        <Empty className="min-h-[220px]">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FlaskConical />
            </EmptyMedia>
            <EmptyTitle>{t('No eval suites yet')}</EmptyTitle>
            <EmptyDescription>
              {t(
                'A suite is a set of test cases with variables. Run it against a draft or published version to see what changed.',
              )}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-[10px] border border-border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{t('Suite')}</TableHead>
                <TableHead>{t('Variables')}</TableHead>
                <TableHead>{t('Updated')}</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(suites.data ?? []).map((suite) => (
                <SuiteRow
                  key={suite.id}
                  suite={suite}
                  projectId={project.id}
                  onOpen={() => navigate(suitePath(suite.id))}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {agentRuns.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{t('Recent runs')}</h2>
          <div className="overflow-x-auto rounded-[10px] border border-border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>{t('Started')}</TableHead>
                  <TableHead>{t('Status')}</TableHead>
                  <TableHead>{t('Version')}</TableHead>
                  <TableHead>{t('Results')}</TableHead>
                  <TableHead>{t('Credits')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agentRuns.slice(0, 10).map((run) => (
                  <TableRow
                    key={run.id}
                    className="cursor-pointer"
                    onClick={() => navigate(runPath(run.id))}
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
        </section>
      )}

      <CreateSuiteDialog
        projectId={project.id}
        agentId={agentId ?? ''}
        open={creating}
        onOpenChange={setCreating}
        onCreated={(suite) => navigate(suitePath(suite.id))}
      />
    </div>
  );
};

const SuiteRow = ({
  suite,
  projectId,
  onOpen,
}: {
  suite: AgentEvalSuite;
  projectId: string;
  onOpen: () => void;
}) => {
  const deleteSuite = agentEvalMutations.useDeleteSuite(projectId);
  return (
    <TableRow className="cursor-pointer" onClick={onOpen}>
      <TableCell>
        <div className="flex flex-col">
          <span className="text-sm font-medium">{suite.name}</span>
          {suite.description && (
            <span className="max-w-[420px] truncate text-xs text-muted-foreground">
              {suite.description}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex max-w-[280px] flex-wrap gap-1">
          {suite.variableNames.length === 0 ? (
            <span className="text-xs text-muted-foreground">—</span>
          ) : (
            suite.variableNames.map((name) => (
              <code
                key={name}
                className="rounded bg-muted px-1.5 py-0.5 text-[11px]"
              >
                {`{{${name}}}`}
              </code>
            ))
          )}
        </div>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {new Date(suite.updated).toLocaleDateString()}
      </TableCell>
      <TableCell>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('Delete suite')}
          onClick={(event) => {
            event.stopPropagation();
            deleteSuite.mutate(suite.id);
          }}
        >
          <Trash2 size={15} className="text-muted-foreground" />
        </Button>
      </TableCell>
    </TableRow>
  );
};

const CreateSuiteDialog = ({
  projectId,
  agentId,
  open,
  onOpenChange,
  onCreated,
}: {
  projectId: string;
  agentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (suite: AgentEvalSuite) => void;
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [variablesText, setVariablesText] = useState('');
  const createSuite = agentEvalMutations.useCreateSuite(projectId);

  const submit = () => {
    const variableNames = variablesText
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => /^[a-zA-Z][a-zA-Z0-9_]*$/.test(entry));
    createSuite.mutate(
      {
        agentId,
        name: name.trim(),
        ...(description.trim().length > 0
          ? { description: description.trim() }
          : {}),
        variableNames,
      },
      {
        onSuccess: (suite) => {
          setName('');
          setDescription('');
          setVariablesText('');
          onCreated(suite);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{t('New eval suite')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>{t('Name')}</Label>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('e.g. Refund requests')}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label>{t('Description (optional)')}</Label>
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              minRows={2}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label>{t('Variables (optional)')}</Label>
            <Input
              value={variablesText}
              onChange={(event) => setVariablesText(event.target.value)}
              placeholder={t('customer_name, order_id')}
            />
            <p className="text-xs text-muted-foreground">
              {t(
                'Comma-separated. Cases reference them as {{customer_name}} in their messages.',
              )}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('Cancel')}
          </Button>
          <Button
            onClick={submit}
            loading={createSuite.isPending}
            disabled={name.trim().length === 0}
          >
            {t('Create suite')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AgentEvalSuitesPage;
