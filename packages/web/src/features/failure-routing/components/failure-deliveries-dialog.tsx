import {
  FailureDeliveryStatus,
  FailureRoutingRule,
} from '@activepieces/shared';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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

import { failureRoutingQueries } from '../hooks/failure-routing-hooks';

const STATUS_BADGE_CLASS: Record<FailureDeliveryStatus, string> = {
  [FailureDeliveryStatus.PENDING]: 'bg-amber-100 text-amber-800',
  [FailureDeliveryStatus.SUCCEEDED]: 'bg-emerald-100 text-emerald-800',
  [FailureDeliveryStatus.FAILED]: 'bg-red-100 text-red-800',
  [FailureDeliveryStatus.SKIPPED]: 'bg-gray-100 text-gray-700',
  [FailureDeliveryStatus.DEDUPLICATED]: 'bg-gray-100 text-gray-700',
};

type FailureDeliveriesDialogProps = {
  rule?: FailureRoutingRule;
  onOpenChange: (open: boolean) => void;
};

export const FailureDeliveriesDialog = ({
  rule,
  onOpenChange,
}: FailureDeliveriesDialogProps) => {
  const { data } = failureRoutingQueries.useDeliveries(
    rule ? { ruleId: rule.id } : {},
    rule !== undefined,
  );
  const deliveries = rule ? (data?.data ?? []) : [];

  return (
    <Dialog open={rule !== undefined} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            Recent deliveries{rule ? ` — ${rule.displayName}` : ''}
          </DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{'Status'}</TableHead>
                <TableHead>{'Run'}</TableHead>
                <TableHead>{'Category'}</TableHead>
                <TableHead>{'Attempt #'}</TableHead>
                <TableHead>{'Time'}</TableHead>
                <TableHead>{'Transport error'}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deliveries.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-6 text-center text-sm text-muted-foreground"
                  >
                    No deliveries recorded yet.
                  </TableCell>
                </TableRow>
              )}
              {deliveries.map((delivery) => (
                <TableRow key={delivery.id}>
                  <TableCell>
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        STATUS_BADGE_CLASS[delivery.status]
                      }`}
                    >
                      {delivery.status}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {delivery.flowRunId.slice(0, 10)}…
                  </TableCell>
                  <TableCell className="text-xs">{delivery.category}</TableCell>
                  <TableCell className="text-xs">
                    {delivery.attempts}
                  </TableCell>
                  <TableCell className="text-xs">
                    {new Date(delivery.updated).toLocaleString()}
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate text-xs text-red-600">
                    {delivery.errorMessage ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="cursor-help">
                            {delivery.errorMessage}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>{delivery.errorMessage}</TooltipContent>
                      </Tooltip>
                    ) : (
                      ''
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
};
