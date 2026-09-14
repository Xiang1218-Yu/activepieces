import { assertNotNullOrUndefined } from '@activepieces/core-utils';
import {
  GitBranchType,
  GitPushOperationStatus,
  GitPushOperationType,
  PushEverythingGitRepoRequest,
} from '@activepieces/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { t } from 'i18next';
import { AlertTriangle, Info } from 'lucide-react';
import React from 'react';
import { useForm } from 'react-hook-form';

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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { gitSyncHooks, gitSyncMutations } from '@/features/project-releases';
import { GitPushStatusPanel } from '@/features/project-releases/components/git-push-status-panel';
import { gitPushErrorUtils } from '@/features/project-releases/lib/git-push-error-utils';
import { platformHooks } from '@/hooks/platform-hooks';
import { authenticationSession } from '@/lib/authentication-session';

type PushEverythingDialogProps = {
  children?: React.ReactNode;
  releaseId?: string;
};

const PushEverythingDialog = (props: PushEverythingDialogProps) => {
  const [open, setOpen] = React.useState(false);
  const [inlineError, setInlineError] = React.useState<string | null>(null);

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

  const form = useForm<PushEverythingGitRepoRequest>({
    defaultValues: {
      type: GitPushOperationType.PUSH_EVERYTHING,
      commitMessage: '',
    },
    resolver: zodResolver(PushEverythingGitRepoRequest),
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
      onError: (error) =>
        setInlineError(gitPushErrorUtils.classifyStartError(error)),
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

  if (!gitSync || gitSync.branchType !== GitBranchType.DEVELOPMENT) {
    return null;
  }

  const handleSubmit = (request: PushEverythingGitRepoRequest) => {
    assertNotNullOrUndefined(gitSync, 'gitSync');
    setInlineError(null);
    startPush({
      gitSyncId: gitSync.id,
      request,
      releaseId: props.releaseId,
    });
  };

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
              <DialogTitle>{t('Push Everything to Git')}</DialogTitle>
            </DialogHeader>
            <GitPushStatusPanel
              operation={latestOperation}
              repo={gitSync}
              onRetry={() => latestOperation && retryPush(latestOperation.id)}
              isRetrying={isRetrying}
            />
            <FormField
              control={form.control}
              name="commitMessage"
              render={({ field }) => (
                <FormItem className="gap-2 flex flex-col">
                  <div className="flex items-center gap-2">
                    <FormLabel>{t('Commit Message')}</FormLabel>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="w-4 h-4 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        {t(
                          'Push all published flows, connections, and tables to the Git repository.',
                        )}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <FormControl>
                    <Textarea
                      {...field}
                      disabled={isPushInProgress || isStarting}
                    />
                  </FormControl>
                  <div className="text-sm text-gray-500">
                    {t(
                      'Enter a commit message to describe the changes you want to push.',
                    )}
                  </div>
                </FormItem>
              )}
            />
            {inlineError && (
              <Alert variant="destructive">
                <AlertTriangle className="size-4" />
                <AlertTitle>{t('Push could not start')}</AlertTitle>
                <AlertDescription>{inlineError}</AlertDescription>
              </Alert>
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
              <Button
                type="submit"
                loading={isStarting || isPushInProgress}
                disabled={isPushInProgress}
              >
                {isPushInProgress ? t('Pushing…') : t('Push')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

PushEverythingDialog.displayName = 'PushEverythingDialog';
export { PushEverythingDialog };
