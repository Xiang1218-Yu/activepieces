import {
  AgentEvalCase,
  AgentEvalSuite,
  agentEvalUtils,
} from '@activepieces/shared';
import { t } from 'i18next';
import { useEffect, useMemo, useState } from 'react';

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
import { Textarea } from '@/components/ui/textarea';

import { agentEvalMutations } from '../hooks/agent-evals-hooks';

export const CaseEditorDialog = ({
  projectId,
  suite,
  evalCase,
  open,
  onOpenChange,
}: {
  projectId: string;
  suite: AgentEvalSuite;
  evalCase: AgentEvalCase | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const [name, setName] = useState('');
  const [messageTemplate, setMessageTemplate] = useState('');
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [expectedOutput, setExpectedOutput] = useState('');

  useEffect(() => {
    if (open) {
      setName(evalCase?.name ?? '');
      setMessageTemplate(evalCase?.messageTemplate ?? '');
      setVariables(evalCase?.variables ?? {});
      setExpectedOutput(evalCase?.expectedOutput ?? '');
    }
  }, [open, evalCase]);

  const saveCase = agentEvalMutations.useSaveCase(projectId, suite.id);

  // Variables the template actually references, in declared-then-found order, so the
  // editor asks for exactly the values the render will need.
  const activeVariableNames = useMemo(() => {
    const found = agentEvalUtils.extractVariables(messageTemplate);
    const declared = suite.variableNames.filter((name) => found.includes(name));
    const undeclared = found.filter(
      (name) => !suite.variableNames.includes(name),
    );
    return [...declared, ...undeclared];
  }, [messageTemplate, suite.variableNames]);

  const submit = () => {
    const trimmedVariables = Object.fromEntries(
      activeVariableNames.map((name) => [name, variables[name] ?? '']),
    );
    saveCase.mutate(
      {
        caseId: evalCase?.id,
        request: {
          name: name.trim(),
          messageTemplate,
          variables: trimmedVariables,
          ...(expectedOutput.trim().length > 0
            ? { expectedOutput: expectedOutput.trim() }
            : { expectedOutput: null }),
        },
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  const preview = agentEvalUtils.render(
    messageTemplate,
    Object.fromEntries(
      activeVariableNames.map((name) => [name, variables[name] ?? '']),
    ),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[640px]">
        <DialogHeader>
          <DialogTitle>
            {evalCase ? t('Edit test case') : t('New test case')}
          </DialogTitle>
        </DialogHeader>

        <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto pe-1">
          <div className="flex flex-col gap-2">
            <Label>{t('Name')}</Label>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('e.g. Angry customer asks for a refund')}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label>{t('Message')}</Label>
            <Textarea
              value={messageTemplate}
              onChange={(event) => setMessageTemplate(event.target.value)}
              minRows={4}
              placeholder={t(
                'The user message to send. Use {{variable}} for values that change per case.',
              )}
            />
          </div>

          {activeVariableNames.length > 0 && (
            <div className="flex flex-col gap-2">
              <Label>{t('Variables')}</Label>
              <div className="flex flex-col gap-2 rounded-md border border-border p-3">
                {activeVariableNames.map((variableName) => (
                  <div
                    key={variableName}
                    className="grid grid-cols-[160px_1fr] items-center gap-3"
                  >
                    <code className="truncate rounded bg-muted px-1.5 py-1 text-xs">
                      {`{{${variableName}}}`}
                    </code>
                    <Input
                      value={variables[variableName] ?? ''}
                      onChange={(event) =>
                        setVariables((current) => ({
                          ...current,
                          [variableName]: event.target.value,
                        }))
                      }
                      placeholder={t('Value for this case')}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label>{t('Expected output (optional)')}</Label>
            <Textarea
              value={expectedOutput}
              onChange={(event) => setExpectedOutput(event.target.value)}
              minRows={2}
              placeholder={t(
                'What a good answer looks like — kept next to the result for review.',
              )}
            />
          </div>

          {messageTemplate.includes('{{') && (
            <div className="flex flex-col gap-2">
              <Label>{t('Rendered preview')}</Label>
              <p className="whitespace-pre-wrap rounded-md bg-muted p-3 text-[13px] leading-5 text-muted-foreground">
                {preview}
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('Cancel')}
          </Button>
          <Button
            onClick={submit}
            loading={saveCase.isPending}
            disabled={
              name.trim().length === 0 || messageTemplate.trim().length === 0
            }
          >
            {evalCase ? t('Save case') : t('Add case')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
