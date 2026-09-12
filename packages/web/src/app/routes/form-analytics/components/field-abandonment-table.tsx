import { FormFieldAbandonment } from '@activepieces/shared';
import { t } from 'i18next';

import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

type FieldAbandonmentTableProps = {
  fields: FormFieldAbandonment[];
  isLoading: boolean;
};

export function FieldAbandonmentTable({
  fields,
  isLoading,
}: FieldAbandonmentTableProps) {
  if (isLoading) {
    return (
      <div className="px-7">
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  return (
    <div className="px-7">
      <Card>
        <div className="px-6 py-4 border-b">
          <h3 className="text-base font-medium">{t('Abandonment by field')}</h3>
          <p className="text-xs text-muted-foreground mt-1">
            {t(
              'Fields visitors reached but never interacted with. Higher bars point at where forms are dropped.',
            )}
          </p>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('Field')}</TableHead>
              <TableHead className="text-right">{t('Reached')}</TableHead>
              <TableHead className="text-right">{t('Interacted')}</TableHead>
              <TableHead className="text-right">{t('Abandoned')}</TableHead>
              <TableHead className="w-[260px]">
                {t('Abandonment rate')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {fields.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center text-muted-foreground py-8"
                >
                  {t('No field interactions recorded yet.')}
                </TableCell>
              </TableRow>
            ) : (
              fields.map((field) => (
                <TableRow key={field.fieldName}>
                  <TableCell className="font-medium">
                    {field.fieldLabel}
                  </TableCell>
                  <TableCell className="text-right">{field.reached}</TableCell>
                  <TableCell className="text-right">
                    {field.interacted}
                  </TableCell>
                  <TableCell className="text-right">
                    {field.abandonedAt}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Progress
                        value={field.abandonmentRate * 100}
                        className="h-2"
                      />
                      <span className="text-xs tabular-nums w-12 text-right">
                        {(field.abandonmentRate * 100).toFixed(1)}%
                      </span>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
