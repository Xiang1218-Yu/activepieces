import {
  GitPushFailureReason,
  GitPushOperation,
  GitPushOperationStatus,
  GitPushOperationType,
  GitRepo,
} from '@activepieces/shared';
import { t } from 'i18next';
import {
  AlertTriangle,
  CheckCircle2,
  GitBranch,
  GitPullRequestArrow,
  Loader2,
  Package,
  RefreshCw,
} from 'lucide-react';

import { FormattedDate } from '@/components/custom/formatted-date';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

type GitPushStatusPanelProps = {
  operation: GitPushOperation | null | undefined;
  repo: GitRepo;
  onRetry: () => void;
  isRetrying?: boolean;
};

export function GitPushStatusPanel({
  operation,
  repo,
  onRetry,
  isRetrying,
}: GitPushStatusPanelProps) {
  if (!operation) {
    return (
      <div className="rounded-lg border bg-muted/40 p-3 text-sm space-y-1.5">
        <RepoTargetRow repo={repo} />
        <ReleaseContextRow releaseName={null} />
        <p className="text-muted-foreground">
          {t('No push has been performed in this project yet.')}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="rounded-lg border bg-muted/40 p-3 text-sm space-y-1.5">
        <RepoTargetRow repo={repo} />
        <ReleaseContextRow releaseName={operation.releaseName ?? null} />
        <LastOperationRow operation={operation} />
      </div>
      {operation.status === GitPushOperationStatus.IN_PROGRESS && (
        <Alert variant="primary">
          <Loader2 className="size-4 animate-spin" />
          <AlertTitle>{t('Pushing…')}</AlertTitle>
          <AlertDescription>
            {t(
              'Pushing to {{branch}} — the remote branch will update once the push completes.',
              {
                branch: repo.branch,
              },
            )}
          </AlertDescription>
        </Alert>
      )}
      {operation.status === GitPushOperationStatus.SUCCEEDED && (
        <Alert variant="success">
          <CheckCircle2 className="size-4" />
          <AlertTitle>{t('Target branch updated')}</AlertTitle>
          <AlertDescription>
            {t('Pushed to {{remoteUrl}} ({{branch}})', {
              remoteUrl: repo.remoteUrl,
              branch: repo.branch,
            })}
          </AlertDescription>
        </Alert>
      )}
      {operation.status === GitPushOperationStatus.FAILED && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>{failureTitle(operation.failureReason)}</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{failureDescription(operation.failureReason)}</p>
            {operation.errorMessage && (
              <pre className="whitespace-pre-wrap break-words rounded bg-muted p-2 text-xs font-mono text-muted-foreground max-h-32 overflow-y-auto">
                {operation.errorMessage}
              </pre>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              loading={isRetrying}
              onClick={onRetry}
            >
              {!isRetrying && <RefreshCw className="size-3.5 mr-1" />}
              {t('Retry Push')}
            </Button>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function RepoTargetRow({ repo }: { repo: GitRepo }) {
  return (
    <div className="flex items-start gap-2">
      <GitBranch className="size-4 mt-0.5 text-muted-foreground shrink-0" />
      <div className="min-w-0">
        <div className="font-medium truncate" title={repo.remoteUrl}>
          {repo.remoteUrl}
        </div>
        <div className="text-muted-foreground text-xs">
          {t('Branch')}: <span className="font-mono">{repo.branch}</span>
        </div>
      </div>
    </div>
  );
}

function ReleaseContextRow({ releaseName }: { releaseName: string | null }) {
  return (
    <div className="flex items-start gap-2">
      <Package className="size-4 mt-0.5 text-muted-foreground shrink-0" />
      <div className="min-w-0">
        <div className="text-muted-foreground text-xs">
          {t('Current release')}
        </div>
        {releaseName ? (
          <div className="font-medium truncate" title={releaseName}>
            {releaseName}
          </div>
        ) : (
          <div className="text-muted-foreground text-xs italic">
            {t('No release created yet')}
          </div>
        )}
      </div>
    </div>
  );
}

function LastOperationRow({ operation }: { operation: GitPushOperation }) {
  const finishedAt = operation.finishedAt
    ? new Date(operation.finishedAt)
    : new Date(operation.startedAt);
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <GitPullRequestArrow className="size-3.5 shrink-0" />
      <span className="truncate">
        {operationTypeLabel(operation.operationType)}
      </span>
      <span>·</span>
      <FormattedDate date={finishedAt} includeTime />
    </div>
  );
}

function operationTypeLabel(type: GitPushOperationType): string {
  switch (type) {
    case GitPushOperationType.PUSH_EVERYTHING:
      return t('Push everything');
    case GitPushOperationType.PUSH_FLOW:
      return t('Push flow');
    case GitPushOperationType.DELETE_FLOW:
      return t('Delete flow');
    case GitPushOperationType.PUSH_TABLE:
      return t('Push table');
    case GitPushOperationType.DELETE_TABLE:
      return t('Delete table');
  }
}

function failureTitle(reason: GitPushFailureReason | null | undefined): string {
  switch (reason) {
    case GitPushFailureReason.AUTHENTICATION_FAILED:
      return t('Authentication failed');
    case GitPushFailureReason.CONFLICT:
      return t('Remote rejected — branches diverged');
    case GitPushFailureReason.NOT_CONFIGURED:
      return t('Git connection missing');
    case GitPushFailureReason.REMOTE_REJECTED:
      return t('Remote rejected the push');
    default:
      return t('Push failed');
  }
}

function failureDescription(
  reason: GitPushFailureReason | null | undefined,
): string {
  switch (reason) {
    case GitPushFailureReason.AUTHENTICATION_FAILED:
      return t(
        'The remote repository rejected the SSH credentials. Reconnect the Git repository with a valid private key and try again.',
      );
    case GitPushFailureReason.CONFLICT:
      return t(
        'The target branch contains commits that are not in this project. Pull or resolve the diverging commits on the remote, then retry.',
      );
    case GitPushFailureReason.NOT_CONFIGURED:
      return t(
        'This project no longer has a Git connection configured. Connect a repository before pushing.',
      );
    case GitPushFailureReason.REMOTE_REJECTED:
      return t(
        'The remote repository refused the push. Review the server error below for details.',
      );
    default:
      return t(
        'The push could not be completed. Review the server error below and retry.',
      );
  }
}
