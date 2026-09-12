import {
  DEFAULT_TABLE_VIEW_CONFIG,
  FieldType,
  FilterOperator,
  TableView,
  TableViewCondition,
  TableViewConfig,
  TableViewSortDirection,
} from '@activepieces/shared';

const numberComparableTypes = [FieldType.NUMBER, FieldType.DATE, FieldType.DATETIME];

export const defaultTableViewConfig = (): TableViewConfig =>
  JSON.parse(JSON.stringify(DEFAULT_TABLE_VIEW_CONFIG));

export function createTableViewCondition(
  fieldId: string,
  fieldName: string,
  fieldType: FieldType,
): TableViewCondition {
  return {
    fieldId,
    fieldName,
    fieldType,
    operator:
      fieldType === FieldType.NUMBER ||
      fieldType === FieldType.DATE ||
      fieldType === FieldType.DATETIME
        ? FilterOperator.GT
        : FilterOperator.CO,
    value: '',
  };
}

export function applyTableView({
  records,
  fields,
  config,
}: {
  records: Record<string, unknown>[];
  fields: { id: string; name: string; type: FieldType }[];
  config: TableViewConfig;
}): Record<string, unknown>[] {
  const fieldById = new Map(fields.map((field) => [field.id, field]));
  const validFilters = config.filters.filter((condition) =>
    isConditionValid({ condition, field: fieldById.get(condition.fieldId) }),
  );
  const validSorts = config.sorts.filter((sort) =>
    fieldById.has(sort.fieldId),
  );

  const filteredRecords = records.filter((record) =>
    validFilters.every((condition) =>
      matchesCondition({
        record,
        condition,
        fieldType: fieldById.get(condition.fieldId)?.type,
      }),
    ),
  );

  return [...filteredRecords].sort((left, right) => {
    for (const sort of validSorts) {
      const comparison = compareValues({
        left: left[sort.fieldId],
        right: right[sort.fieldId],
        fieldType: fieldById.get(sort.fieldId)?.type,
      });
      if (comparison !== 0) {
        return sort.direction === TableViewSortDirection.ASC
          ? comparison
          : -comparison;
      }
    }
    return 0;
  });
}

export function isConditionValid({
  condition,
  field,
}: {
  condition: TableViewCondition;
  field?: { id: string; type: FieldType };
}): boolean {
  return !!field && field.type === condition.fieldType;
}

function matchesCondition({
  record,
  condition,
  fieldType,
}: {
  record: Record<string, unknown>;
  condition: TableViewCondition;
  fieldType?: FieldType;
}): boolean {
  const rawValue = record[condition.fieldId];
  const value = rawValue === null || rawValue === undefined ? '' : String(rawValue);
  const exists = value !== '';

  if (condition.operator === FilterOperator.EXISTS) {
    return exists;
  }
  if (condition.operator === FilterOperator.NOT_EXISTS) {
    return !exists;
  }
  if (!exists) {
    return false;
  }

  const target = condition.value;
  if (fieldType === FieldType.NUMBER) {
    const left = Number.parseFloat(value);
    const right = Number.parseFloat(target);
    if (Number.isNaN(left) || Number.isNaN(right)) {
      return false;
    }
    return compareNumbers({ operator: condition.operator, left, right });
  }
  if (fieldType === FieldType.DATE || fieldType === FieldType.DATETIME) {
    const left = Date.parse(value);
    const right = Date.parse(target);
    if (Number.isNaN(left) || Number.isNaN(right)) {
      return false;
    }
    return compareNumbers({ operator: condition.operator, left, right });
  }

  const left = value.toLocaleLowerCase();
  const right = target.toLocaleLowerCase();
  switch (condition.operator) {
    case FilterOperator.EQ:
      return left === right;
    case FilterOperator.NEQ:
      return left !== right;
    case FilterOperator.CO:
      return left.includes(right);
    default:
      return false;
  }
}

function compareNumbers({
  operator,
  left,
  right,
}: {
  operator: FilterOperator;
  left: number;
  right: number;
}): boolean {
  switch (operator) {
    case FilterOperator.EQ:
      return left === right;
    case FilterOperator.NEQ:
      return left !== right;
    case FilterOperator.GT:
      return left > right;
    case FilterOperator.GTE:
      return left >= right;
    case FilterOperator.LT:
      return left < right;
    case FilterOperator.LTE:
      return left <= right;
    case FilterOperator.CO:
      return String(left).includes(String(right));
    default:
      return false;
  }
}

function compareValues({
  left,
  right,
  fieldType,
}: {
  left: unknown;
  right: unknown;
  fieldType?: FieldType;
}): number {
  const normalizedLeft = left === null || left === undefined ? '' : String(left);
  const normalizedRight = right === null || right === undefined ? '' : String(right);
  if (fieldType && numberComparableTypes.includes(fieldType)) {
    const numericLeft = fieldType === FieldType.NUMBER
      ? Number.parseFloat(normalizedLeft)
      : Date.parse(normalizedLeft);
    const numericRight = fieldType === FieldType.NUMBER
      ? Number.parseFloat(normalizedRight)
      : Date.parse(normalizedRight);
    if (!Number.isNaN(numericLeft) && !Number.isNaN(numericRight)) {
      return numericLeft - numericRight;
    }
  }
  return normalizedLeft.localeCompare(normalizedRight);
}

export function getVisibleFieldIds(
  fieldIds: string[],
  config: TableViewConfig,
): string[] {
  const hiddenFieldIds = new Set(config.hiddenFieldIds);
  return fieldIds.filter((fieldId) => !hiddenFieldIds.has(fieldId));
}

export function getPagedRecords<T>(records: T[], config: TableViewConfig): T[] {
  const { page, pageSize } = config.pagination;
  const start = (page - 1) * pageSize;
  return records.slice(start, start + pageSize);
}

export const tableViewUtils = {
  applyTableView,
  createTableViewCondition,
  defaultTableViewConfig,
  getPagedRecords,
  getVisibleFieldIds,
  isConditionValid,
};

export type { TableView };
