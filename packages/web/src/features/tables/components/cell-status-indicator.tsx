import { t } from 'i18next';
import {
  AlertCircle,
  Check,
  CircleDashed,
  Loader2,
  TriangleAlert,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

import {
  TableCellErrorCode,
  TableCellState,
} from '../stores/store/ap-tables-client-state';

import { useTableState } from './ap-table-state-provider';

const cellErrorMessage = (error: TableCellErrorCode): string => {
  switch (error) {
    case 'INVALID_NUMBER':
      return t('Must be a valid number');
    case 'INVALID_DATE':
      return t('Must be a valid date');
    case 'INVALID_DROPDOWN_OPTION':
      return t('Must be one of the dropdown options');
    case 'UNKNOWN_FIELD':
      return t('This field no longer exists');
    case 'RECORD_NOT_FOUND':
      return t('This record was deleted by someone else');
    case 'BATCH_FAILED':
      return t('Could not save this change. Try saving again.');
  }
};

const ConflictResolutionPopover = ({
  recordUuid,
  fieldUuid,
  serverValue,
}: {
  recordUuid: string;
  fieldUuid: string;
  serverValue: string;
}) => {
  const resolveConflict = useTableState((state) => state.resolveConflict);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="shrink-0 text-orange-500 hover:text-orange-600"
          onClick={(event) => event.stopPropagation()}
        >
          <TriangleAlert className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-72"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="space-y-3">
          <div className="text-sm font-medium">
            {t('Another user changed this cell')}
          </div>
          <div className="text-sm text-muted-foreground">
            {t('Server value: {value}', {
              value: serverValue === '' ? t('(empty)') : serverValue,
            })}
          </div>
          <div className="flex gap-2 justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                resolveConflict({
                  recordUuid,
                  fieldUuid,
                  strategy: 'useServer',
                })
              }
            >
              {t('Use server value')}
            </Button>
            <Button
              size="sm"
              onClick={() =>
                resolveConflict({ recordUuid, fieldUuid, strategy: 'keepMine' })
              }
            >
              {t('Keep mine')}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export function CellStatusIndicator({
  cellState,
  recordUuid,
  fieldUuid,
}: {
  cellState: TableCellState | undefined;
  recordUuid: string;
  fieldUuid: string;
}) {
  if (!cellState) {
    return null;
  }
  switch (cellState.status) {
    case 'dirty':
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="shrink-0 text-amber-500">
              <CircleDashed className="size-4" />
            </span>
          </TooltipTrigger>
          <TooltipContent>{t('Unsaved change')}</TooltipContent>
        </Tooltip>
      );
    case 'saving':
      return (
        <span className="shrink-0 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
        </span>
      );
    case 'saved':
      return (
        <span className="shrink-0 text-green-600">
          <Check className="size-4" />
        </span>
      );
    case 'error':
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="shrink-0 text-destructive">
              <AlertCircle className="size-4" />
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {cellErrorMessage(cellState.error ?? 'BATCH_FAILED')}
          </TooltipContent>
        </Tooltip>
      );
    case 'conflict':
      return (
        <ConflictResolutionPopover
          recordUuid={recordUuid}
          fieldUuid={fieldUuid}
          serverValue={cellState.serverValue ?? ''}
        />
      );
  }
}
