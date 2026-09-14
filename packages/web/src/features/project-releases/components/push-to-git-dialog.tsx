import { assertNotNullOrUndefined } from '@activepieces/core-utils';
import {
  GitPushOperationStatus,
  GitPushOperationType,
  PushGitRepoRequest,
  PushFlowsGitRepoRequest,
  PushTablesGitRepoRequest,
  PopulatedFlow,
  Table,
} from '@activepieces/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { t } from 'i18next';
import { AlertTriangle } from 'lucide-react';
import React from 'react';
import { Resolver, useForm } from 'react-hook-form';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from '@/components/ui/form';
import { Textarea } from '@/components/ui/textarea';
import { platformHooks } from '@/hooks/platform-hooks';
import { authenticationSession } from '@/lib/authentication-session';

import { gitSyncMutations, gitSyncHooks } from '../hooks/git-sync-hooks';
import { gitPushErrorUtils } from '../lib/git-push-error-utils';

import { GitPushStatusPanel } from './git-push-status-panel';

type PushToGitDialogProps =
  | {
      type: 'flow';
      flows: PopulatedFlow[];
      children?: React.ReactNode;
    }
  | {
      type: 'table';
      tables: Table[];
      children?: React.ReactNode;
    };

const PushToGitDialog = (props: PushToGitDialogProps) => {
  const [open, setOpen] = React.useState(false);
  const [inlineError, setInlineError] = React.useState<string | null>(null);

  const showPushToGit = gitSyncHooks.useShowPushToGit();
  const { platform } = platformHooks.useCurrentPlatform();
  const projectId = authenticationSession.getProjectId()!;
  const { gitSync } = gitSyncHooks.useGitSync(
    projectId,
    platform.plan.environmentsEnabled,
  );
  const { data: latestOperation } = gitSyncHooks.useLatestPushOperation(
    projectId,
    open && platform.plan.environmentsEnabled,
  );
  const queryClient = useQueryClient();

  const form = useForm<PushGitRepoRequest>({
    defaultValues: {
      type:
        props.type === 'flow'
          ? GitPushOperationType.PUSH_FLOW
          : GitPushOperationType.PUSH_TABLE,
      commitMessage: '',
      externalFlowIds:
        props.type === 'flow' ? props.flows.map((item) => item.externalId) : [],
      externalTableIds:
        props.type === 'table'
          ? props.tables.map((item) => item.externalId)
          : [],
    },
    resolver: zodResolver(
      props.type === 'flow'
        ? PushFlowsGitRepoRequest
        : PushTablesGitRepoRequest,
    ) as Resolver<PushGitRepoRequest>,
  });

  const invalidateLatest = () => {
    void queryClient.invalidateQueries({
      queryKey: ['git-push-operation', 'latest', projectId],
    });
  };

  const { mutate: startPush, isPending: isStarting } =
    gitSyncMutations.useStartPush({
      onSuccess: () => {
        setInlineError(null);
        invalidateLatest();
      },
      onError: (error) => {
        setInlineError(gitPushErrorUtils.classifyStartError(error));
      },
    });

  const { mutate: retryPush, isPending: isRetrying } =
    gitSyncMutations.useRetryPush({
      onSuccess: () => {
        setInlineError(null);
        invalidateLatest();
      },
    });

  const isPushInProgress =
    latestOperation?.status === GitPushOperationStatus.IN_PROGRESS;

  const handleSubmit = (request: PushGitRepoRequest) => {
    assertNotNullOrUndefined(gitSync, 'gitSync');
    setInlineError(null);
    startPush({
      gitSyncId: gitSync.id,
      request: {
        ...request,
        ...(props.type === 'flow'
          ? {
              type: GitPushOperationType.PUSH_FLOW,
              externalFlowIds: props.flows.map((item) => item.externalId),
            }
          : {
              type: GitPushOperationType.PUSH_TABLE,
              externalTableIds: props.tables.map((item) => item.externalId),
            }),
      },
    });
  };

  if (!showPushToGit) {
    return null;
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          form.reset();
          setInlineError(null);
        }
      }}
    >
      <DialogTrigger asChild>{props.children}</DialogTrigger>
      <DialogContent>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(handleSubmit)}
            className="flex flex-col gap-4"
          >
            <DialogHeader>
              <DialogTitle>{t('Push to Git')}</DialogTitle>
            </DialogHeader>

            {gitSync && (
              <>
                <GitPushStatusPanel
                  operation={latestOperation}
                  repo={gitSync}
                  onRetry={() =>
                    latestOperation && retryPush(latestOperation.id)
                  }
                  isRetrying={isRetrying}
                />
                <FormField
                  control={form.control}
                  name="commitMessage"
                  render={({ field }) => (
                    <FormItem className="gap-2 flex flex-col">
                      <FormLabel>{t('Commit Message')}</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          disabled={isPushInProgress || isStarting}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <div className="text-sm text-gray-500">
                  {t(
                    'Enter a commit message to describe the changes you want to push.',
                  )}
                </div>
                {inlineError && (
                  <Alert variant="destructive">
                    <AlertTriangle className="size-4" />
                    <AlertTitle>{t('Push could not start')}</AlertTitle>
                    <AlertDescription>{inlineError}</AlertDescription>
                  </Alert>
                )}
              </>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setOpen(false);
                  form.reset();
                  setInlineError(null);
                }}
              >
                {t('Close')}
              </Button>
              {gitSync && (
                <Button
                  type="submit"
                  loading={isStarting || isPushInProgress}
                  disabled={isPushInProgress}
                >
                  {isPushInProgress ? t('Pushing…') : t('Push')}
                </Button>
              )}
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

PushToGitDialog.displayName = 'PushToGitDialog';
export { PushToGitDialog };
