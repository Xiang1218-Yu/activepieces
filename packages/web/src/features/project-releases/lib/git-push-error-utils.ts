import { ErrorCode } from '@activepieces/core-utils';
import { t } from 'i18next';

import { api } from '@/lib/api';

export const gitPushErrorUtils = {
  classifyStartError(error: unknown): string {
    const code = extractErrorCode(error);
    switch (code) {
      case ErrorCode.GIT_PUSH_IN_PROGRESS:
        return t(
          'Another push is already running. Wait for it to finish before starting a new one.',
        );
      case ErrorCode.INVALID_GIT_CREDENTIALS:
        return t(
          'Authentication failed: the remote repository rejected the configured SSH key. Reconnect the Git repository and try again.',
        );
      case ErrorCode.GIT_PUSH_CONFLICT:
        return t(
          'The remote branch has diverged. Pull the latest commits or resolve the conflict on the remote, then retry.',
        );
      case ErrorCode.GIT_REPO_NOT_CONFIGURED:
      case ErrorCode.ENTITY_NOT_FOUND:
        return t(
          'Git connection is missing for this project. Reconnect the repository and try again.',
        );
      default:
        return api.extractServerErrorMessage(
          error,
          t('Could not start the push. Please try again.'),
        );
    }
  },
};

function extractErrorCode(error: unknown): string | undefined {
  if (api.isError(error)) {
    const data = error.response?.data as { code?: string } | undefined;
    return data?.code;
  }
  return undefined;
}
