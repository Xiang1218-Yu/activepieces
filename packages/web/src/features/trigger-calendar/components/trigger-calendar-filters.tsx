import {
  TriggerCalendarResponse,
  UncategorizedFolderId,
} from '@activepieces/shared';
import { t } from 'i18next';
import { Clock } from 'lucide-react';
import { useMemo } from 'react';

import { Badge } from '@/components/ui/badge';
import { MultiSelectFilter } from '@/features/automations/components/multi-select-filter';

type CalendarFiltersProps = {
  calendar: TriggerCalendarResponse | undefined;
  selectedFlowIds: string[];
  selectedFolderIds: string[];
  selectedTimezones: string[];
  onFlowIdsChange: (values: string[]) => void;
  onFolderIdsChange: (values: string[]) => void;
  onTimezonesChange: (values: string[]) => void;
};

export function TriggerCalendarFilters({
  calendar,
  selectedFlowIds,
  selectedFolderIds,
  selectedTimezones,
  onFlowIdsChange,
  onFolderIdsChange,
  onTimezonesChange,
}: CalendarFiltersProps) {
  const flowOptions = useMemo(() => {
    const flows = new Map<string, string>();
    for (const issue of calendar?.issues ?? []) {
      flows.set(issue.flowId, issue.flowName);
    }
    for (const trigger of [
      ...(calendar?.scheduled ?? []),
      ...(calendar?.nonScheduled ?? []),
    ]) {
      flows.set(trigger.flowId, trigger.flowName);
    }
    return [...flows.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [calendar]);

  const folderOptions = useMemo(() => {
    const folders = new Map<string, string>();
    let hasUncategorized = false;
    for (const trigger of [
      ...(calendar?.scheduled ?? []),
      ...(calendar?.nonScheduled ?? []),
    ]) {
      if (trigger.folderId && trigger.folderName) {
        folders.set(trigger.folderId, trigger.folderName);
      } else if (!trigger.folderId) {
        hasUncategorized = true;
      }
    }
    const options = [...folders.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
    if (hasUncategorized) {
      options.push({
        value: UncategorizedFolderId,
        label: t('Uncategorized'),
      });
    }
    return options;
  }, [calendar]);

  const timezoneOptions = useMemo(() => {
    const timezones = new Set<string>();
    for (const trigger of calendar?.scheduled ?? []) {
      if (trigger.timezone) {
        timezones.add(trigger.timezone);
      }
    }
    return [...timezones]
      .map((value) => ({ value, label: value }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [calendar]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <MultiSelectFilter
        label={t('Flow')}
        icon={<Clock className="size-3.5" />}
        options={flowOptions}
        selectedValues={selectedFlowIds}
        onChange={onFlowIdsChange}
        searchable
      />
      <MultiSelectFilter
        label={t('Folder')}
        icon={<Clock className="size-3.5" />}
        options={folderOptions}
        selectedValues={selectedFolderIds}
        onChange={onFolderIdsChange}
        searchable
      />
      <MultiSelectFilter
        label={t('Timezone')}
        icon={<Clock className="size-3.5" />}
        options={timezoneOptions}
        selectedValues={selectedTimezones}
        onChange={onTimezonesChange}
        searchable
      />
      <Badge variant="outline" className="text-xs font-normal">
        {t('{{count}} upcoming', { count: calendar?.occurrences.length ?? 0 })}
      </Badge>
    </div>
  );
}
