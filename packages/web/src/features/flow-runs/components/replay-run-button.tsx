import { Permission } from '@activepieces/core-utils';
import { FlowRun } from '@activepieces/shared';
import { t } from 'i18next';
import { History } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ReplayWorkbenchDialog } from '@/features/flow-runs/components/replay-workbench-dialog';
import { useAuthorization } from '@/hooks/authorization-hooks';

type ReplayRunButtonProps = {
    run: FlowRun;
    variant?: 'button' | 'icon' | 'none';
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
};

export const ReplayRunButton = ({
    run,
    variant = 'button',
    open: controlledOpen,
    onOpenChange,
}: ReplayRunButtonProps) => {
    const [internalOpen, setInternalOpen] = useState(false);
    const open = controlledOpen ?? internalOpen;
    const setOpen = (value: boolean) => {
        setInternalOpen(value);
        onOpenChange?.(value);
    };
    const { checkAccess } = useAuthorization();
    const canWriteRun = checkAccess(Permission.WRITE_RUN);

    useEffect(() => {
        if (controlledOpen !== undefined) {
            setInternalOpen(controlledOpen);
        }
    }, [controlledOpen]);

    if (!canWriteRun) {
        return null;
    }

    return (
        <>
            {variant === 'button' && (
                <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5"
                    onClick={() => setOpen(true)}
                >
                    <History className="size-3.5" />
                    {t('Replay run')}
                </Button>
            )}
            {variant === 'icon' && (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="rounded-full"
                            onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setOpen(true);
                            }}
                        >
                            <History className="size-4" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t('Replay run')}</TooltipContent>
                </Tooltip>
            )}
            <ReplayWorkbenchDialog run={run} open={open} onOpenChange={setOpen} />
        </>
    );
};
