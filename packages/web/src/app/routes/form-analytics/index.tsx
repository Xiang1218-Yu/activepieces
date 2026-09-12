import { FormSessionAttribution } from '@activepieces/shared';
import dayjs from 'dayjs';
import { t } from 'i18next';
import { ClipboardType, Users } from 'lucide-react';
import { useMemo, useState } from 'react';

import { DataFetchErrorState } from '@/components/custom/data-fetch-error-state';
import { PageHeader } from '@/components/custom/page-header';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formAnalyticsHooks } from '@/features/form-analytics/hooks/form-analytics-hooks';
import {
  aggregateFields,
  aggregateFunnel,
} from '@/features/form-analytics/lib/form-analytics-utils';
import { flowHooks } from '@/features/flows';
import { authenticationSession } from '@/lib/authentication-session';

import { FieldAbandonmentTable } from './components/field-abandonment-table';
import { FunnelView } from './components/funnel-view';

type RangeValue = '7d' | '30d' | '90d';
type AttributionValue = FormSessionAttribution | 'ALL';

const RANGE_DAYS: Record<RangeValue, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

const FormAnalyticsPage = () => {
  const projectId = authenticationSession.getProjectId() ?? '';
  const [range, setRange] = useState<RangeValue>('30d');
  const [attribution, setAttribution] = useState<AttributionValue>('ALL');
  const [flowId, setFlowId] = useState<string>('ALL');
  const [activeTab, setActiveTab] = useState<'funnel' | 'fields'>('funnel');

  const createdAfter = useMemo(
    () => dayjs().subtract(RANGE_DAYS[range], 'day').startOf('day').toISOString(),
    [range],
  );

  const { data: flowsPage } = flowHooks.useFlows({
    limit: 100,
    cursor: undefined,
  });
  const formFlows = useMemo(
    () =>
      (flowsPage?.data ?? []).filter(
        (flow) =>
          flow.version.trigger.settings.pieceName ===
          '@activepieces/piece-forms',
      ),
    [flowsPage],
  );

  const { data: rows, isLoading, isError, refetch } = formAnalyticsHooks.useFunnel(
    {
      projectId,
      createdAfter,
      attribution: attribution === 'ALL' ? undefined : attribution,
      flowId: flowId === 'ALL' ? undefined : flowId,
    },
  );

  const funnel = useMemo(() => aggregateFunnel(rows ?? []), [rows]);
  const fields = useMemo(() => aggregateFields(rows ?? []), [rows]);

  return (
    <div className="flex flex-col gap-4 w-full">
      <PageHeader
        title={
          <div className="flex items-center gap-1.5">
            <ClipboardType className="h-4 w-4" />
            <span className="text-sm font-medium">{t('Form Analytics')}</span>
          </div>
        }
        rightContent={
          <div className="flex items-center gap-2">
            <Select value={range} onValueChange={(v) => setRange(v as RangeValue)}>
              <SelectTrigger className="w-auto h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="7d">{t('Last 7 days')}</SelectItem>
                <SelectItem value="30d">{t('Last 30 days')}</SelectItem>
                <SelectItem value="90d">{t('Last 90 days')}</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={attribution}
              onValueChange={(v) => setAttribution(v as AttributionValue)}
            >
              <SelectTrigger className="w-auto h-8">
                <Users className="h-4 w-4 mr-1" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="ALL">{t('Everyone')}</SelectItem>
                <SelectItem value={FormSessionAttribution.ANONYMOUS}>
                  {t('Anonymous visitors')}
                </SelectItem>
                <SelectItem value={FormSessionAttribution.AUTHENTICATED}>
                  {t('Signed-in users')}
                </SelectItem>
              </SelectContent>
            </Select>
            <Select value={flowId} onValueChange={setFlowId}>
              <SelectTrigger className="w-[220px] h-8">
                <SelectValue placeholder={t('All forms')} />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="ALL">{t('All forms')}</SelectItem>
                {formFlows.map((flow) => (
                  <SelectItem key={flow.id} value={flow.id}>
                    {flow.version.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      />

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'funnel' | 'fields')}>
        <TabsList variant="outline" className="border-b w-full px-7">
          <TabsTrigger variant="outline" value="funnel">
            {t('Conversion Funnel')}
          </TabsTrigger>
          <TabsTrigger variant="outline" value="fields">
            {t('Field Abandonment')}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {isError ? (
        <div className="px-7">
          <DataFetchErrorState
            entity={t('form analytics')}
            onRetry={() => void refetch()}
          />
        </div>
      ) : activeTab === 'funnel' ? (
        <FunnelView rows={rows ?? []} funnel={funnel} isLoading={isLoading} />
      ) : (
        <FieldAbandonmentTable fields={fields} isLoading={isLoading} />
      )}

      {!isLoading && !isError && (rows?.length ?? 0) === 0 && (
        <div className="px-7 text-sm text-muted-foreground">
          {t('No form submissions recorded in this period.')}
        </div>
      )}
      <Button
        variant="link"
        className="self-start px-7"
        onClick={() => void refetch()}
      >
        {t('Refresh')}
      </Button>
    </div>
  );
};

export { FormAnalyticsPage };
