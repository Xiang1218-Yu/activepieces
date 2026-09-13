import {
  AgentConversationStatus,
  ChatHistoryArchiveFilter,
  ChatHistoryEntry,
  ChatHistoryResourceType,
} from '@activepieces/shared';
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import dayjs from 'dayjs';
import { t } from 'i18next';
import {
  Archive,
  ArchiveRestore,
  Bot,
  FileText,
  History,
  Lock,
  Plug,
  Search,
  Table2,
  Workflow,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useDebounce } from 'use-debounce';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { chatApi } from '@/features/chat/lib/chat-api';
import { chatUtils } from '@/features/chat/lib/chat-utils';
import { getProjectName, projectCollectionUtils } from '@/features/projects';
import { cn } from '@/lib/utils';

const ALL_FILTER = 'all';

const RESOURCE_TYPE_META: Record<
  ChatHistoryResourceType,
  { label: string; icon: typeof Workflow }
> = {
  [ChatHistoryResourceType.FLOW]: { label: t('Flows'), icon: Workflow },
  [ChatHistoryResourceType.FILE]: { label: t('Files'), icon: FileText },
  [ChatHistoryResourceType.CONNECTION]: { label: t('Connections'), icon: Plug },
  [ChatHistoryResourceType.TABLE]: { label: t('Tables'), icon: Table2 },
  [ChatHistoryResourceType.AGENT]: { label: t('Agents'), icon: Bot },
};

export function ChatHistoryPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: projects } = projectCollectionUtils.useAll();

  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword] = useDebounce(keyword, 300);
  const [projectId, setProjectId] = useState<string>(ALL_FILTER);
  const [status, setStatus] = useState<string>(ALL_FILTER);
  const [archived, setArchived] = useState<ChatHistoryArchiveFilter>(
    ChatHistoryArchiveFilter.ACTIVE,
  );
  const [resourceTypes, setResourceTypes] = useState<ChatHistoryResourceType[]>(
    [],
  );
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const filters = {
    q: debouncedKeyword.trim() || undefined,
    projectId: projectId === ALL_FILTER ? undefined : projectId,
    status:
      status === ALL_FILTER ? undefined : (status as AgentConversationStatus),
    resourceTypes: resourceTypes.length > 0 ? resourceTypes : undefined,
    archived,
    from: fromDate ? dayjs(fromDate).startOf('day').toISOString() : undefined,
    to: toDate ? dayjs(toDate).endOf('day').toISOString() : undefined,
  };

  const historyQuery = useInfiniteQuery({
    queryKey: ['chat-history', filters],
    queryFn: ({ pageParam }) =>
      chatApi.searchHistory({
        ...filters,
        cursor: pageParam,
        limit: 20,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next ?? undefined,
  });

  const { mutate: setConversationArchived } = useMutation({
    mutationFn: ({ id, archive }: { id: string; archive: boolean }) =>
      archive
        ? chatApi.archiveConversation(id)
        : chatApi.unarchiveConversation(id),
    onSuccess: (_conversation, { archive }) => {
      toast.success(
        archive ? t('Conversation archived') : t('Conversation unarchived'),
      );
    },
    onError: () => {
      toast.error(t('Failed to update the conversation'));
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['chat-history'] });
      void queryClient.invalidateQueries({ queryKey: ['chat-conversations'] });
    },
  });

  const entries = historyQuery.data?.pages.flatMap((page) => page.data) ?? [];

  const hasActiveFilters =
    !!debouncedKeyword.trim() ||
    projectId !== ALL_FILTER ||
    status !== ALL_FILTER ||
    archived !== ChatHistoryArchiveFilter.ACTIVE ||
    resourceTypes.length > 0 ||
    !!fromDate ||
    !!toDate;

  const resetFilters = () => {
    setKeyword('');
    setProjectId(ALL_FILTER);
    setStatus(ALL_FILTER);
    setArchived(ChatHistoryArchiveFilter.ACTIVE);
    setResourceTypes([]);
    setFromDate('');
    setToDate('');
  };

  const toggleResourceType = (type: ChatHistoryResourceType) => {
    setResourceTypes((prev) =>
      prev.includes(type)
        ? prev.filter((candidate) => candidate !== type)
        : [...prev, type],
    );
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="shrink-0 border-b px-4 sm:px-6 py-4 space-y-3">
        <div className="flex items-center gap-2">
          <History className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">{t('Chat history')}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder={t('Search titles, messages, files, errors...')}
              className="h-9 pl-8 text-sm"
            />
          </div>
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger className="h-9 w-[180px]">
              <SelectValue placeholder={t('All projects')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_FILTER}>{t('All projects')}</SelectItem>
              {(projects ?? []).map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {getProjectName(project)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-9 w-[150px]">
              <SelectValue placeholder={t('All statuses')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_FILTER}>{t('All statuses')}</SelectItem>
              <SelectItem value={AgentConversationStatus.IDLE}>
                {t('Finished')}
              </SelectItem>
              <SelectItem value={AgentConversationStatus.STREAMING}>
                {t('In progress')}
              </SelectItem>
              <SelectItem value={AgentConversationStatus.ERROR}>
                {t('Failed')}
              </SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={archived}
            onValueChange={(value) =>
              setArchived(value as ChatHistoryArchiveFilter)
            }
          >
            <SelectTrigger className="h-9 w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ChatHistoryArchiveFilter.ACTIVE}>
                {t('Active')}
              </SelectItem>
              <SelectItem value={ChatHistoryArchiveFilter.ARCHIVED}>
                {t('Archived')}
              </SelectItem>
              <SelectItem value={ChatHistoryArchiveFilter.ALL}>
                {t('Active + archived')}
              </SelectItem>
            </SelectContent>
          </Select>
          <Input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="h-9 w-[150px] text-sm"
            aria-label={t('From date')}
          />
          <span className="text-xs text-muted-foreground">–</span>
          <Input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="h-9 w-[150px] text-sm"
            aria-label={t('To date')}
          />
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="h-9 gap-1.5"
              onClick={resetFilters}
            >
              <X className="h-3.5 w-3.5" />
              {t('Clear')}
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground mr-1">
            {t('Produces')}:
          </span>
          {Object.values(ChatHistoryResourceType).map((type) => {
            const meta = RESOURCE_TYPE_META[type];
            const active = resourceTypes.includes(type);
            return (
              <button
                key={type}
                type="button"
                onClick={() => toggleResourceType(type)}
                className={cn(
                  'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors',
                  active
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:bg-accent',
                )}
              >
                <meta.icon className="h-3 w-3" />
                {meta.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
        {historyQuery.isLoading ? (
          <div className="space-y-3 max-w-4xl mx-auto">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-24 w-full rounded-lg" />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <History className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium">
              {hasActiveFilters
                ? t('No conversations match these filters')
                : t('No conversations yet')}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {hasActiveFilters
                ? t('Try widening the time range or clearing some filters')
                : t('Finished chats will show up here for search and archive')}
            </p>
          </div>
        ) : (
          <div className="space-y-3 max-w-4xl mx-auto">
            {entries.map((entry) => (
              <HistoryEntryRow
                key={entry.conversationId}
                entry={entry}
                onOpen={() => navigate(`/chat/${entry.conversationId}`)}
                onToggleArchive={() =>
                  setConversationArchived({
                    id: entry.conversationId,
                    archive: !entry.archived,
                  })
                }
              />
            ))}
            {historyQuery.hasNextPage && (
              <div className="flex justify-center pt-2 pb-6">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void historyQuery.fetchNextPage()}
                  loading={historyQuery.isFetchingNextPage}
                >
                  {t('Load more')}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function HistoryEntryRow({
  entry,
  onOpen,
  onToggleArchive,
}: {
  entry: ChatHistoryEntry;
  onOpen: () => void;
  onToggleArchive: () => void;
}) {
  const accessible = entry.accessible;
  return (
    <div
      className={cn(
        'group rounded-lg border bg-card p-4 transition-colors',
        accessible && 'hover:border-primary/40 cursor-pointer',
        !accessible && 'opacity-75',
      )}
      onClick={() => {
        if (accessible) onOpen();
      }}
      role={accessible ? 'button' : undefined}
      tabIndex={accessible ? 0 : undefined}
      onKeyDown={(e) => {
        if (accessible && e.key === 'Enter') onOpen();
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold truncate max-w-[360px]">
              {entry.title
                ? chatUtils.sanitizeTitle(entry.title)
                : t('New conversation')}
            </span>
            {entry.archived && (
              <Badge variant="secondary" className="gap-1">
                <Archive className="h-3 w-3" />
                {t('Archived')}
              </Badge>
            )}
            {entry.status === AgentConversationStatus.STREAMING && (
              <Badge variant="outline">{t('In progress')}</Badge>
            )}
            {entry.status === AgentConversationStatus.ERROR && (
              <Badge variant="destructive">{t('Failed')}</Badge>
            )}
            {!accessible && (
              <Badge variant="outline" className="gap-1 text-muted-foreground">
                <Lock className="h-3 w-3" />
                {t('No longer accessible')}
              </Badge>
            )}
          </div>
          {accessible && entry.snippet && (
            <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2 break-words">
              {entry.snippet}
            </p>
          )}
          {!accessible && (
            <p className="mt-1.5 text-xs text-muted-foreground italic">
              {t(
                'The project this chat belonged to was deleted. Its contents are no longer available.',
              )}
            </p>
          )}
          <div className="mt-2 flex items-center gap-3 flex-wrap text-[11px] text-muted-foreground">
            {accessible && entry.projectName && (
              <span className="truncate max-w-[160px]">
                {entry.projectName}
              </span>
            )}
            <span>
              {t('Last active {{time}}', {
                time: dayjs(entry.conversationUpdatedAt).format(
                  'MMM D, YYYY h:mm A',
                ),
              })}
            </span>
            <span>
              {t('{{count}} messages', { count: entry.messageCount })}
            </span>
            {accessible && entry.files.length > 0 && (
              <TooltipProvider delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="flex items-center gap-1">
                      <FileText className="h-3 w-3" />
                      {entry.files
                        .slice(0, 2)
                        .map((file) => file.name)
                        .join(', ')}
                      {entry.files.length > 2 && ` +${entry.files.length - 2}`}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {entry.files.map((file) => file.name).join('\n')}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {accessible &&
              entry.resourceTypes.map((type) => {
                const meta = RESOURCE_TYPE_META[type];
                return (
                  <span
                    key={type}
                    className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5"
                  >
                    <meta.icon className="h-3 w-3" />
                    {meta.label}
                  </span>
                );
              })}
          </div>
        </div>
        <div
          className="flex items-center gap-1 shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          {accessible && (
            <>
              <TooltipProvider delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={onToggleArchive}
                    >
                      {entry.archived ? (
                        <ArchiveRestore className="h-4 w-4" />
                      ) : (
                        <Archive className="h-4 w-4" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {entry.archived ? t('Unarchive') : t('Archive')}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <Button size="sm" variant="outline" onClick={onOpen}>
                {entry.archived ? t('View') : t('Continue')}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
