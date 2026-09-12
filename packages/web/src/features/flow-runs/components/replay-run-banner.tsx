import { FlowRun } from '@activepieces/shared';
import { useQuery } from '@tanstack/react-query';
import { t } from 'i18next';
import { History, RotateCcw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { FormattedDate } from '@/components/custom/formatted-date';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card';
import { Button } from '@/components/ui/button';
import { flowRunsApi } from '@/features/flow-runs/api/flow-runs-api';
import { flowRunUtils } from '@/features/flow-runs/utils/flow-run-utils';
import { authenticationSession } from '@/lib/authentication-session';
import { cn } from '@/lib/utils';

type ReplayRunBannerProps = {
    run: FlowRun;
};

export const ReplayAssociationIndicator = ({ run }: ReplayRunBannerProps) => {
    const navigate = useNavigate();
    const targetRunId = run.replayOfRunId;
    if (!targetRunId) {
        return null;
    }
    return (
        <HoverCard openDelay={150} closeDelay={100}>
            <HoverCardTrigger
                className="mr-2 inline-flex cursor-pointer items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary"
                onClick={() =>
                    navigate(
                        authenticationSession.appendProjectRoutePrefix(
                            `/runs/${targetRunId}`,
                        ),
                    )
                }
                asChild
            >
                <span>
                    <History className="size-3" />
                    {t('Replay')}
                </span>
            </HoverCardTrigger>
            <HoverCardContent className="w-auto p-3 text-xs">
                <div className="flex flex-col gap-1">
                    <span className="font-medium">
                        {t('Test replay of historical run')}
                    </span>
                    <button
                        className="font-mono text-[11px] text-primary underline-offset-2 hover:underline"
                        onClick={() =>
                            navigate(
                                authenticationSession.appendProjectRoutePrefix(
                                    `/runs/${targetRunId}`,
                                ),
                            )
                        }
                    >
                        {targetRunId}
                    </button>
                </div>
            </HoverCardContent>
        </HoverCard>
    );
};

export const SourceRunReplaysBanner = ({ run }: ReplayRunBannerProps) => {
    const projectId = authenticationSession.getProjectId();
    const { data: replays } = useQuery<FlowRun[], Error>({
        queryKey: ['flow-run-replays', run.id],
        queryFn: () => flowRunsApi.listReplays(run.id),
        enabled: !!projectId,
        staleTime: 30_000,
    });

    if (!replays || replays.length === 0) {
        return null;
    }
    return (
        <div className="absolute top-[64px] z-40 flex w-full justify-center px-2">
            <div className="w-full animate-fade">
                <div className="flex flex-col gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
                        <RotateCcw className="size-3.5 shrink-0" />
                        {t('{{count}} test replay(s) created from this run', {
                            count: replays.length,
                        })}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        {replays.map((replay) => (
                            <ReplayChip key={replay.id} run={replay} />
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

const ReplayChip = ({ run }: { run: FlowRun }) => {
    const navigate = useNavigate();
    const { Icon, variant } = flowRunUtils.getStatusIcon(run.status);
    return (
        <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() =>
                navigate(
                    authenticationSession.appendProjectRoutePrefix(`/runs/${run.id}`),
                )
            }
        >
            <Icon
                className={cn('size-3.5', {
                    'text-success': variant === 'success',
                    'text-destructive': variant === 'error',
                })}
            />
            <FormattedDate date={new Date(run.created)} includeTime={true} />
        </Button>
    );
};
