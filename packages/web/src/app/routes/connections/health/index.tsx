import { Permission } from '@activepieces/core-utils';
import {
  AppConnectionScope,
  AppConnectionStatus,
  ConnectionHealthItem,
  ConnectionHealthSuggestedAction,
  PlatformRole,
} from '@activepieces/shared';
import { ColumnDef } from '@tanstack/react-table';
import { t } from 'i18next';
import {
  Activity,
  CheckIcon,
  Clock,
  Folder,
  Globe,
  HeartPulse,
  Puzzle,
  Search,
  Unplug,
  Workflow,
} from 'lucide-react';
import { useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { ReconnectButtonDialog } from '@/app/connections/reconnect-button-dialog';
import { CopyTextTooltip } from '@/components/custom/clipboard/copy-text-tooltip';
import {
  CURSOR_QUERY_PARAM,
  DataTable,
  DataTableFilters,
  LIMIT_QUERY_PARAM,
  RowDataWithActions,
} from '@/components/custom/data-table';
import { DataTableColumnHeader } from '@/components/custom/data-table/data-table-column-header';
import { FormattedDate } from '@/components/custom/formatted-date';
import { StatusIconWithText } from '@/components/custom/status-icon-with-text';
import { TextWithTooltip } from '@/components/custom/text-with-tooltip';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  RevalidateConnectionButton,
  appConnectionsQueries,
  appConnectionUtils,
} from '@/features/connections';
import { PieceIconWithPieceName, piecesHooks } from '@/features/pieces';
import { getProjectName, projectCollectionUtils } from '@/features/projects';
import { useAuthorization } from '@/hooks/authorization-hooks';
import { userHooks } from '@/hooks/user-hooks';
import { authenticationSession } from '@/lib/authentication-session';
import { formatUtils } from '@/lib/format-utils';

const suggestedActionConfig: Record<
  ConnectionHealthSuggestedAction,
  {
    variant: 'outline' | 'destructive' | 'warning' | 'info';
    label: string;
  }
> = {
  [ConnectionHealthSuggestedAction.NONE]: {
    variant: 'outline',
    label: t('None'),
  },
  [ConnectionHealthSuggestedAction.RECONNECT]: {
    variant: 'destructive',
    label: t('Reconnect'),
  },
  [ConnectionHealthSuggestedAction.COMPLETE_SETUP]: {
    variant: 'warning',
    label: t('Complete Setup'),
  },
  [ConnectionHealthSuggestedAction.UPDATE_PIECE_VERSION]: {
    variant: 'info',
    label: t('Update Piece Version'),
  },
};

function ConnectionHealthPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { checkAccess } = useAuthorization();
  const userPlatformRole = userHooks.getCurrentUserPlatformRole();
  const { pieces } = piecesHooks.usePieces({});
  const { data: projects } = projectCollectionUtils.useAllPlatformProjects();
  const projectId = authenticationSession.getProjectId()!;

  const searchParams = new URLSearchParams(location.search);
  const cursor = searchParams.get(CURSOR_QUERY_PARAM) ?? undefined;
  const limit = searchParams.get(LIMIT_QUERY_PARAM)
    ? parseInt(searchParams.get(LIMIT_QUERY_PARAM)!)
    : 10;
  const status = (searchParams.getAll('status') as AppConnectionStatus[]) ?? [];
  const pieceName = searchParams.get('pieceName') ?? undefined;
  const displayName = searchParams.get('displayName') ?? undefined;
  const projectIds = searchParams.getAll('projectIds');

  const {
    data: health,
    isLoading,
    isError,
    refetch,
  } = appConnectionsQueries.useConnectionHealth({
    request: {
      projectId,
      cursor,
      limit,
      status,
      pieceName,
      displayName,
      projectIds: projectIds.length > 0 ? projectIds : undefined,
    },
    extraKeys: [location.search, projectId],
  });

  const userHasPermissionToWriteAppConnection = checkAccess(
    Permission.WRITE_APP_CONNECTION,
  );

  const filters: DataTableFilters<keyof ConnectionHealthItem | 'projectIds'>[] =
    [
      {
        type: 'input',
        title: t('Name'),
        accessorKey: 'displayName',
        icon: Search,
      },
      {
        type: 'select',
        title: t('Status'),
        accessorKey: 'status',
        options: Object.values(AppConnectionStatus).map((status) => ({
          label: formatUtils.convertEnumToHumanReadable(status),
          value: status,
        })),
        icon: CheckIcon,
      },
      {
        type: 'select',
        title: t('Pieces'),
        accessorKey: 'pieceName',
        icon: Puzzle,
        options: (pieces ?? []).map((piece) => ({
          label: piece.displayName,
          value: piece.name,
        })),
      },
      {
        type: 'select',
        title: t('Project'),
        accessorKey: 'projectIds',
        icon: Folder,
        options: (projects ?? []).map((project) => ({
          label: getProjectName(project),
          value: project.id,
        })),
      },
    ];

  const columns: ColumnDef<
    RowDataWithActions<ConnectionHealthItem>,
    unknown
  >[] = [
    {
      accessorKey: 'displayName',
      size: 280,
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t('Name')}
          icon={Puzzle}
        />
      ),
      cell: ({ row }) => {
        const isPlatformConnection =
          row.original.scope === AppConnectionScope.PLATFORM;
        const accountIdentifier =
          appConnectionUtils.getConnectionAccountIdentifier(row.original);
        return (
          <div className="flex items-center gap-2 min-w-0">
            <CopyTextTooltip
              title={t('External ID')}
              text={row.original.externalId || ''}
            >
              <span className="shrink-0">
                <PieceIconWithPieceName
                  pieceName={row.original.pieceName}
                  showTooltip={false}
                  size="sm"
                />
              </span>
            </CopyTextTooltip>
            <div className="flex flex-col min-w-0">
              <TextWithTooltip tooltipMessage={row.original.displayName}>
                <span className="min-w-0">{row.original.displayName}</span>
              </TextWithTooltip>
              {accountIdentifier && (
                <span className="truncate text-xs text-muted-foreground">
                  {accountIdentifier}
                </span>
              )}
            </div>
            {isPlatformConnection && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Globe className="w-4 h-4 shrink-0" />
                </TooltipTrigger>
                <TooltipContent>
                  <p>
                    {t(
                      'This connection is global and can be managed in the platform admin',
                    )}
                  </p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: 'status',
      size: 120,
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t('Status')}
          icon={Activity}
        />
      ),
      cell: ({ row }) => {
        const status = row.original.status;
        const { variant, icon: Icon } =
          appConnectionUtils.getStatusIcon(status);
        return (
          <div className="text-left">
            <StatusIconWithText
              icon={Icon}
              text={formatUtils.convertEnumToHumanReadable(status)}
              variant={variant}
            />
          </div>
        );
      },
    },
    {
      accessorKey: 'lastValidatedAt',
      size: 150,
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t('Last Validated')}
          icon={Clock}
        />
      ),
      cell: ({ row }) => {
        const lastValidatedAt = row.original.lastValidatedAt;
        if (!lastValidatedAt) {
          return <span className="text-muted-foreground">{t('Never')}</span>;
        }
        return (
          <div className="text-left">
            <FormattedDate date={new Date(lastValidatedAt)} />
          </div>
        );
      },
    },
    {
      accessorKey: 'flowCount',
      size: 80,
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t('Flows')}
          icon={Workflow}
        />
      ),
      cell: ({ row }) => {
        return (
          <div
            className="text-left underline cursor-pointer"
            onClick={() => {
              navigate(
                authenticationSession.appendProjectRoutePrefix(
                  `/automations?connection=${encodeURIComponent(
                    row.original.externalId,
                  )}`,
                ),
              );
            }}
          >
            {row.original.flowCount}
          </div>
        );
      },
    },
    {
      accessorKey: 'suggestedAction',
      size: 160,
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t('Suggested Action')}
          icon={HeartPulse}
        />
      ),
      cell: ({ row }) => {
        const action = suggestedActionConfig[row.original.suggestedAction];
        return <Badge variant={action.variant}>{action.label}</Badge>;
      },
    },
    {
      id: 'actions',
      size: 100,
      cell: ({ row }) => {
        const isPlatformConnection =
          row.original.scope === AppConnectionScope.PLATFORM;
        const userHasPermissionToManage = isPlatformConnection
          ? userPlatformRole === PlatformRole.ADMIN
          : userHasPermissionToWriteAppConnection;
        return (
          <div className="flex items-center gap-2 justify-end">
            {userHasPermissionToManage && (
              <RevalidateConnectionButton connectionId={row.original.id} />
            )}
            <ReconnectButtonDialog
              hasPermission={userHasPermissionToManage}
              connection={row.original}
              onConnectionCreated={() => {
                refetch();
              }}
            />
          </div>
        );
      },
    },
  ];

  const toolbarButtons = useMemo(
    () => [
      <Link
        key="all-connections"
        to={authenticationSession.appendProjectRoutePrefix('/connections')}
      >
        <Button variant="outline" size="sm">
          <Unplug className="mr-2 h-4 w-4" />
          {t('All Connections')}
        </Button>
      </Link>,
    ],
    [],
  );

  return (
    <div className="flex-col w-full">
      <DataTable
        emptyStateTextTitle={t('No connections found')}
        emptyStateTextDescription={t(
          'Connections created in this project or shared with it will appear here with their health status',
        )}
        emptyStateIcon={<HeartPulse className="size-14" />}
        columns={columns}
        page={health}
        isLoading={isLoading}
        isError={isError}
        errorStateEntity={t('connections')}
        onRetry={refetch}
        filters={filters}
        toolbarButtons={toolbarButtons}
      />
    </div>
  );
}

export { ConnectionHealthPage };
