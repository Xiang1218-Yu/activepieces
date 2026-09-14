import { Agent, AgentToolType, McpAuthType } from '@activepieces/shared';
import { t } from 'i18next';
import {
  CheckCircle2,
  CircleSlash,
  Link2,
  ShieldQuestion,
  SlidersHorizontal,
  Unplug,
  XCircle,
} from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { appConnectionsQueries } from '@/features/connections/hooks/app-connections-hooks';
import { stepsHooks } from '@/features/pieces/hooks/steps-hooks';
import { PieceStepMetadataWithSuggestions } from '@/features/pieces/types';
import { pieceActionRequirements } from '@/features/agents/lib/agent-tool-requirements';
import { authenticationSession } from '@/lib/authentication-session';
import { cn } from '@/lib/utils';

import { useSessionToolStore } from './stores/session-disabled-tools';

const CONNECTION_PAGE_SIZE = 1000;

type SessionToolsPopoverProps = {
  agent: Agent;
  children?: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
};

type RowModel = {
  toolName: string;
  title: string;
  subtitle?: string;
  needsConnection: boolean;
  connectionMissing: boolean;
  needsApproval: boolean;
};

function usePieceMetadata() {
  const { metadata } = stepsHooks.useAllStepsMetadata({
    searchQuery: '',
    type: 'action',
  });
  return useMemo(
    () =>
      metadata?.filter(
        (m): m is PieceStepMetadataWithSuggestions =>
          'suggestedActions' in m && 'suggestedTriggers' in m,
      ) ?? [],
    [metadata],
  );
}

// Every row in the saved tools order. A connection the tool depends on may be missing, and a write
// action may ask for approval — those conditions are shown here, but they switch the single tool
// off rather than making the conversation disappear.
export const SessionToolsPopover = ({
  agent,
  children,
  side = 'top',
  align = 'start',
}: SessionToolsPopoverProps) => {
  const [open, setOpen] = useState(false);
  const piecesMetadata = usePieceMetadata();
  const projectId = authenticationSession.getProjectId()!;
  // The run reads the published configuration and only falls back to the draft, so the switch list
  // follows the same one.
  const running = agent.published ?? agent.draft;
  // Only pieces with auth can ever need the list, so skip the query entirely for no-auth agents.
  const anyNeedsConnection = running.tools.some((tool) => {
    if (tool.type !== AgentToolType.PIECE) {
      return tool.type === AgentToolType.MCP
        ? tool.auth.type !== McpAuthType.NONE
        : false;
    }
    const piece = piecesMetadata.find(
      (candidate) => candidate.pieceName === tool.pieceMetadata.pieceName,
    );
    const action = piece?.suggestedActions?.find(
      (candidate) => candidate.name === tool.pieceMetadata.actionName,
    );
    return !!piece?.auth && action?.requireAuth !== false;
  });
  const { data: connections } = appConnectionsQueries.useAppConnections({
    request: { projectId, limit: CONNECTION_PAGE_SIZE },
    extraKeys: [projectId],
    enabled: anyNeedsConnection,
  });
  const connectionExists = new Set(
    (connections?.data ?? []).map((connection) => connection.externalId),
  );

  const disabledNames = useSessionToolStore((state) =>
    state.disabledNames(agent.id),
  );
  const toggle = useSessionToolStore((state) => state.toggle);
  const setMany = useSessionToolStore((state) => state.setMany);
  const reset = useSessionToolStore((state) => state.reset);

  const rows: RowModel[] = useMemo(() => {
    const pieceByName = new Map(
      piecesMetadata.map((piece) => [piece.pieceName, piece]),
    );
    return running.tools.flatMap((tool): RowModel[] => {
      if (tool.type === AgentToolType.PIECE) {
        const piece = pieceByName.get(tool.pieceMetadata.pieceName);
        const action = piece?.suggestedActions?.find(
          (candidate) => candidate.name === tool.pieceMetadata.actionName,
        );
        const needsConnection = !!piece?.auth && action?.requireAuth !== false;
        const pinnedExternalId = tool.pieceMetadata.predefinedInput?.auth;
        return [
          {
            toolName: tool.toolName,
            title: action?.displayName ?? tool.pieceMetadata.actionName,
            subtitle: piece?.displayName ?? tool.pieceMetadata.pieceName,
            needsConnection,
            connectionMissing:
              needsConnection &&
              (!pinnedExternalId || !connectionExists.has(pinnedExternalId)),
            needsApproval: pieceActionRequirements({
              actionName: tool.pieceMetadata.actionName,
              needsConnection,
            }).some((requirement) => requirement.kind === 'approval'),
          },
        ];
      }
      if (tool.type === AgentToolType.FLOW) {
        return [
          {
            toolName: tool.toolName,
            title: tool.flowDisplayName ?? tool.toolName,
            subtitle: t('Flow'),
            needsConnection: false,
            connectionMissing: false,
            needsApproval: false,
          },
        ];
      }
      if (tool.type === AgentToolType.MCP) {
        return [
          {
            toolName: tool.toolName,
            title: tool.toolName,
            subtitle: t('MCP server'),
            needsConnection: tool.auth.type !== McpAuthType.NONE,
            connectionMissing: false,
            needsApproval: false,
          },
        ];
      }
      return [
        {
          toolName: tool.toolName,
          title: tool.sourceName,
          subtitle: t('Knowledge'),
          needsConnection: false,
          connectionMissing: false,
          needsApproval: false,
        },
      ];
    });
  }, [running.tools, piecesMetadata, connectionExists]);

  const disabledSet = useMemo(() => new Set(disabledNames), [disabledNames]);
  const enabledCount = rows.filter(
    (row) => !disabledSet.has(row.toolName),
  ).length;

  const trigger = children ?? (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-8 gap-1.5 rounded-lg"
      aria-label={t('Manage tools for this session')}
    >
      <SlidersHorizontal className="size-3.5" />
      <span className="text-xs font-medium">
        {t('Tools')}
        <span className="ms-1 text-muted-foreground">
          {enabledCount}/{rows.length}
        </span>
      </span>
    </Button>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent side={side} align={align} className="w-[340px] p-0">
        <div className="flex items-center justify-between gap-2 border-b border-border px-3.5 py-2.5">
          <div className="flex flex-col gap-0.5">
            <span className="text-[13px] font-semibold leading-4">
              {t('Tools for this session')}
            </span>
            <span className="text-[11px] leading-4 text-muted-foreground">
              {t('Switches apply to your next message and are not saved.')}
            </span>
          </div>
          {disabledNames.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => reset(agent.id)}
            >
              {t('Reset')}
            </Button>
          )}
        </div>
        <div className="max-h-[300px] overflow-y-auto p-1.5">
          {rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-3 py-6 text-center">
              <Unplug className="size-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                {t('This agent has no tools yet.')}
              </span>
            </div>
          ) : (
            rows.map((row) => {
              const turnedOff = disabledSet.has(row.toolName);
              return (
                <div
                  key={row.toolName}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-2 py-1.5',
                    turnedOff && 'opacity-55',
                  )}
                >
                  <CircleSlash
                    className={cn(
                      'size-3.5 shrink-0',
                      turnedOff ? 'text-destructive' : 'text-border',
                    )}
                  />
                  <div className="flex min-w-0 grow flex-col">
                    <span className="truncate text-[13px] font-medium leading-4">
                      {row.title}
                    </span>
                    {row.subtitle && (
                      <span className="truncate text-[11px] leading-4 text-muted-foreground">
                        {row.subtitle}
                      </span>
                    )}
                  </div>
                  <RequirementBadges row={row} />
                  <Switch
                    checked={!turnedOff}
                    onCheckedChange={(value) =>
                      toggle(agent.id, row.toolName, !value)
                    }
                  />
                </div>
              );
            })
          )}
        </div>
        {rows.length > 0 && (
          <div className="flex items-center justify-between border-t border-border px-3.5 py-2">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() =>
                setMany(
                  agent.id,
                  rows.map((row) => row.toolName),
                )
              }
            >
              <XCircle className="me-1 size-3" />
              {t('Turn all off')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => setMany(agent.id, [])}
            >
              <CheckCircle2 className="me-1 size-3" />
              {t('Turn all on')}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};

const RequirementBadges = ({ row }: { row: RowModel }) => (
  <div className="flex shrink-0 items-center gap-1">
    {row.needsConnection && (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              'flex size-5 items-center justify-center rounded-full',
              row.connectionMissing
                ? 'bg-destructive/10 text-destructive'
                : 'bg-success/10 text-success',
            )}
          >
            <Link2 className="size-3" />
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {row.connectionMissing
            ? t('Requires a connection that is missing')
            : t('Requires a connection')}
        </TooltipContent>
      </Tooltip>
    )}
    {row.needsApproval && (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex size-5 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <ShieldQuestion className="size-3" />
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {t('Asks for approval before changing things')}
        </TooltipContent>
      </Tooltip>
    )}
  </div>
);
