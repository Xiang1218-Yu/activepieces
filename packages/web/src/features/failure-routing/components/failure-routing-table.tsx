import { Permission } from '@activepieces/core-utils';
import {
  FailureDeliveryStatus,
  FailureRoutingRule,
  FailureRoutingTargetType,
} from '@activepieces/shared';
import { t } from 'i18next';
import {
  ArrowDownWideNarrow,
  History,
  Pencil,
  Plus,
  Trash,
} from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useAuthorization } from '@/hooks/authorization-hooks';

import {
  failureRoutingMutations,
  failureRoutingQueries,
} from '../hooks/failure-routing-hooks';
import { FailureRoutingRuleDialog } from './failure-routing-rule-dialog';
import { FailureDeliveriesDialog } from './failure-deliveries-dialog';

const STATUS_BADGE_CLASS: Record<FailureDeliveryStatus, string> = {
  [FailureDeliveryStatus.PENDING]: 'bg-amber-100 text-amber-800',
  [FailureDeliveryStatus.SUCCEEDED]: 'bg-emerald-100 text-emerald-800',
  [FailureDeliveryStatus.FAILED]: 'bg-red-100 text-red-800',
  [FailureDeliveryStatus.SKIPPED]: 'bg-gray-100 text-gray-700',
  [FailureDeliveryStatus.DEDUPLICATED]: 'bg-gray-100 text-gray-700',
};

const describeTarget = (rule: FailureRoutingRule): string => {
  if (rule.target.type === FailureRoutingTargetType.EMAIL) {
    return `${rule.target.emails.join(', ')}`;
  }
  return rule.target.url;
};

export const FailureRoutingTable = () => {
  const { checkAccess } = useAuthorization();
  const canWrite = checkAccess(Permission.WRITE_ALERT);
  const { data, isLoading } = failureRoutingQueries.useRules();
  const { mutate: deleteRule } = failureRoutingMutations.useDeleteRule();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<FailureRoutingRule | undefined>();
  const [deliveriesRule, setDeliveriesRule] = useState<
    FailureRoutingRule | undefined
  >();

  const rules = data?.data ?? [];

  const openCreate = () => {
    setEditingRule(undefined);
    setEditorOpen(true);
  };

  const openEdit = (rule: FailureRoutingRule) => {
    setEditingRule(rule);
    setEditorOpen(true);
  };

  return (
    <div className="flex w-full flex-col gap-4 px-7 py-7">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('Failure Routing')}</h1>
          <p className="text-sm text-muted-foreground">
            {t(
              'Route failed production runs to different on-call targets. Rules evaluate in priority order (lower number first); stop-on-match ends evaluation.',
            )}
          </p>
        </div>
        {canWrite && (
          <Button onClick={openCreate} className="flex items-center gap-2">
            <Plus className="size-4" />
            {t('New rule')}
          </Button>
        )}
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">
                <span className="inline-flex items-center gap-1">
                  <ArrowDownWideNarrow className="size-3.5" />
                  {t('Priority')}
                </span>
              </TableHead>
              <TableHead>{t('Rule')}</TableHead>
              <TableHead>{t('Match')}</TableHead>
              <TableHead>{t('Target')}</TableHead>
              <TableHead>{t('Last delivery')}</TableHead>
              <TableHead className="w-32">{t('Actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                  {t('Loading…')}
                </TableCell>
              </TableRow>
            )}
            {!isLoading && rules.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                  {t('No routing rules yet. Failed runs are currently not routed.')}
                </TableCell>
              </TableRow>
            )}
            {rules.map((rule) => {
              const categories = rule.filter.categories ?? [];
              const flows = rule.filter.flowIds ?? [];
              const retry =
                rule.filter.minRetryCount !== undefined ||
                rule.filter.maxRetryCount !== undefined
                  ? `${rule.filter.minRetryCount ?? 0}–${
                      rule.filter.maxRetryCount ?? '∞'
                    }`
                  : null;
              return (
                <TableRow key={rule.id}>
                  <TableCell className="font-mono">{rule.priority}</TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">
                        {rule.displayName}
                        {!rule.enabled && (
                          <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                            {t('Disabled')}
                          </span>
                        )}
                        {rule.stopOnMatch && (
                          <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                            {t('Stop on match')}
                          </span>
                        )}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <div className="flex flex-col gap-0.5">
                      <span>
                        {flows.length > 0
                          ? `${flows.length} flow(s)`
                          : t('Any flow')}
                      </span>
                      <span>
                        {categories.length > 0
                          ? categories.join(', ')
                          : t('Any category')}
                      </span>
                      {retry && <span>{t('Retries')}: {retry}</span>}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[220px] truncate text-xs">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-help">{describeTarget(rule)}</span>
                      </TooltipTrigger>
                      <TooltipContent>{describeTarget(rule)}</TooltipContent>
                    </Tooltip>
                  </TableCell>
                  <TableCell>
                    {rule.lastDelivery ? (
                      <div className="flex flex-col gap-0.5">
                        <span
                          className={`inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            STATUS_BADGE_CLASS[rule.lastDelivery.status]
                          }`}
                        >
                          {rule.lastDelivery.status}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(rule.lastDelivery.updated).toLocaleString()}
                        </span>
                        {rule.lastDelivery.errorMessage && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="cursor-help text-[10px] text-red-600">
                                {rule.lastDelivery.errorMessage.slice(0, 60)}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {rule.lastDelivery.errorMessage}
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="size-8 p-0"
                        onClick={() => setDeliveriesRule(rule)}
                      >
                        <History className="size-4" />
                      </Button>
                      {canWrite && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="size-8 p-0"
                            onClick={() => openEdit(rule)}
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="size-8 p-0 hover:bg-destructive-50"
                            onClick={() => deleteRule(rule)}
                          >
                            <Trash className="size-4 text-destructive" />
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <FailureRoutingRuleDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        rule={editingRule}
      />
      <FailureDeliveriesDialog
        rule={deliveriesRule}
        onOpenChange={(open) => {
          if (!open) {
            setDeliveriesRule(undefined);
          }
        }}
      />
    </div>
  );
};
