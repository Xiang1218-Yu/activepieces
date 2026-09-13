import { FieldType, StaticDropdownEmptyOption } from '@activepieces/shared';
import { t } from 'i18next';
import { useRef } from 'react';

import { SearchableSelect } from '@/components/custom/searchable-select';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

import { useTableState } from './ap-table-state-provider';
import { useCellContext } from './cell-context';

const DropdownEditor = () => {
  const {
    value,
    handleCellChange,
    setIsEditing,
    isEditing,
    columnIdx,
    disabled,
  } = useCellContext();
  const field = useTableState((state) => state.fields[columnIdx]);
  const containerRef = useRef<HTMLDivElement>(null);
  const handleChange = (newValue: string | null) => {
    handleCellChange(newValue ?? '');
  };
  if (field?.type !== FieldType.STATIC_DROPDOWN) {
    console.log(field);
    console.error('DropdownEditor can only be used for STATIC_DROPDOWN fields');
    return null;
  }
  // Deactivated options can not be selected for new values. A cell that
  // already holds a deactivated (or removed) value keeps it and is shown
  // with a historical marker instead of being rewritten.
  const activeOptions = field.data.options.filter(
    (option) => option.disabled !== true,
  );
  const isHistoricalValue =
    value !== '' && !activeOptions.some((option) => option.value === value);
  return (
    <div
      className={cn('h-full w-full', {
        'border-primary  border-2': isEditing,
      })}
      ref={containerRef}
    >
      <SearchableSelect
        triggerClassName={cn('rounded-none px-2 border-none bg-transparent')}
        onClose={() => {
          setIsEditing(false);
        }}
        options={[
          StaticDropdownEmptyOption,
          ...activeOptions.map((option) => ({
            value: option.value,
            label: option.value,
          })),
          ...(isHistoricalValue ? [{ value, label: value }] : []),
        ]}
        valuesRendering={(optionValue) => (
          <span className="flex w-full items-center gap-2 truncate">
            <span className="truncate">{String(optionValue)}</span>
            {optionValue === value && isHistoricalValue && (
              <Badge
                variant="warning"
                title={t(
                  'This option has been deactivated and can no longer be selected for new values',
                )}
              >
                {t('Historical')}
              </Badge>
            )}
          </span>
        )}
        onChange={handleChange}
        value={value}
        disabled={disabled}
        placeholder={''}
        showDeselect={false}
        openState={{
          open: isEditing,
          setOpen: setIsEditing,
        }}
      ></SearchableSelect>
    </div>
  );
};
DropdownEditor.displayName = 'DropdownEditor';
export { DropdownEditor };
