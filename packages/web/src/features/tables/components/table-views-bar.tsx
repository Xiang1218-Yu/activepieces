import { Permission } from '@activepieces/core-utils';
import {
  FieldType,
  FilterOperator,
  TableViewCondition,
  TableViewConditionIssue,
  TableViewSortDirection,
} from '@activepieces/shared';
import { t } from 'i18next';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  EyeOff,
  Filter,
  ListFilter,
  Plus,
  RefreshCw,
  Save,
  SlidersHorizontal,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useAuthorization } from '@/hooks/authorization-hooks';

import { useTableState, useTableView } from './ap-table-state-provider';
import { tableViewUtils } from '../utils/table-view-utils';

const PAGE_SIZE_OPTIONS = [50, 100, 200, 500];

export function TableViewsBar() {
  const [fields, records] = useTableState((state) => [
    state.fields,
    state.records,
  ]);
  const {
    views,
    selectedView,
    config,
    draftName,
    isDirty,
    isSaving,
    conflictMessage,
    invalidConditions,
    setDraftName,
    updateConfig,
    selectView,
    createView,
    saveView,
    deleteView,
    reloadView,
  } = useTableView();
  const hasWritePermission = useAuthorization().checkAccess(
    Permission.WRITE_TABLE,
  );
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newViewName, setNewViewName] = useState('');

  const fieldById = new Map(fields.map((field) => [field.uuid, field]));
  const totalRows = useMemo(() => {
    const rows = records.map((record) => {
      const row: Record<string, unknown> = { id: record.uuid };
      record.values.forEach((cell) => {
        const field = fields[cell.fieldIndex];
        if (field) {
          row[field.uuid] = cell.value;
        }
      });
      return row;
    });
    return tableViewUtils.applyTableView({
      records: rows,
      fields: fields.map((field) => ({
        id: field.uuid,
        name: field.name,
        type: field.type,
      })),
      config,
    }).length;
  }, [fields, records, config]);
  const pageCount = Math.max(1, Math.ceil(totalRows / config.pagination.pageSize));
  const currentPage = Math.min(config.pagination.page, pageCount);

  const changeConfig = (
    updater: Parameters<typeof updateConfig>[0],
  ) => updateConfig(updater);

  useEffect(() => {
    if (config.pagination.page > pageCount) {
      changeConfig((currentConfig) => ({
        ...currentConfig,
        pagination: {
          ...currentConfig.pagination,
          page: pageCount,
        },
      }));
    }
  }, [changeConfig, config.pagination.page, pageCount]);

  const addFilter = () => {
    const field = fields[0];
    if (!field) {
      return;
    }
    const condition = tableViewUtils.createTableViewCondition(
      field.uuid,
      field.name,
      field.type,
    );
    changeConfig((currentConfig) => ({
      ...currentConfig,
      filters: [...currentConfig.filters, condition],
      pagination: resetPagination(currentConfig.pagination),
    }));
  };

  const addSort = () => {
    const field = fields[0];
    if (!field) {
      return;
    }
    changeConfig((currentConfig) => ({
      ...currentConfig,
      sorts: [
        ...currentConfig.sorts,
        { fieldId: field.uuid, direction: TableViewSortDirection.ASC },
      ],
    }));
  };

  const saveSelectedView = () => saveView(draftName.trim());

  const openCreateDialog = () => {
    setNewViewName(`${t('View')} ${views.length + 1}`);
    setIsCreateDialogOpen(true);
  };

  return (
    <div className="w-full border-b bg-background">
      <div className="flex min-h-11 items-center gap-1.5 px-3 py-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-8 gap-1 px-2 font-medium">
              {selectedView ? selectedView.name : t('Default view')}
              <ChevronDown className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel>{t('Views')}</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => selectView(null)}>
              {t('Default view')}
            </DropdownMenuItem>
            {views.map((view) => (
              <DropdownMenuItem
                key={view.id}
                onSelect={() => selectView(view.id)}
              >
                {view.name}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={!hasWritePermission}
              onSelect={openCreateDialog}
            >
              <Plus className="mr-2 size-4" />
              {t('Save current view')}
            </DropdownMenuItem>
            {selectedView && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={!hasWritePermission}
                  className="text-destructive focus:text-destructive"
                  onSelect={() => deleteView(selectedView.id)}
                >
                  <Trash2 className="mr-2 size-4" />
                  {t('Delete view')}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {selectedView && (
          <Input
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            readOnly={!hasWritePermission}
            className="h-8 w-40"
          />
        )}

        <ConfigPopover
          icon={<ListFilter className="size-4" />}
          label={t('Filter')}
          count={config.filters.length}
        >
          <div className="space-y-2">
            {invalidConditions.length > 0 && (
              <div className="rounded-md border border-warning/50 bg-warning/10 p-2 text-xs text-warning-700 dark:text-warning-300">
                <div className="flex items-center gap-1 font-medium">
                  <TriangleAlert className="size-3.5" />
                  {t('Some conditions need repair')}
                </div>
                {invalidConditions.map(({ condition, issue }) => (
                  <div key={`${condition.fieldId}-${condition.operator}`} className="mt-1">
                    {issue === TableViewConditionIssue.FIELD_DELETED
                      ? t('Field “{{name}}” was deleted. Select another field or remove the condition.', { name: condition.fieldName })
                      : t('Field “{{name}}” changed type. Review and save the condition.', { name: condition.fieldName })}
                  </div>
                ))}
              </div>
            )}
            {config.filters.map((condition, index) => (
              <FilterRow
                key={`${condition.fieldId}-${index}`}
                condition={condition}
                fields={fields.map((field) => ({
                  id: field.uuid,
                  name: field.name,
                  type: field.type,
                }))}
                onChange={(nextCondition) =>
                  changeConfig((currentConfig) => ({
                    ...currentConfig,
                    filters: currentConfig.filters.map((currentCondition, currentIndex) =>
                      currentIndex === index ? nextCondition : currentCondition,
                    ),
                    pagination: resetPagination(currentConfig.pagination),
                  }))
                }
                onRemove={() =>
                  changeConfig((currentConfig) => ({
                    ...currentConfig,
                    filters: currentConfig.filters.filter(
                      (_, currentIndex) => currentIndex !== index,
                    ),
                    pagination: resetPagination(currentConfig.pagination),
                  }))
                }
              />
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              onClick={addFilter}
              disabled={fields.length === 0}
            >
              <Plus className="mr-2 size-4" />
              {t('Add condition')}
            </Button>
          </div>
        </ConfigPopover>

        <ConfigPopover
          icon={<SlidersHorizontal className="size-4" />}
          label={t('Sort')}
          count={config.sorts.length}
        >
          <div className="space-y-2">
            {config.sorts.map((sort, index) => (
              <div key={`${sort.fieldId}-${index}`} className="flex gap-1">
                <select
                  value={sort.fieldId}
                  className="h-8 flex-1 rounded-md border bg-background px-2 text-sm"
                  onChange={(event) => {
                    const field = fieldById.get(event.target.value);
                    if (!field) return;
                    changeConfig((currentConfig) => ({
                      ...currentConfig,
                      sorts: currentConfig.sorts.map((currentSort, currentIndex) =>
                        currentIndex === index
                          ? { ...currentSort, fieldId: field.uuid }
                          : currentSort,
                      ),
                    }));
                  }}
                >
                  {fields.map((field) => (
                    <option key={field.uuid} value={field.uuid}>
                      {field.name}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() =>
                    changeConfig((currentConfig) => ({
                      ...currentConfig,
                      sorts: currentConfig.sorts.map((currentSort, currentIndex) =>
                        currentIndex === index
                          ? {
                              ...currentSort,
                              direction:
                                currentSort.direction === TableViewSortDirection.ASC
                                  ? TableViewSortDirection.DESC
                                  : TableViewSortDirection.ASC,
                            }
                          : currentSort,
                      ),
                    }))
                  }
                >
                  {sort.direction === TableViewSortDirection.ASC ? (
                    <ArrowUp className="size-4" />
                  ) : (
                    <ArrowDown className="size-4" />
                  )}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8"
                  onClick={() =>
                    changeConfig((currentConfig) => ({
                      ...currentConfig,
                      sorts: currentConfig.sorts.filter(
                        (_, currentIndex) => currentIndex !== index,
                      ),
                    }))
                  }
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              onClick={addSort}
              disabled={fields.length === 0}
            >
              <Plus className="mr-2 size-4" />
              {t('Add sort')}
            </Button>
          </div>
        </ConfigPopover>

        <ConfigPopover
          icon={<EyeOff className="size-4" />}
          label={t('Columns')}
          count={config.hiddenFieldIds.length}
        >
          <div className="space-y-1.5">
            {fields.map((field) => {
              const hidden = config.hiddenFieldIds.includes(field.uuid);
              return (
                <label
                  key={field.uuid}
                  className="flex items-center gap-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={!hidden}
                      onChange={() =>
                      changeConfig((currentConfig) => ({
                        ...currentConfig,
                        hiddenFieldIds: hidden
                          ? currentConfig.hiddenFieldIds.filter(
                              (fieldId) => fieldId !== field.uuid,
                            )
                          : [...currentConfig.hiddenFieldIds, field.uuid],
                      }))
                    }
                  />
                  {field.name}
                </label>
              );
            })}
          </div>
        </ConfigPopover>

        {invalidConditions.length > 0 && (
          <div className="flex items-center gap-1 rounded-md border border-warning/50 bg-warning/10 px-2 py-1 text-xs text-warning-700 dark:text-warning-300">
            <TriangleAlert className="size-3.5" />
            {t('{{count}} condition(s) need repair', {
              count: invalidConditions.length,
            })}
          </div>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          {conflictMessage && (
            <div className="flex items-center gap-1 rounded-md border border-warning/50 px-2 py-1 text-xs text-warning-700 dark:text-warning-300">
              <TriangleAlert className="size-3.5" />
              {conflictMessage}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-1.5"
                onClick={reloadView}
              >
                <RefreshCw className="mr-1 size-3" />
                {t('Reload')}
              </Button>
            </div>
          )}
          {selectedView && (
            <Button
              type="button"
              size="sm"
              disabled={
                !hasWritePermission ||
                !isDirty ||
                isSaving ||
                draftName.trim().length === 0
              }
              onClick={saveSelectedView}
            >
              <Save className="mr-2 size-4" />
              {t('Save view')}
            </Button>
          )}
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              disabled={currentPage <= 1}
              onClick={() =>
                changeConfig((currentConfig) => ({
                  ...currentConfig,
                  pagination: {
                    ...currentConfig.pagination,
                    page: currentConfig.pagination.page - 1,
                  },
                }))
              }
            >
              <ArrowLeft className="size-4" />
            </Button>
            <span>{t('Page {{page}} of {{count}}', { page: currentPage, count: pageCount })}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              disabled={currentPage >= pageCount}
              onClick={() =>
                changeConfig((currentConfig) => ({
                  ...currentConfig,
                  pagination: {
                    ...currentConfig.pagination,
                    page: currentConfig.pagination.page + 1,
                  },
                }))
              }
            >
              <ArrowRight className="size-4" />
            </Button>
            <select
              value={config.pagination.pageSize}
              className="h-8 rounded-md border bg-background px-2 text-sm"
              onChange={(event) =>
                changeConfig((currentConfig) => ({
                  ...currentConfig,
                  pagination: {
                    page: 1,
                    pageSize: Number.parseInt(event.target.value, 10),
                  },
                }))
              }
            >
              {PAGE_SIZE_OPTIONS.map((pageSize) => (
                <option key={pageSize} value={pageSize}>
                  {pageSize} / {t('page')}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <Dialog
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('Save current view')}</DialogTitle>
          </DialogHeader>
          <Input
            value={newViewName}
            autoFocus
            onChange={(event) => setNewViewName(event.target.value)}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsCreateDialogOpen(false)}
            >
              {t('Cancel')}
            </Button>
            <Button
              type="button"
              disabled={newViewName.trim().length === 0}
              onClick={async () => {
                const view = await createView(newViewName.trim());
                setIsCreateDialogOpen(false);
                selectView(view.id);
              }}
            >
              {t('Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ConfigPopover({
  icon,
  label,
  count,
  children,
}: {
  icon: ReactNode;
  label: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-8">
          {icon}
          {label}
          {count > 0 && <span className="ml-1 rounded bg-muted px-1.5 text-xs">{count}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium">
          <Filter className="size-4" />
          {label}
        </div>
        {children}
      </PopoverContent>
    </Popover>
  );
}

function FilterRow({
  condition,
  fields,
  onChange,
  onRemove,
}: {
  condition: TableViewCondition;
  fields: { id: string; name: string; type: FieldType }[];
  onChange: (condition: TableViewCondition) => void;
  onRemove: () => void;
}) {
  const fieldExists = fields.some((field) => field.id === condition.fieldId);
  const currentField = fields.find((field) => field.id === condition.fieldId);
  const operators = getOperators(currentField?.type ?? condition.fieldType);
  return (
    <div className="space-y-1 rounded-md border p-2">
      <div className="flex gap-1">
        <select
          value={condition.fieldId}
          className="h-8 flex-1 rounded-md border bg-background px-2 text-sm"
          onChange={(event) => {
            const field = fields.find((item) => item.id === event.target.value);
            if (!field) return;
            onChange({
              ...condition,
              fieldId: field.id,
              fieldName: field.name,
              fieldType: field.type,
              operator: tableViewUtils.createTableViewCondition(
                field.id,
                field.name,
                field.type,
              ).operator,
              value: '',
            });
          }}
        >
          {!fieldExists && (
            <option value={condition.fieldId}>
              {condition.fieldName} ({t('deleted')})
            </option>
          )}
          {fields.map((field) => (
            <option key={field.id} value={field.id}>
              {field.name}
            </option>
          ))}
        </select>
        <Button type="button" variant="ghost" size="sm" className="h-8" onClick={onRemove}>
          <Trash2 className="size-4" />
        </Button>
      </div>
      {!fieldExists && (
        <div className="flex items-center justify-between gap-2 rounded bg-warning/10 px-2 py-1 text-xs text-warning-700 dark:text-warning-300">
          <span>{t('This field was deleted')}</span>
        </div>
      )}
      {fieldExists && currentField && currentField.type !== condition.fieldType && (
        <div className="flex items-center justify-between gap-2 rounded bg-warning/10 px-2 py-1 text-xs text-warning-700 dark:text-warning-300">
          <span>{t('This field changed type')}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-1.5"
            onClick={() =>
              onChange({
                ...condition,
                fieldType: currentField.type,
                operator: tableViewUtils.createTableViewCondition(
                  currentField.id,
                  currentField.name,
                  currentField.type,
                ).operator,
                value: '',
              })
            }
          >
            {t('Repair')}
          </Button>
        </div>
      )}
      <div className="flex gap-1">
        <select
          value={condition.operator}
          className="h-8 flex-1 rounded-md border bg-background px-2 text-sm"
          onChange={(event) => {
            const selectedOperator = operators.find(
              (operator) => operator === event.target.value,
            );
            if (!selectedOperator) {
              return;
            }
            onChange({
              ...condition,
              fieldType: currentField?.type ?? condition.fieldType,
              operator: selectedOperator,
              value:
                selectedOperator === FilterOperator.EXISTS ||
                selectedOperator === FilterOperator.NOT_EXISTS
                  ? ''
                  : condition.value,
            });
          }}
        >
          {operators.map((operator) => (
            <option key={operator} value={operator}>
              {operatorLabel(operator, currentField?.type ?? condition.fieldType)}
            </option>
          ))}
        </select>
        {condition.operator !== FilterOperator.EXISTS &&
          condition.operator !== FilterOperator.NOT_EXISTS && (
            <Input
              value={condition.value}
              className="h-8 flex-1"
              onChange={(event) =>
                onChange({ ...condition, value: event.target.value })
              }
            />
          )}
      </div>
    </div>
  );
}

function resetPagination<T extends { page: number }>(pagination: T): T {
  return {
    ...pagination,
    page: 1,
  };
}

function getOperators(fieldType: FieldType): FilterOperator[] {
  if (fieldType === FieldType.NUMBER || fieldType === FieldType.DATE || fieldType === FieldType.DATETIME) {
    return [
      FilterOperator.EQ,
      FilterOperator.NEQ,
      FilterOperator.GT,
      FilterOperator.GTE,
      FilterOperator.LT,
      FilterOperator.LTE,
      FilterOperator.EXISTS,
      FilterOperator.NOT_EXISTS,
    ];
  }
  return [
    FilterOperator.CO,
    FilterOperator.EQ,
    FilterOperator.NEQ,
    FilterOperator.EXISTS,
    FilterOperator.NOT_EXISTS,
  ];
}

function operatorLabel(
  operator: FilterOperator,
  fieldType: FieldType,
): string {
  const dateType =
    fieldType === FieldType.DATE || fieldType === FieldType.DATETIME;
  const labels: Record<FilterOperator, string> = {
    [FilterOperator.EQ]: dateType ? t('is on') : t('equals'),
    [FilterOperator.NEQ]: dateType ? t('is not on') : t('does not equal'),
    [FilterOperator.GT]: dateType ? t('is after') : t('is greater than'),
    [FilterOperator.GTE]: dateType
      ? t('is on or after')
      : t('is greater than or equal'),
    [FilterOperator.LT]: dateType ? t('is before') : t('is less than'),
    [FilterOperator.LTE]: dateType
      ? t('is on or before')
      : t('is less than or equal'),
    [FilterOperator.CO]: t('contains'),
    [FilterOperator.EXISTS]: t('is not empty'),
    [FilterOperator.NOT_EXISTS]: t('is empty'),
  };
  return labels[operator];
}
