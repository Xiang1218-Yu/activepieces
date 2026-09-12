import {
  FormAnalyticsRow,
  FormFieldAbandonment,
  FormFunnelStage,
  FormSessionStatus,
} from '@activepieces/shared';

const FUNNEL_ORDER: FormSessionStatus[] = [
  FormSessionStatus.VISITED,
  FormSessionStatus.STARTED,
  FormSessionStatus.SUBMITTED,
  FormSessionStatus.FAILED,
  FormSessionStatus.TIMED_OUT,
  FormSessionStatus.ABANDONED,
];

export function aggregateFunnel(rows: FormAnalyticsRow[]): FormFunnelStage[] {
  const totals = new Map<FormSessionStatus, number>();
  for (const row of rows) {
    for (const stage of row.funnel) {
      totals.set(stage.key, (totals.get(stage.key) ?? 0) + stage.count);
    }
  }
  const labelByKey = new Map<FormSessionStatus, string>();
  for (const row of rows) {
    for (const stage of row.funnel) {
      if (!labelByKey.has(stage.key)) {
        labelByKey.set(stage.key, stage.label);
      }
    }
  }
  return FUNNEL_ORDER.map((key) => ({
    key,
    label: labelByKey.get(key) ?? key,
    count: totals.get(key) ?? 0,
  }));
}

export function aggregateFields(
  rows: FormAnalyticsRow[],
): FormFieldAbandonment[] {
  const byField = new Map<
    string,
    { reached: number; interacted: number; label: string }
  >();
  for (const row of rows) {
    for (const field of row.fields) {
      const entry = byField.get(field.fieldName) ?? {
        reached: 0,
        interacted: 0,
        label: field.fieldLabel,
      };
      entry.reached += field.reached;
      entry.interacted += field.interacted;
      byField.set(field.fieldName, entry);
    }
  }
  return Array.from(byField.entries())
    .map(([fieldName, entry]) => {
      const abandonedAt = entry.reached - entry.interacted;
      return {
        fieldName,
        fieldLabel: entry.label,
        reached: entry.reached,
        interacted: entry.interacted,
        abandonedAt,
        abandonmentRate:
          entry.reached === 0
            ? 0
            : Number((abandonedAt / entry.reached).toFixed(4)),
      };
    })
    .sort((a, b) => b.abandonedAt - a.abandonedAt);
}

export function countVisited(row: FormAnalyticsRow): number {
  return row.funnel.reduce((sum, stage) => sum + stage.count, 0);
}

export function toPercentage(part: number, total: number): number {
  if (total === 0) {
    return 0;
  }
  return Number(((part / total) * 100).toFixed(1));
}
