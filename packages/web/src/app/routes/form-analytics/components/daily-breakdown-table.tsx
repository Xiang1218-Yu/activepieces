import {
  FormAnalyticsRow,
  FormSessionAttribution,
  FormSessionStatus,
} from '@activepieces/shared';
import { t } from 'i18next';

import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { countVisited } from '@/features/form-analytics/lib/form-analytics-utils';

type DailyBreakdownTableProps = {
  rows: FormAnalyticsRow[];
};

function stageCount(row: FormAnalyticsRow, key: FormSessionStatus): number {
  return row.funnel.find((stage) => stage.key === key)?.count ?? 0;
}

export function DailyBreakdownTable({ rows }: DailyBreakdownTableProps) {
  if (rows.length === 0) {
    return null;
  }
  return (
    <Card>
      <div className="px-6 py-4 border-b">
        <h3 className="text-base font-medium">{t('Daily breakdown')}</h3>
        <p className="text-xs text-muted-foreground mt-1">
          {t('Grouped by date, form version and visitor type.')}
        </p>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('Date')}</TableHead>
            <TableHead>{t('Version')}</TableHead>
            <TableHead>{t('Visitor')}</TableHead>
            <TableHead className="text-right">{t('Visited')}</TableHead>
            <TableHead className="text-right">{t('Started')}</TableHead>
            <TableHead className="text-right">{t('Submitted')}</TableHead>
            <TableHead className="text-right">{t('Failed')}</TableHead>
            <TableHead className="text-right">{t('Timed out')}</TableHead>
            <TableHead className="text-right">{t('Abandoned')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={`${row.date}-${row.flowVersionId}-${row.attribution}`}
            >
              <TableCell className="font-medium">{row.date}</TableCell>
              <TableCell className="font-mono text-xs">
                {shortVersion(row.flowVersionId)}
              </TableCell>
              <TableCell>
                {row.attribution === FormSessionAttribution.ANONYMOUS
                  ? t('Anonymous')
                  : t('Signed-in')}
              </TableCell>
              <TableCell className="text-right">{countVisited(row)}</TableCell>
              <TableCell className="text-right">
                {stageCount(row, FormSessionStatus.STARTED)}
              </TableCell>
              <TableCell className="text-right text-green-700">
                {stageCount(row, FormSessionStatus.SUBMITTED)}
              </TableCell>
              <TableCell className="text-right text-red-700">
                {stageCount(row, FormSessionStatus.FAILED)}
              </TableCell>
              <TableCell className="text-right text-orange-700">
                {stageCount(row, FormSessionStatus.TIMED_OUT)}
              </TableCell>
              <TableCell className="text-right text-yellow-700">
                {stageCount(row, FormSessionStatus.ABANDONED)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function shortVersion(versionId: string): string {
  if (versionId === 'unversioned') {
    return '—'
  }
  return versionId.slice(0, 10);
}
