/**
 * @vitest-environment jsdom
 *
 * Pins the query-key contract of variablesQueries.useVariables: the full
 * request object is part of the query key, so a slow response for an old
 * filter/pagination state resolves into its own cache entry and can never
 * overwrite the data of the query the user is currently looking at.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { variablesQueries } from '@/features/variables/hooks/variables-hooks';

vi.mock('i18next', () => ({ t: (key: string) => key }));

vi.mock('sonner', () => ({ toast: { success: vi.fn() } }));

vi.mock('@/components/ui/sonner', () => ({ internalErrorToast: vi.fn() }));

vi.mock('@/components/custom/data-table', () => ({
  CURSOR_QUERY_PARAM: 'cursor',
  LIMIT_QUERY_PARAM: 'limit',
}));

const listMock = vi.hoisted(() => vi.fn());

vi.mock('@/features/variables/api/variables', () => ({
  variablesApi: { list: listMock },
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const flushQueryNotifications = () =>
  act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  });

function makePage(name: string) {
  return {
    data: [
      {
        id: `id-${name}`,
        created: '2026-09-01T00:00:00.000Z',
        updated: '2026-09-01T00:00:00.000Z',
        name,
        type: 'SECRET',
        projectId: 'p1',
        platformId: 'platform1',
        ownerId: null,
        owner: null,
        metadata: null,
        usedInFlows: false,
      },
    ],
    next: null,
    previous: null,
  };
}

let container: HTMLDivElement | undefined;
let root: Root | undefined;

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  listMock.mockReset();
});

describe('useVariables', () => {
  it('does not let a stale response overwrite a newer query', async () => {
    const pageA = makePage('alpha');
    const pageB = makePage('beta');
    const requestA = deferred<typeof pageA>();
    const requestB = deferred<typeof pageB>();
    listMock.mockImplementation(
      (request: { name?: string }): Promise<typeof pageA> =>
        request.name === 'alpha' ? requestA.promise : requestB.promise,
    );

    const observed: { data?: typeof pageA } = {};
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    function Probe({ name }: { name: string }) {
      const result = variablesQueries.useVariables({
        request: { projectId: 'p1', name },
      });
      observed.data = result.data as typeof pageA | undefined;
      return null;
    }

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <Probe name="alpha" />
        </QueryClientProvider>,
      );
    });
    expect(listMock).toHaveBeenCalledTimes(1);

    act(() => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <Probe name="beta" />
        </QueryClientProvider>,
      );
    });
    expect(listMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      requestB.resolve(pageB);
    });
    await flushQueryNotifications();
    expect(observed.data).toEqual(pageB);

    await act(async () => {
      requestA.resolve(pageA);
    });
    await flushQueryNotifications();
    expect(observed.data).toEqual(pageB);
  });
});

describe('useListSearchParams', () => {
  it('parses every variables filter from the URL', () => {
    const captured: {
      params?: ReturnType<typeof variablesQueries.useListSearchParams>;
    } = {};

    function Probe() {
      captured.params = variablesQueries.useListSearchParams();
      return null;
    }

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <MemoryRouter
          initialEntries={[
            '/variables?cursor=c1&limit=30&name=foo&type=SECRET&type=TEXT&type=BOGUS' +
              '&usedInFlows=true&usedInFlows=bogus&updatedAfter=2026-01-01T00:00:00.000Z' +
              '&updatedBefore=2026-02-01T00:00:00.000Z&owner=a%40b.c',
          ]}
        >
          <Probe />
        </MemoryRouter>,
      );
    });

    expect(captured.params).toEqual({
      cursor: 'c1',
      limit: 30,
      name: 'foo',
      types: ['SECRET', 'TEXT'],
      updatedAfter: '2026-01-01T00:00:00.000Z',
      updatedBefore: '2026-02-01T00:00:00.000Z',
      usedInFlows: ['true'],
      ownerEmails: ['a@b.c'],
    });
  });
});
