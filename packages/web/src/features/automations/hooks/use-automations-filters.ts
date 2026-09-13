import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useDebouncedCallback } from 'use-debounce';

import { RecentRunStatus } from '@activepieces/shared';

import { AutomationsFilters, AutomationsSort } from '../lib/types';
import { hasActiveFilters } from '../lib/utils';

const SEARCH_PARAM = 'search';
const TYPE_PARAM = 'type';
const STATUS_PARAM = 'status';
const CONNECTION_PARAM = 'connection';
const OWNER_PARAM = 'owner';
const FOLDER_PARAM = 'folder';
const RECENT_RUN_STATUS_PARAM = 'lastRun';
const RUN_AFTER_PARAM = 'runAfter';
const RUN_BEFORE_PARAM = 'runBefore';
const SORT_PARAM = 'sort';

const FILTER_PARAMS = [
  SEARCH_PARAM,
  TYPE_PARAM,
  STATUS_PARAM,
  CONNECTION_PARAM,
  OWNER_PARAM,
  FOLDER_PARAM,
  RECENT_RUN_STATUS_PARAM,
  RUN_AFTER_PARAM,
  RUN_BEFORE_PARAM,
] as const;

const RECENT_RUN_STATUSES = new Set<string>(Object.values(RecentRunStatus));

function isRecentRunStatus(value: string): value is RecentRunStatus {
  return RECENT_RUN_STATUSES.has(value);
}

export function useAutomationsFilters() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [searchInput, setSearchInput] = useState(
    () => searchParams.get(SEARCH_PARAM) ?? '',
  );
  const [searchTerm, setSearchTerm] = useState(
    () => searchParams.get(SEARCH_PARAM) ?? '',
  );
  const [typeFilter, setTypeFilterState] = useState<string[]>(() =>
    searchParams.getAll(TYPE_PARAM),
  );
  const [statusFilter, setStatusFilterState] = useState<string[]>(() =>
    searchParams.getAll(STATUS_PARAM),
  );
  const [connectionFilter, setConnectionFilterState] = useState<string[]>(() =>
    searchParams.getAll(CONNECTION_PARAM),
  );
  const [ownerFilter, setOwnerFilterState] = useState<string[]>(() =>
    searchParams.getAll(OWNER_PARAM),
  );
  const folderParamStr = searchParams.getAll(FOLDER_PARAM).join('\0');
  const folderFilter = useMemo(
    () => searchParams.getAll(FOLDER_PARAM),
    [folderParamStr],
  );
  const recentRunStatusParamStr = searchParams
    .getAll(RECENT_RUN_STATUS_PARAM)
    .join('\0');
  const recentRunStatusFilter = useMemo(
    () =>
      recentRunStatusParamStr
        .split('\0')
        .filter(isRecentRunStatus),
    [recentRunStatusParamStr],
  );
  const runAfterParam = searchParams.get(RUN_AFTER_PARAM);
  const runBeforeParam = searchParams.get(RUN_BEFORE_PARAM);
  const runAfter = parseDateParam(runAfterParam);
  const runBefore = parseDateParam(runBeforeParam);
  const sort = parseSort(searchParams.get(SORT_PARAM));

  const updateParams = useCallback(
    (updates: Record<string, string | string[] | null>) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(updates)) {
            next.delete(key);
            if (value === null || value === '') continue;
            if (Array.isArray(value)) {
              value.forEach((v) => next.append(key, v));
            } else {
              next.set(key, value);
            }
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const debouncedSetSearch = useDebouncedCallback((value: string) => {
    setSearchTerm(value);
    updateParams({ [SEARCH_PARAM]: value || null });
  }, 300);

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchInput(value);
      debouncedSetSearch(value);
    },
    [debouncedSetSearch],
  );

  const setTypeFilter = useCallback(
    (value: string[]) => {
      setTypeFilterState(value);
      updateParams({ [TYPE_PARAM]: value.length > 0 ? value : null });
    },
    [updateParams],
  );

  const setStatusFilter = useCallback(
    (value: string[]) => {
      setStatusFilterState(value);
      updateParams({ [STATUS_PARAM]: value.length > 0 ? value : null });
    },
    [updateParams],
  );

  const setConnectionFilter = useCallback(
    (value: string[]) => {
      setConnectionFilterState(value);
      updateParams({ [CONNECTION_PARAM]: value.length > 0 ? value : null });
    },
    [updateParams],
  );

  const setOwnerFilter = useCallback(
    (value: string[]) => {
      setOwnerFilterState(value);
      updateParams({ [OWNER_PARAM]: value.length > 0 ? value : null });
    },
    [updateParams],
  );

  const setFolderFilter = useCallback(
    (value: string[]) => {
      updateParams({ [FOLDER_PARAM]: value.length > 0 ? value : null });
    },
    [updateParams],
  );

  const setRecentRunStatusFilter = useCallback(
    (value: RecentRunStatus[]) => {
      updateParams({
        [RECENT_RUN_STATUS_PARAM]: value.length > 0 ? value : null,
      });
    },
    [updateParams],
  );

  const setRunRange = useCallback(
    (range: { runAfter: string | null; runBefore: string | null }) => {
      updateParams({
        [RUN_AFTER_PARAM]: range.runAfter,
        [RUN_BEFORE_PARAM]: range.runBefore,
      });
    },
    [updateParams],
  );

  const setSort = useCallback(
    (value: AutomationsSort) => {
      updateParams({ [SORT_PARAM]: value === 'default' ? null : value });
    },
    [updateParams],
  );

  const filters: AutomationsFilters = {
    searchTerm,
    typeFilter,
    statusFilter,
    connectionFilter,
    ownerFilter,
    folderFilter,
    recentRunStatusFilter,
    runAfter,
    runBefore,
  };

  const filtersActive = hasActiveFilters(filters);

  const clearAllFilters = useCallback(() => {
    setSearchInput('');
    setSearchTerm('');
    setTypeFilterState([]);
    setStatusFilterState([]);
    setConnectionFilterState([]);
    setOwnerFilterState([]);
    updateParams(Object.fromEntries(FILTER_PARAMS.map((key) => [key, null])));
  }, [updateParams]);

  return {
    searchInput,
    handleSearchChange,
    typeFilter,
    setTypeFilter,
    statusFilter,
    setStatusFilter,
    connectionFilter,
    setConnectionFilter,
    ownerFilter,
    setOwnerFilter,
    folderFilter,
    setFolderFilter,
    recentRunStatusFilter,
    setRecentRunStatusFilter,
    runAfter,
    runBefore,
    setRunRange,
    sort,
    setSort,
    filters,
    filtersActive,
    clearAllFilters,
  };
}

function parseSort(value: string | null): AutomationsSort {
  switch (value) {
    case 'name-asc':
    case 'name-desc':
      return value;
    default:
      return 'default';
  }
}

function parseDateParam(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : value;
}
