import { endOfDay, format, startOfDay, subDays } from 'date-fns';
import { t } from 'i18next';
import { CalendarClock } from 'lucide-react';
import { useState } from 'react';
import type { DateRange } from 'react-day-picker';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

type RunTimeRangeFilterProps = {
  runAfter: string | null;
  runBefore: string | null;
  onChange: (range: { runAfter: string | null; runBefore: string | null }) => void;
};

type Preset = {
  value: string;
  label: string;
  getRange: () => { from: Date; to: Date };
};

const PRESETS: Preset[] = [
  {
    value: 'yesterday',
    label: 'Yesterday',
    getRange: () => {
      const yesterday = subDays(new Date(), 1);
      return { from: startOfDay(yesterday), to: endOfDay(yesterday) };
    },
  },
  {
    value: 'last-7-days',
    label: 'Last 7 days',
    getRange: () => ({ from: startOfDay(subDays(new Date(), 6)), to: endOfDay(new Date()) }),
  },
  {
    value: 'last-14-days',
    label: 'Last 14 days',
    getRange: () => ({ from: startOfDay(subDays(new Date(), 13)), to: endOfDay(new Date()) }),
  },
  {
    value: 'last-30-days',
    label: 'Last 30 days',
    getRange: () => ({ from: startOfDay(subDays(new Date(), 29)), to: endOfDay(new Date()) }),
  },
];

export function RunTimeRangeFilter({
  runAfter,
  runBefore,
  onChange,
}: RunTimeRangeFilterProps) {
  const [open, setOpen] = useState(false);

  const from = runAfter ? new Date(runAfter) : undefined;
  const to = runBefore ? new Date(runBefore) : undefined;
  const calendarRange: DateRange | undefined =
    from || to ? { from, to } : undefined;
  const activePreset = matchPreset(runAfter, runBefore);

  const handleSelect = (range: DateRange | undefined) => {
    if (!range?.from) {
      onChange({ runAfter: null, runBefore: null });
      return;
    }
    onChange({
      runAfter: startOfDay(range.from).toISOString(),
      runBefore: range.to
        ? endOfDay(range.to).toISOString()
        : endOfDay(range.from).toISOString(),
    });
  };

  const handlePreset = (preset: Preset) => {
    const { from: presetFrom, to: presetTo } = preset.getRange();
    onChange({
      runAfter: presetFrom.toISOString(),
      runBefore: presetTo.toISOString(),
    });
  };

  const label = describeRange(runAfter, runBefore);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="text-sm gap-2 whitespace-nowrap border-dashed"
        >
          <CalendarClock className="h-4 w-4" />
          <span>{t('Run time')}</span>
          {label && (
            <div className="flex items-center gap-1 ml-1">
              <div className="h-4 w-px bg-border" />
              <Badge
                variant="outline"
                className="px-1.5 py-0 text-xs font-normal rounded-sm bg-muted"
              >
                {label}
              </Badge>
            </div>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex">
          <ScrollArea className="max-h-[300px] w-40 border-r">
            <div className="p-2 space-y-1">
              {PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => handlePreset(preset)}
                  className={cn(
                    'w-full text-left px-2 py-1.5 rounded-sm text-sm hover:bg-accent',
                    activePreset === preset.value && 'bg-accent',
                  )}
                >
                  {t(preset.label)}
                </button>
              ))}
            </div>
          </ScrollArea>
          <Calendar
            mode="range"
            selected={calendarRange}
            onSelect={handleSelect}
            numberOfMonths={1}
            initialFocus
          />
        </div>
        {(runAfter || runBefore) && (
          <div className="border-t p-2 flex justify-between items-center gap-2">
            <span className="text-xs text-muted-foreground px-1">{label}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onChange({ runAfter: null, runBefore: null })}
            >
              {t('Clear all')}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function matchPreset(runAfter: string | null, runBefore: string | null): string | null {
  if (!runAfter || !runBefore) {
    return null;
  }
  const afterTime = new Date(runAfter).getTime();
  const beforeTime = new Date(runBefore).getTime();
  for (const preset of PRESETS) {
    const { from, to } = preset.getRange();
    if (
      Math.abs(afterTime - from.getTime()) < PRESET_MATCH_TOLERANCE_MS &&
      Math.abs(beforeTime - to.getTime()) < PRESET_MATCH_TOLERANCE_MS
    ) {
      return preset.value;
    }
  }
  return null;
}

function describeRange(runAfter: string | null, runBefore: string | null) {
  if (!runAfter && !runBefore) {
    return null;
  }
  if (runAfter && runBefore) {
    return `${format(new Date(runAfter), DATE_FORMAT)} – ${format(new Date(runBefore), DATE_FORMAT)}`;
  }
  if (runAfter) {
    return `${t('After')} ${format(new Date(runAfter), DATE_FORMAT)}`;
  }
  return `${t('Before')} ${format(new Date(runBefore ?? ''), DATE_FORMAT)}`;
}

const DATE_FORMAT = 'MMM d, yyyy';
const PRESET_MATCH_TOLERANCE_MS = 60_000;
