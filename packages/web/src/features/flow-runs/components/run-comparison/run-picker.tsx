import { FlowRun, FlowRunStatus } from '@activepieces/shared';
import { t } from 'i18next';
import { Check, ChevronDown, History, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useDebounce } from 'use-debounce';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { flowRunUtils } from '@/features/flow-runs/utils/flow-run-utils';
import { authenticationSession } from '@/lib/authentication-session';
import { formatUtils } from '@/lib/format-utils';

import { useRunsForPicker } from '../hooks/use-runs-for-picker';

const MAX_SELECTABLE = 10;

type RunPickerProps = {
  selectedRunIds: string[];
  flowId: string[];
  tags: string[];
  createdAfter: string;
  createdBefore: string;
  onChange: (runIds: string[]) => void;
};

function RunPicker({
  selectedRunIds,
  flowId,
  tags,
  createdAfter,
  createdBefore,
  onChange,
}: RunPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch] = useDebounce(search, 300);
  const projectId = authenticationSession.getProjectId()!;

  const {
    data,
    isLoading,
    isError,
    isFetchingNextPage,
    refetch,
    fetchNextPage,
    hasNextPage,
  } = useRunsForPicker({
    projectId,
    flowId,
    tags,
    createdAfter,
    createdBefore,
    failedStepMessage: debouncedSearch || undefined,
  });

  const runs = useMemo(
    () => data?.pages.flatMap((page) => page.data) ?? [],
    [data],
  );
  const selectedIdSet = useMemo(
    () => new Set(selectedRunIds),
    [selectedRunIds],
  );

  const toggleRun = (run: FlowRun) => {
    if (selectedIdSet.has(run.id)) {
      onChange(selectedRunIds.filter((id) => id !== run.id));
      return;
    }
    if (selectedRunIds.length >= MAX_SELECTABLE) {
      return;
    }
    onChange([...selectedRunIds, run.id]);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="gap-2">
          <History className="size-4" />
          {t('Select runs')}
          {selectedRunIds.length > 0 && (
            <span className="ml-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium">
              {selectedRunIds.length}/{MAX_SELECTABLE}
            </span>
          )}
          <ChevronDown className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[420px] p-0">
        <Command shouldFilter={false}>
          <div className="flex items-center border-b px-3">
            <Search className="size-4 shrink-0 opacity-50" />
            <CommandInput
              placeholder={t('Search by error message')}
              value={search}
              onValueChange={setSearch}
              className="border-0 focus:ring-0"
            />
          </div>
          <CommandList>
            {isLoading ? (
              <div className="p-4 text-sm text-muted-foreground">
                {t('Loading…')}
              </div>
            ) : isError ? (
              <div className="flex flex-col items-center gap-2 p-4 text-sm text-muted-foreground">
                <span>{t('Trouble loading runs')}</span>
                <Button variant="link" onClick={() => refetch()}>
                  {t('Retry')}
                </Button>
              </div>
            ) : runs.length === 0 ? (
              <CommandEmpty>{t('No flow runs found')}</CommandEmpty>
            ) : (
              <ScrollArea className="max-h-72">
                <CommandGroup>
                  {runs.map((run) => {
                    const checked = selectedIdSet.has(run.id);
                    const disabled =
                      !checked && selectedRunIds.length >= MAX_SELECTABLE;
                    const { Icon } = flowRunUtils.getStatusIcon(run.status);
                    return (
                      <CommandItem
                        key={run.id}
                        disabled={disabled}
                        onSelect={() => toggleRun(run)}
                        className="flex items-start gap-2 py-2"
                      >
                        <div
                          className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm border ${
                            checked
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-input'
                          }`}
                        >
                          {checked && <Check className="size-3" />}
                        </div>
                        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <span className="truncate text-sm font-medium">
                            {run.flowVersion?.displayName ??
                              t('Flow') + ' ' + run.flowId.slice(0, 8)}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatUtils.formatDateWithTime(
                              new Date(run.created),
                              false,
                            )}{' '}
                            · {labelForStatus(run.status)}
                            {run.failedStep?.message
                              ? ` · ${run.failedStep.message.slice(0, 80)}`
                              : ''}
                          </span>
                        </div>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
                {hasNextPage && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full"
                    loading={isFetchingNextPage}
                    onClick={() => fetchNextPage()}
                  >
                    {t('Load more')}
                  </Button>
                )}
              </ScrollArea>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function labelForStatus(status: FlowRunStatus): string {
  return (
    flowRunUtils.getStatusLabelOverride(status) ??
    formatUtils.convertEnumToHumanReadable(status)
  );
}

export { RunPicker, MAX_SELECTABLE as MAX_COMPARE_RUNS };
