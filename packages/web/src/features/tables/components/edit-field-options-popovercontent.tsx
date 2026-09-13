import { FieldType } from '@activepieces/shared';
import { t } from 'i18next';
import { GripVertical, Plus } from 'lucide-react';
import { nanoid } from 'nanoid';
import { useContext, useState } from 'react';

import { TextWithIcon } from '@/components/custom/text-with-icon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sortable,
  SortableDragHandle,
  SortableItem,
} from '@/components/ui/sortable';
import { Switch } from '@/components/ui/switch';

import { FieldHeaderContext } from '../utils/utils';

import { useTableState } from './ap-table-state-provider';

type EditableOption = {
  id: string;
  value: string;
  disabled: boolean;
};

const EditFieldOptionsPopoverContent = () => {
  const fieldHeaderContext = useContext(FieldHeaderContext);
  const updateFieldOptions = useTableState((state) => state.updateFieldOptions);
  const field = fieldHeaderContext?.field;
  const [options, setOptions] = useState<EditableOption[]>(() =>
    field?.type === FieldType.STATIC_DROPDOWN
      ? field.data.options.map((option) => ({
          id: nanoid(),
          value: option.value,
          disabled: option.disabled === true,
        }))
      : [],
  );
  const [error, setError] = useState<string | null>(null);

  if (
    !fieldHeaderContext ||
    !field ||
    field.type !== FieldType.STATIC_DROPDOWN
  ) {
    console.error(
      'EditFieldOptionsPopoverContent can only be used for STATIC_DROPDOWN fields',
    );
    return null;
  }

  const move = (from: number, to: number) => {
    const newOptions = [...options];
    const [removed] = newOptions.splice(from, 1);
    newOptions.splice(to, 0, removed);
    setOptions(newOptions);
  };

  const validate = (): string | null => {
    if (options.length === 0) {
      return t('Please add at least one option');
    }
    const seenValues = new Set<string>();
    for (const option of options) {
      const value = option.value.trim();
      if (value.length === 0) {
        return t('Option values cannot be empty');
      }
      if (seenValues.has(value)) {
        return t('Option values must be unique: "{{value}}"', { value });
      }
      seenValues.add(value);
    }
    return null;
  };

  const onSave = () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    updateFieldOptions(
      field.index,
      options.map((option) => ({
        value: option.value.trim(),
        disabled: option.disabled,
      })),
    );
    fieldHeaderContext.setIsPopoverOpen(false);
  };

  return (
    <div className="flex flex-col gap-3 w-[320px]">
      <div className="text-sm font-semibold">{t('Edit Options')}</div>
      <div className="text-xs text-muted-foreground">
        {t(
          'Deactivated options stay visible on existing records, but can no longer be selected for new values.',
        )}
      </div>
      <div className="flex w-full flex-col gap-2.5 max-h-[300px] overflow-y-auto">
        <Sortable
          value={options}
          onMove={({ activeIndex, overIndex }) => {
            move(activeIndex, overIndex);
          }}
        >
          {options.map((option, index) => (
            <SortableItem key={option.id} value={option.id} asChild>
              <div className="flex items-center gap-2">
                <SortableDragHandle
                  variant="outline"
                  size="icon"
                  className="shrink-0 size-7"
                >
                  <GripVertical className="size-4" aria-hidden="true" />
                </SortableDragHandle>
                <Input
                  thin={true}
                  value={option.value}
                  className="grow"
                  onChange={(e) => {
                    setOptions(
                      options.map((o, i) =>
                        i === index ? { ...o, value: e.target.value } : o,
                      ),
                    );
                  }}
                />
                <div className="flex items-center gap-1.5 shrink-0">
                  <Switch
                    checked={!option.disabled}
                    onCheckedChange={(checked) => {
                      setOptions(
                        options.map((o, i) =>
                          i === index ? { ...o, disabled: !checked } : o,
                        ),
                      );
                    }}
                    title={
                      option.disabled
                        ? t('Activate option')
                        : t('Deactivate option')
                    }
                  />
                </div>
              </div>
            </SortableItem>
          ))}
        </Sortable>
      </div>
      <Button
        variant="outline"
        size="sm"
        type="button"
        onClick={() => {
          setOptions([
            ...options,
            { id: nanoid(), value: '', disabled: false },
          ]);
        }}
      >
        <TextWithIcon icon={<Plus size={18} />} text={t('Add Option')} />
      </Button>
      {error && <div className="text-xs text-destructive">{error}</div>}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => fieldHeaderContext.setIsPopoverOpen(false)}
        >
          {t('Cancel')}
        </Button>
        <Button type="button" size="sm" onClick={onSave}>
          {t('Save')}
        </Button>
      </div>
    </div>
  );
};

EditFieldOptionsPopoverContent.displayName = 'EditFieldOptionsPopoverContent';
export default EditFieldOptionsPopoverContent;
