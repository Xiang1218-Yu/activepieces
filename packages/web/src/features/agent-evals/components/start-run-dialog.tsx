import {
  Agent,
  AgentEvalAgentVersion,
  AgentEvalToolExecution,
  DEFAULT_EVAL_CASE_TIMEOUT_MS,
  DEFAULT_EVAL_CONCURRENCY,
  MAX_EVAL_CASE_TIMEOUT_MS,
  MAX_EVAL_CONCURRENCY,
} from '@activepieces/shared';
import { t } from 'i18next';
import { FlaskConical, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { agentEvalMutations } from '../hooks/agent-evals-hooks';

export const StartRunDialog = ({
  projectId,
  agent,
  suiteId,
  caseCount,
  open,
  onOpenChange,
}: {
  projectId: string;
  agent: Agent;
  suiteId: string;
  caseCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const navigate = useNavigate();
  const [agentVersion, setAgentVersion] = useState<AgentEvalAgentVersion>(
    AgentEvalAgentVersion.DRAFT,
  );
  const [modelName, setModelName] = useState('');
  const [toolExecution, setToolExecution] = useState<AgentEvalToolExecution>(
    AgentEvalToolExecution.DRY,
  );
  const [maxConcurrency, setMaxConcurrency] = useState(DEFAULT_EVAL_CONCURRENCY);
  const [maxCostCredits, setMaxCostCredits] = useState('');
  const [timeoutSeconds, setTimeoutSeconds] = useState(
    DEFAULT_EVAL_CASE_TIMEOUT_MS / 1000,
  );

  const startRun = agentEvalMutations.useStartRun(projectId);

  const config =
    agentVersion === AgentEvalAgentVersion.PUBLISHED
      ? agent.published
      : agent.draft;
  const publishedMissing = agent.published === null;

  const submit = () => {
    const budget = parseFloat(maxCostCredits);
    startRun.mutate(
      {
        suiteId,
        agentVersion,
        ...(modelName.trim().length > 0 ? { modelName: modelName.trim() } : {}),
        toolExecution,
        maxConcurrency,
        ...(Number.isFinite(budget) && budget > 0
          ? { maxCostCredits: budget }
          : {}),
        caseTimeoutMs: Math.min(
          MAX_EVAL_CASE_TIMEOUT_MS,
          Math.max(1, timeoutSeconds) * 1000,
        ),
      },
      {
        onSuccess: (run) => {
          onOpenChange(false);
          navigate(
            `/projects/${projectId}/agents/${agent.id}/evals/runs/${run.id}`,
          );
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t('Run evals')}</DialogTitle>
          <DialogDescription>
            {t(
              'Run {count} test cases in the background. Each case gets its own isolated conversation.',
              { count: caseCount },
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>{t('Agent version')}</Label>
            <Select
              value={agentVersion}
              onValueChange={(value) =>
                setAgentVersion(value as AgentEvalAgentVersion)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={AgentEvalAgentVersion.DRAFT}>
                  {t('Draft (current edits)')}
                </SelectItem>
                <SelectItem
                  value={AgentEvalAgentVersion.PUBLISHED}
                  disabled={publishedMissing}
                >
                  {publishedMissing
                    ? t('Published (none yet)')
                    : t('Published (live version)')}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label>{t('Model override')}</Label>
            <Input
              value={modelName}
              onChange={(event) => setModelName(event.target.value)}
              placeholder={
                config?.modelName
                  ? t('Default: {model}', { model: config.modelName })
                  : t('Leave empty to use the agent model')
              }
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label>{t('Tool execution')}</Label>
            <Select
              value={toolExecution}
              onValueChange={(value) =>
                setToolExecution(value as AgentEvalToolExecution)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={AgentEvalToolExecution.DRY}>
                  {t('Dry run — tools are simulated')}
                </SelectItem>
                <SelectItem value={AgentEvalToolExecution.LIVE}>
                  {t('Live — tools run on real connections')}
                </SelectItem>
              </SelectContent>
            </Select>
            {toolExecution === AgentEvalToolExecution.LIVE ? (
              <p className="flex items-start gap-1.5 text-[13px] leading-4 text-amber-700">
                <TriangleAlert size={14} className="mt-px shrink-0" />
                {t(
                  'Tools will act on this project’s real connections. Cases that need human approval are auto-declined so the batch keeps moving.',
                )}
              </p>
            ) : (
              <p className="text-[13px] leading-4 text-muted-foreground">
                {t(
                  'Tools return a simulated result, so no connection or file in production conversations is touched.',
                )}
              </p>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-2">
              <Label>{t('Concurrency')}</Label>
              <Input
                type="number"
                min={1}
                max={MAX_EVAL_CONCURRENCY}
                value={maxConcurrency}
                onChange={(event) =>
                  setMaxConcurrency(
                    Math.max(
                      1,
                      Math.min(
                        MAX_EVAL_CONCURRENCY,
                        Number(event.target.value) || 1,
                      ),
                    ),
                  )
                }
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>{t('Credit budget')}</Label>
              <Input
                type="number"
                min={0}
                value={maxCostCredits}
                placeholder={t('No limit')}
                onChange={(event) => setMaxCostCredits(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>{t('Case timeout (s)')}</Label>
              <Input
                type="number"
                min={1}
                max={MAX_EVAL_CASE_TIMEOUT_MS / 1000}
                value={timeoutSeconds}
                onChange={(event) =>
                  setTimeoutSeconds(Number(event.target.value) || 1)
                }
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('Cancel')}
          </Button>
          <Button
            onClick={submit}
            loading={startRun.isPending}
            disabled={caseCount === 0}
            className="gap-2"
          >
            <FlaskConical size={15} />
            {t('Start run')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
