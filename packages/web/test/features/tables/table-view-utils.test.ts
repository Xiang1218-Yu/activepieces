import { FieldType, FilterOperator, TableViewSortDirection } from '@activepieces/shared';
import { describe, expect, it } from 'vitest';

import { tableViewUtils } from '@/features/tables/utils/table-view-utils';

const fields = [
  { id: 'email', name: 'Email', type: FieldType.TEXT },
  { id: 'age', name: 'Age', type: FieldType.NUMBER },
];

const records = [
  { id: '1', email: 'a@example.com', age: '30' },
  { id: '2', email: 'b@other.com', age: '10' },
  { id: '3', email: '', age: '40' },
];

describe('tableViewUtils', () => {
  it('filters, sorts, and paginates table records', () => {
    const config = {
      filters: [
        {
          fieldId: 'email',
          fieldName: 'Email',
          fieldType: FieldType.TEXT,
          operator: FilterOperator.CO,
          value: 'example',
        },
      ],
      sorts: [
        { fieldId: 'age', direction: TableViewSortDirection.DESC },
      ],
      hiddenFieldIds: [],
      pagination: { page: 1, pageSize: 1 },
    };

    const filtered = tableViewUtils.applyTableView({ records, fields, config });
    expect(filtered.map((record) => record.id)).toEqual(['1']);

    const paged = tableViewUtils.getPagedRecords(
      tableViewUtils.applyTableView({
        records: [
          records[1],
          records[0],
        ],
        fields,
        config: { ...config, filters: [] },
      }),
      config,
    );
    expect(paged.map((record) => record.id)).toEqual(['1']);
  });

  it('ignores deleted and type-changed conditions', () => {
    const config = {
      filters: [
        {
          fieldId: 'deleted',
          fieldName: 'Deleted',
          fieldType: FieldType.TEXT,
          operator: FilterOperator.CO,
          value: 'value',
        },
        {
          fieldId: 'age',
          fieldName: 'Age',
          fieldType: FieldType.TEXT,
          operator: FilterOperator.CO,
          value: '3',
        },
      ],
      sorts: [],
      hiddenFieldIds: [],
      pagination: { page: 1, pageSize: 100 },
    };

    expect(
      tableViewUtils.applyTableView({ records, fields, config }).map((record) => record.id),
    ).toEqual(['1', '2', '3']);
  });

  it('hides configured fields', () => {
    expect(
      tableViewUtils.getVisibleFieldIds(['email', 'age'], {
        filters: [],
        sorts: [],
        hiddenFieldIds: ['age'],
        pagination: { page: 1, pageSize: 100 },
      }),
    ).toEqual(['email']);
  });
});
