import { isNil } from '@activepieces/core-utils';
import {
  FlowRun,
  FlowRunReplayBlocker,
  FlowRunReplayBlockerCode,
  FlowRunReplayStep,
  PrepareReplayResponse,
} from '@activepieces/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { t } from 'i18next';
import {
  AlertTriangle,
  CheckCircle2,
  History,
  Loader2,
  PlugZap,
  Play,
  Zap,
} from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { JsonViewer } from '@/components/custom/json-viewer';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { flowRunsApi } from '@/features/flow-runs/api/flow-runs-api';
import { authenticationSession } from '@/lib/authentication-session';
import { cn } from '@/lib/utils';

type ReplayWorkbenchDialogProps = {
  run: FlowRun | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export const ReplayWorkbenchDialog = ({
  run,
  open,
  onOpenChange,
}: ReplayWorkbenchDialogProps) => {
    const navigate = useNavigate();
    const projectId = authenticationSession.getProjectId();
    const [showInputPreview, setShowInputPreview] = useState(false);

    const { data, isLoading, isError, refetch, isFetching } = useQuery<PrepareReplayResponse, Error>({
        queryKey: ['replay-prepare', run?.id],
        queryFn: () => flowRunsApi.prepareReplay(run!.id),
        enabled: open && run !== null,
        retry: false,
    });

    const createReplayMutation = useMutation<FlowRun, Error, void>({
        mutationFn: () =>
            flowRunsApi.createReplay(run!.id, {
                projectId: projectId!,
            }),
        onSuccess: (replayRun) => {
            onOpenChange(false);
            navigate(
                authenticationSession.appendProjectRoutePrefix(
                    `/runs/${replayRun.id}`,
                ),
            );
        },
        onError: () => {
            toast.error(t('Could not start the replay'), {
                description: t(
                    'The trigger input or a referenced file may have just expired. Run preparation again.',
                ),
            });
        },
    });

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="max-h-[85vh] max-w-2xl gap-0 p-0"
                onClick={(e) => e.stopPropagation()}
            >
                <DialogHeader className="px-6 pt-6">
                    <DialogTitle className="flex items-center gap-2 text-base">
                        <History className="size-4 text-primary" />
                        {t('Run Replay Workbench')}
                    </DialogTitle>
                    <DialogDescription>
                        {t(
                            'Re-sends the original trigger input to the exact flow version from this run, as an isolated test run. The production flow stays untouched.',
                        )}
                    </DialogDescription>
                </DialogHeader>

                <ScrollArea className="max-h-[55vh] px-6 py-4">
                    {isLoading && <ReplaySkeleton />}

                    {!isLoading && isError && (
                        <div className="flex flex-col items-center gap-3 py-8 text-center">
                            <AlertTriangle className="size-6 text-destructive" />
                            <p className="text-sm text-muted-foreground">
                                {t('Could not prepare the replay. Try again.')}
                            </p>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => refetch()}
                                loading={isFetching}
                            >
                                {t('Retry')}
                            </Button>
                        </div>
                    )}

                    {!isLoading && !isError && data && run && (
                        <div className="flex flex-col gap-4">
                            <ReplaySummary preparation={data} sourceRun={run} />
                            <ReplayStepList steps={data.steps} />
                            {data.canReplay && (
                                <div className="flex items-start gap-2 rounded-md border border-success/30 bg-success/10 p-3 text-xs">
                                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                                    <span>
                                        {t(
                                            'The historical version, trigger input and all connections are ready. Replay will run as a test run and create a separate run record.',
                                        )}
                                    </span>
                                </div>
                            )}
                            {!data.canReplay && (
                                <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs">
                                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
                                    <span>
                                        {t(
                                            'Fix the issues below before replaying. The start button is disabled until every blocker is resolved.',
                                        )}
                                    </span>
                                </div>
                            )}
                            <Button
                                variant="ghost"
                                size="sm"
                                className="w-fit px-1 text-xs"
                                onClick={() => setShowInputPreview((v) => !v)}
                            >
                                {showInputPreview
                                    ? t('Hide trigger input preview')
                                    : t('Preview trigger input')}
                            </Button>
                            {showInputPreview && <TriggerInputPreview run={run} />}
                        </div>
                    )}
                </ScrollArea>

                <DialogFooter className="border-t px-6 py-4">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        {t('Cancel')}
                    </Button>
                    <Button
                        onClick={() => createReplayMutation.mutate()}
                        disabled={!data?.canReplay || createReplayMutation.isPending}
                        loading={createReplayMutation.isPending}
                    >
                        {!createReplayMutation.isPending && (
                            <Play className="size-4" />
                        )}
                        {t('Start replay as test run')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

const ReplaySummary = ({
    preparation,
    sourceRun,
}: {
    preparation: PrepareReplayResponse;
    sourceRun: FlowRun;
}) => {
    return (
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-md border bg-muted/30 p-3 text-xs">
            <SummaryRow label={t('Source run')} value={sourceRun.id} mono />
            <SummaryRow
                label={t('Run date')}
                value={new Date(preparation.sourceRunCreated).toLocaleString()}
            />
            <SummaryRow
                label={t('Flow version')}
                value={preparation.flowVersionId}
                mono
            />
            <SummaryRow
                label={t('Steps to replay')}
                value={`${preparation.steps.length}`}
            />
        </div>
    );
};

const SummaryRow = ({
    label,
    value,
    mono,
}: {
    label: string;
    value: string;
    mono?: boolean;
}) => (
    <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn('truncate font-medium', mono && 'font-mono text-[11px]')}>
            {value}
        </span>
    </div>
);

const ReplayStepList = ({ steps }: { steps: FlowRunReplayStep[] }) => {
    return (
        <div className="flex flex-col gap-1.5">
            <p className="text-xs font-semibold text-muted-foreground">
                {t('Steps that will be replayed (pinned to the historical version)')}
            </p>
            {steps.map((step) => (
                <ReplayStepRow key={step.name} step={step} />
            ))}
        </div>
    );
};

const ReplayStepRow = ({ step }: { step: FlowRunReplayStep }) => {
    const hasBlockers = step.blockers.length > 0;
    return (
        <div
            className={cn(
                'flex items-start gap-3 rounded-md border px-3 py-2 text-xs',
                hasBlockers ? 'border-destructive/40 bg-destructive/5' : 'border-border',
            )}
        >
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
                {step.order}
            </span>
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    {step.isTrigger ? (
                        <Zap className="size-3.5 shrink-0 text-warning" />
                    ) : (
                        <Play className="size-3 shrink-0 text-muted-foreground" />
                    )}
                    <span className="truncate font-medium">{step.displayName}</span>
                    {step.pieceName && (
                        <span className="truncate text-[10px] text-muted-foreground">
                            {step.pieceName}
                            {step.pieceVersion ? `@${step.pieceVersion}` : ''}
                        </span>
                    )}
                </div>
                {step.connectionStatus && (
                    <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                        <PlugZap className="size-3" />
                        <ConnectionStatusPill status={step.connectionStatus} />
                    </div>
                )}
                {step.blockers.map((blocker, index) => (
                    <div
                        key={`${blocker.code}-${index}`}
                        className="mt-1.5 flex items-start gap-1.5 text-[11px] text-destructive"
                    >
                        <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                        <span>{blockerLabel(blocker)}</span>
                    </div>
                ))}
            </div>
            {!hasBlockers && <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />}
        </div>
    );
};

const ConnectionStatusPill = ({ status }: { status: string }) => {
    const isActive = status === 'ACTIVE';
    return (
        <span
            className={cn(
                'rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase',
                isActive
                    ? 'bg-success/15 text-success'
                    : 'bg-destructive/15 text-destructive',
            )}
        >
            {isActive ? t('Connection active') : t('Connection {status}', { status })}
        </span>
    );
};

function blockerLabel(blocker: FlowRunReplayBlocker): string {
    switch (blocker.code) {
        case FlowRunReplayBlockerCode.TRIGGER_PAYLOAD_MISSING:
            return t(
                'The original trigger input is no longer available (run logs expired or the trigger produced no output).',
            );
        case FlowRunReplayBlockerCode.TRIGGER_INPUT_FILE_EXPIRED:
            return t(
                'A file attached to the original trigger input has expired and cannot be re-sent. Re-upload it to a new run instead.',
            );
        case FlowRunReplayBlockerCode.CONNECTION_MISSING:
            return t(
                'The connection used by this step no longer exists. Reconnect the piece before replaying.',
            );
        case FlowRunReplayBlockerCode.CONNECTION_ERROR:
            return t(
                'The connection is in an error state (expired or revoked credentials). Re-authenticate before replaying.',
            );
        case FlowRunReplayBlockerCode.PIECE_UNAVAILABLE:
            return t(
                'The piece {{piece}} used by this step is no longer installed or visible in this project.',
                { piece: `${blocker.pieceName}@${blocker.pieceVersion}` },
            );
    }
}

const TriggerInputPreview = ({ run }: { run: FlowRun }) => {
    const [expanded, setExpanded] = useState(false);
    const triggerName = Object.keys(run.steps ?? {})[0];
    const triggerStep = triggerName ? run.steps?.[triggerName] : undefined;
    const output = triggerStep?.output;

    if (isNil(output)) {
        return (
            <p className="text-xs italic text-muted-foreground">
                {t('No trigger input was stored for this run.')}
            </p>
        );
    }
    return (
        <div
            className="cursor-pointer"
            onClick={() => setExpanded((v) => !v)}
        >
            {expanded ? (
                <JsonViewer
                    json={output}
                    title={t('Trigger input')}
                    className="max-h-72 overflow-auto"
                    hideDownload
                />
            ) : (
                <p className="truncate rounded-md border bg-muted/30 p-2 font-mono text-[11px] text-muted-foreground">
                    {JSON.stringify(output)}
                </p>
            )}
        </div>
    );
};

const ReplaySkeleton = () => (
    <div className="flex flex-col gap-3 py-2">
        <Skeleton className="h-20 w-full rounded-md" />
        <Loader2 className="size-4 animate-spin self-center text-muted-foreground" />
        <Skeleton className="h-12 w-full rounded-md" />
        <Skeleton className="h-12 w-full rounded-md" />
        <Skeleton className="h-12 w-3/4 rounded-md" />
    </div>
);
