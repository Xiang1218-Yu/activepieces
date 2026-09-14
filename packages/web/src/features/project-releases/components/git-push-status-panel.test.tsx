import {
  GitPushFailureReason,
  GitPushOperation,
  GitPushOperationStatus,
  GitPushOperationType,
  GitRepo,
} from '@activepieces/shared';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('i18next', () => ({
  t: (key: string, options?: Record<string, string>) => {
    if (!options) {
      return key;
    }
    return key.replaceAll(
      /\{\{(\w+)\}\}/g,
      (_match, name: string) => options[name] ?? '',
    );
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) => {
      if (!options) {
        return key;
      }
      return key.replaceAll(
        /\{\{(\w+)\}\}/g,
        (_match, name: string) => options[name] ?? '',
      );
    },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));

vi.mock('@/components/custom/formatted-date', () => ({
  FormattedDate: () => <span>formatted-date</span>,
}));

import { GitPushStatusPanel } from '../components/git-push-status-panel';

const repo: GitRepo = {
  id: 'repo-1',
  created: '2026-09-14T00:00:00.000Z',
  updated: '2026-09-14T00:00:00.000Z',
  remoteUrl: 'git@github.com:activepieces/activepieces.git',
  branch: 'main',
  branchType: 'DEVELOPMENT' as GitRepo['branchType'],
  projectId: 'project-1',
  sshPrivateKey: null,
  slug: 'activepieces',
};

function buildOperation(
  overrides: Partial<GitPushOperation>,
): GitPushOperation {
  return {
    id: 'op-1',
    created: '2026-09-14T00:00:00.000Z',
    updated: '2026-09-14T00:00:00.000Z',
    projectId: 'project-1',
    gitRepoId: 'repo-1',
    status: GitPushOperationStatus.IN_PROGRESS,
    operationType: GitPushOperationType.PUSH_TABLE,
    request: {
      type: GitPushOperationType.PUSH_TABLE,
      commitMessage: 'chore: push table',
      externalTableIds: ['table-1'],
    },
    commitMessage: 'chore: push table',
    releaseId: 'release-1',
    releaseName: 'Release 42',
    triggeredBy: 'user-1',
    failureReason: null,
    errorMessage: null,
    startedAt: '2026-09-14T00:00:00.000Z',
    finishedAt: null,
    ...overrides,
  };
}

function panelMarkup(operation: GitPushOperation | null): string {
  return renderToStaticMarkup(
    <GitPushStatusPanel
      operation={operation}
      repo={repo}
      onRetry={() => undefined}
    />,
  );
}

describe('GitPushStatusPanel', () => {
  it('renders the pushing state with remote, branch and current release', () => {
    const view = panelMarkup(
      buildOperation({ status: GitPushOperationStatus.IN_PROGRESS }),
    );
    expect(view).toContain('Pushing…');
    expect(view).toContain(repo.remoteUrl);
    expect(view).toContain('main');
    expect(view).toContain('Release 42');
    expect(view).not.toContain('Retry Push');
  });

  it('renders the succeeded state when the target branch is updated', () => {
    const view = panelMarkup(
      buildOperation({
        status: GitPushOperationStatus.SUCCEEDED,
        finishedAt: '2026-09-14T00:01:00.000Z',
      }),
    );
    expect(view).toContain('Target branch updated');
    expect(view).toContain(repo.remoteUrl);
    expect(view).toContain('(main)');
    expect(view).not.toContain('Retry Push');
  });

  it('renders the failure state for a conflict with the server error and a retry action', () => {
    const view = panelMarkup(
      buildOperation({
        status: GitPushOperationStatus.FAILED,
        failureReason: GitPushFailureReason.CONFLICT,
        errorMessage: '! [rejected] main -> main (non-fast-forward)',
        finishedAt: '2026-09-14T00:01:00.000Z',
      }),
    );
    expect(view).toContain('Remote rejected — branches diverged');
    expect(view).toContain('non-fast-forward');
    expect(view).toContain('Retry Push');
  });

  it('renders a distinct message for authentication failures', () => {
    const view = panelMarkup(
      buildOperation({
        status: GitPushOperationStatus.FAILED,
        failureReason: GitPushFailureReason.AUTHENTICATION_FAILED,
        errorMessage: 'Permission denied (publickey)',
        finishedAt: '2026-09-14T00:01:00.000Z',
      }),
    );
    expect(view).toContain('Authentication failed');
    expect(view).toContain('Permission denied (publickey)');
  });

  it('renders the empty state with remote target before any push happened', () => {
    const view = panelMarkup(null);
    expect(view).toContain(repo.remoteUrl);
    expect(view).toContain('No push has been performed in this project yet.');
    expect(view).toContain('No release created yet');
  });
});
