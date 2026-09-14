import { isNil } from '@activepieces/core-utils';
import { AgentPieceTool, mcpToolNameUtils } from '@activepieces/shared';
import { t } from 'i18next';
import { Link2, Plus, Puzzle, ShieldQuestion, X } from 'lucide-react';
import { useMemo } from 'react';

import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { appConnectionsQueries } from '@/features/connections/hooks/app-connections-hooks';
import { stepsHooks } from '@/features/pieces/hooks/steps-hooks';
import { PieceStepMetadataWithSuggestions } from '@/features/pieces/types';
import { authenticationSession } from '@/lib/authentication-session';
import { cn } from '@/lib/utils';

import { pieceActionRequirements } from '../lib/agent-tool-requirements';
import { agentToolAccount } from '../lib/agent-tool-account';
import { usePieceToolsDialogStore } from '../stores/pieces-tools';
import { useSortableToolRow } from './sortable-tool-row';

const CONNECTION_PAGE_SIZE = 1000;

type AgentPieceToolProps = {
  disabled?: boolean;
  tools: AgentPieceTool[];
  removeTool: (toolName: string) => void;
  sortable?: boolean;
};

export const AgentPieceToolComponent = ({
  disabled,
  tools,
  removeTool,
  sortable,
}: AgentPieceToolProps) => {
  const sortableRow = useSortableToolRow();
  const dragHandle = sortable ? sortableRow?.handle : null;
  const { openAddPieceToolDialog } = usePieceToolsDialogStore();

  const { metadata } = stepsHooks.useAllStepsMetadata({
    searchQuery: '',
    type: 'action',
  });

  const piecesMetadata = useMemo(() => {
    return metadata?.filter(
      (m): m is PieceStepMetadataWithSuggestions =>
        'suggestedActions' in m && 'suggestedTriggers' in m,
    );
  }, [metadata]);

  const pieceMetadata = piecesMetadata?.find(
    (p) => p.pieceName === tools[0].pieceMetadata.pieceName,
  );

  // One project-wide query keyed only on the project, so every tool row on the screen shares a
  // single cache entry with the rest of the app instead of each fetching the same list again.
  const projectId = authenticationSession.getProjectId()!;
  const {
    data: connections,
    isSuccess,
    isFetching,
  } = appConnectionsQueries.useAppConnections({
    request: { projectId, limit: CONNECTION_PAGE_SIZE },
    extraKeys: [projectId],
    enabled: !isNil(pieceMetadata?.auth),
  });
  const connectionsComplete = agentToolAccount.listIsComplete({
    isSuccess,
    isFetching,
    count: connections?.data.length ?? 0,
    pageSize: CONNECTION_PAGE_SIZE,
  });

  if (!pieceMetadata) {
    return (
      <div className="flex  w-full items-center justify-between px-3 h-12  border-b last:border-0 py-2">
        <div className="flex items-center gap-3">
          <Skeleton className="h-6 w-6 rounded-md" />
          <Skeleton className="h-4 w-32" />
        </div>

        <Skeleton className="h-4 w-4 rounded-sm" />
      </div>
    );
  }

  const toolsNeedingAccount = tools.filter((tool) =>
    agentToolAccount.requiresAccount({
      pieceHasAuth: !isNil(pieceMetadata.auth),
      actionRequireAuth: pieceMetadata.suggestedActions?.find(
        (action) => action.name === tool.pieceMetadata.actionName,
      )?.requireAuth,
    }),
  );
  const account = agentToolAccount.resolve({
    tools: toolsNeedingAccount,
    connections: connections?.data ?? [],
    connectionsComplete,
  });
  const accountText =
    account?.state === 'connected' && account.text === pieceMetadata.displayName
      ? t('Connected')
      : account?.text;

  const handleEditTool = (tool: AgentPieceTool) => {
    openAddPieceToolDialog({ page: 'action-inputs', tool });
  };

  return (
    <AccordionItem
      value={pieceMetadata.pieceName}
      ref={sortable ? sortableRow?.setNodeRef : undefined}
      style={sortable ? sortableRow?.style : undefined}
      className={cn(
        'border-b last:border-0',
        sortable &&
          sortableRow?.isDragging &&
          'relative z-10 opacity-80 shadow-md',
      )}
    >
      <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-accent transition-all">
        <div className="flex w-full items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            {sortable && dragHandle && (
              <span onClick={(event) => event.stopPropagation()}>
                {dragHandle}
              </span>
            )}
            <div className="h-8 w-8 shrink-0 rounded-md bg-muted flex items-center justify-center">
              {pieceMetadata.logoUrl ? (
                <img
                  src={pieceMetadata.logoUrl}
                  alt={pieceMetadata.displayName}
                  className="h-5 w-5 object-contain"
                />
              ) : (
                <Puzzle className="h-5 w-5 text-muted-foreground" />
              )}
            </div>

            <span className="truncate text-sm font-medium">
              {pieceMetadata.displayName}
            </span>
          </div>
          {!isNil(account) && (
            <span className="ms-3 flex min-w-0 shrink items-center gap-1.5 text-xs text-muted-foreground">
              <span
                className={cn(
                  'size-[6px] shrink-0 rounded-full',
                  account.state === 'connected' && 'bg-success',
                  account.state === 'deleted' && 'bg-destructive',
                  account.state === 'missing' && 'bg-warning',
                  account.state === 'mixed' && 'bg-muted-foreground',
                )}
              />
              <span className="truncate">{accountText}</span>
            </span>
          )}
        </div>
      </AccordionTrigger>
      <AccordionContent className="px-4 py-2">
        <div className="flex flex-wrap gap-2">
          {tools.map((tool) => {
            const action = pieceMetadata.suggestedActions?.find(
              (candidate) =>
                mcpToolNameUtils.createPieceToolName(
                  pieceMetadata.pieceName,
                  candidate.name,
                ) === tool.toolName,
            );
            const toolName = action?.displayName;
            const pinnedExternalId = tool.pieceMetadata.predefinedInput?.auth;
            const requirements = pieceActionRequirements({
              actionName: tool.pieceMetadata.actionName,
              needsConnection: agentToolAccount.requiresAccount({
                pieceHasAuth: !isNil(pieceMetadata.auth),
                actionRequireAuth: action?.requireAuth,
              }),
            });
            const connectionMissing = requirements.some(
              (requirement) => requirement.kind === 'connection',
            )
              ? isNil(pinnedExternalId) ||
                isNil(
                  connections?.data.find(
                    (connection) => connection.externalId === pinnedExternalId,
                  ),
                )
              : false;
            return (
              <div
                key={tool.toolName}
                onClick={() => handleEditTool(tool)}
                className={`
                  group flex items-center gap-1.5 px-3 py-1 cursor-pointer
                  rounded-full border bg-muted/50
                  ${disabled ? 'opacity-50 pointer-events-none' : ''}
                `}
              >
                <span className="text-xs font-medium">
                  {toolName || tool.toolName}
                </span>
                {requirements.map((requirement) => (
                  <Tooltip key={requirement.kind}>
                    <TooltipTrigger
                      asChild
                      onClick={(event) => event.stopPropagation()}
                    >
                      <span
                        className={cn(
                          'flex size-4 items-center justify-center rounded-full',
                          requirement.kind === 'connection'
                            ? connectionMissing
                              ? 'bg-destructive/10 text-destructive'
                              : 'bg-success/10 text-success'
                            : 'bg-muted text-muted-foreground',
                        )}
                      >
                        {requirement.kind === 'connection' ? (
                          <Link2 className="size-2.5" />
                        ) : (
                          <ShieldQuestion className="size-2.5" />
                        )}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{requirement.label}</TooltipContent>
                  </Tooltip>
                ))}

                <div className="flex items-center gap-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        disabled={disabled}
                        onClick={(e) => {
                          e.stopPropagation();
                          removeTool(tool.toolName);
                        }}
                        variant="ghost"
                        size="icon"
                        className="
                          size-5 p-0.5
                          text-muted-foreground
                          hover:text-destructive
                          hover:bg-destructive/10
                          transition
                        "
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t('Remove tool')}</TooltipContent>
                  </Tooltip>
                </div>
              </div>
            );
          })}
        </div>
        <Button
          variant="link"
          className="mt-4"
          size="xs"
          onClick={() =>
            openAddPieceToolDialog({
              page: 'actions-list',
              piece: pieceMetadata,
            })
          }
        >
          <Plus className="size-3 mr-1" />
          {t('Add Action')}
        </Button>
      </AccordionContent>
    </AccordionItem>
  );
};
