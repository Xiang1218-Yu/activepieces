import { GitPushOperation, GitPushOperationStatus } from '@activepieces/shared';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { platformHooks } from '@/hooks/platform-hooks';
import { authenticationSession } from '@/lib/authentication-session';

import { gitSyncHooks } from '../hooks/git-sync-hooks';

export function GitPushOperationWatcher() {
  const projectId = authenticationSession.getProjectId();
  const { platform } = platformHooks.useCurrentPlatform();
  const enabled = platform.plan.environmentsEnabled;
  const { data: operation } = gitSyncHooks.useLatestPushOperation(
    projectId ?? '',
    enabled && !!projectId,
  );

  return <PushOperationToast operation={operation} />;
}

function PushOperationToast({
  operation,
}: {
  operation: GitPushOperation | null | undefined;
}) {
  const { t } = useTranslation();
  const notifiedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!operation) {
      return;
    }
    if (operation.status === GitPushOperationStatus.IN_PROGRESS) {
      notifiedRef.current = operation.id;
      return;
    }
    if (notifiedRef.current !== operation.id) {
      return;
    }
    notifiedRef.current = null;
    if (operation.status === GitPushOperationStatus.SUCCEEDED) {
      toast.success(t('Pushed successfully'), { duration: 3000 });
    } else {
      toast.error(t('Push failed'), {
        description: operation.errorMessage ?? undefined,
        duration: 6000,
      });
    }
  }, [operation, t]);

  return null;
}
