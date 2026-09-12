import { AppConnectionScope } from '@activepieces/shared';
import { t } from 'i18next';
import { ArrowLeft, Globe, User } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';

import { CopyTextTooltip } from '@/components/custom/clipboard/copy-text-tooltip';
import { DataFetchErrorState } from '@/components/custom/data-fetch-error-state';
import { FormattedDate } from '@/components/custom/formatted-date';
import { PageHeader } from '@/components/custom/page-header';
import { LoadingSpinner } from '@/components/custom/spinner';
import { StatusIconWithText } from '@/components/custom/status-icon-with-text';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  appConnectionUtils,
  appConnectionsQueries,
} from '@/features/connections';
import { PieceIconWithPieceName } from '@/features/pieces';
import { authenticationSession } from '@/lib/authentication-session';
import { formatUtils } from '@/lib/format-utils';

export function AppConnectionDetailPage() {
  const { connectionId } = useParams<{ connectionId: string }>();
  const {
    data: connection,
    isLoading,
    isError,
    refetch,
  } = appConnectionsQueries.useAppConnection(connectionId);

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <LoadingSpinner className="size-8" />
      </div>
    );
  }

  if (isError || !connection) {
    return (
      <div className="flex h-full w-full flex-col">
        <PageHeader title={t('Connection')} />
        <DataFetchErrorState
          entity={t('connection')}
          onRetry={refetch}
          className="h-full"
        />
      </div>
    );
  }

  const statusIcon = appConnectionUtils.getStatusIcon(connection.status);
  const accountIdentifier =
    appConnectionUtils.getConnectionAccountIdentifier(connection);

  return (
    <div className="flex h-full w-full flex-col">
      <PageHeader
        title={connection.displayName}
        description={connection.pieceName}
        leftContent={
          <Button variant="ghost" size="icon" asChild>
            <Link
              to={authenticationSession.appendProjectRoutePrefix(
                '/connections',
              )}
              aria-label={t('Back to connections')}
            >
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
        }
      />
      <div className="px-4 pb-4">
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-3">
              <PieceIconWithPieceName
                pieceName={connection.pieceName}
                size="lg"
                showTooltip={false}
              />
              <span className="truncate">{connection.displayName}</span>
              <StatusIconWithText
                icon={statusIcon.icon}
                text={formatUtils.convertEnumToHumanReadable(connection.status)}
                variant={statusIcon.variant}
              />
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <DetailRow label={t('Name')}>
              <CopyTextTooltip text={connection.externalId} title={t('Name')}>
                <span className="font-mono text-sm">
                  {connection.externalId}
                </span>
              </CopyTextTooltip>
            </DetailRow>
            <DetailRow label={t('Piece')}>
              <span className="flex items-center gap-2">
                <PieceIconWithPieceName
                  pieceName={connection.pieceName}
                  size="sm"
                />
                <span>{connection.pieceName}</span>
              </span>
            </DetailRow>
            <DetailRow label={t('Scope')}>
              <span className="flex items-center gap-2">
                <Globe className="size-4 text-muted-foreground" />
                {connection.scope === AppConnectionScope.PLATFORM
                  ? t('Platform')
                  : t('Project')}
              </span>
            </DetailRow>
            {accountIdentifier && (
              <DetailRow label={t('Account')}>
                <span>{accountIdentifier}</span>
              </DetailRow>
            )}
            {connection.owner && (
              <DetailRow label={t('Owner')}>
                <span className="flex items-center gap-2">
                  <User className="size-4 text-muted-foreground" />
                  {connection.owner.email}
                </span>
              </DetailRow>
            )}
            <DetailRow label={t('Created')}>
              <FormattedDate date={new Date(connection.created)} includeTime />
            </DetailRow>
            <DetailRow label={t('Last updated')}>
              <FormattedDate date={new Date(connection.updated)} includeTime />
            </DetailRow>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b pb-3 last:border-b-0 last:pb-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{children}</span>
    </div>
  );
}
