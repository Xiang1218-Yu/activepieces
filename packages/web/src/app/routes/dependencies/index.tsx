import { DependencyNodeType } from '@activepieces/shared';
import { t } from 'i18next';
import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';

import { DataFetchErrorState } from '@/components/custom/data-fetch-error-state';
import { PageHeader } from '@/components/custom/page-header';
import { LoadingSpinner } from '@/components/custom/spinner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DependencyGraphCanvas,
  dependencyGraphLabels,
  dependencyGraphQueries,
} from '@/features/dependencies';
import { cn } from '@/lib/utils';

const NODE_TYPE_ORDER: DependencyNodeType[] = [
  DependencyNodeType.FLOW,
  DependencyNodeType.AGENT,
  DependencyNodeType.TABLE,
  DependencyNodeType.CONNECTION,
  DependencyNodeType.PIECE,
];

export default function DependenciesPage() {
  const { data, isLoading, isError, refetch } =
    dependencyGraphQueries.useProjectDependencyGraph();
  const [search, setSearch] = useState('');
  const [hiddenTypes, setHiddenTypes] = useState<Set<DependencyNodeType>>(
    new Set(),
  );

  const filtered = useMemo(() => {
    const allNodes = data?.nodes ?? [];
    const allEdges = data?.edges ?? [];
    const normalizedSearch = search.trim().toLowerCase();
    const nodes = allNodes
      .filter((node) => !hiddenTypes.has(node.type))
      .filter(
        (node) =>
          normalizedSearch.length === 0 ||
          node.displayName.toLowerCase().includes(normalizedSearch),
      )
      .sort(
        (a, b) =>
          NODE_TYPE_ORDER.indexOf(a.type) - NODE_TYPE_ORDER.indexOf(b.type) ||
          a.displayName.localeCompare(b.displayName),
      );
    const nodeIds = new Set(nodes.map((node) => node.id));
    const edges = allEdges.filter(
      (edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target),
    );
    return { nodes, edges };
  }, [data, search, hiddenTypes]);

  const toggleType = (type: DependencyNodeType) => {
    setHiddenTypes((previous) => {
      const next = new Set(previous);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  return (
    <div className="flex h-full w-full flex-col">
      <PageHeader
        title={t('Dependencies')}
        description={t(
          'Map of how flows, tables, connections, pieces and agents depend on each other in this project',
        )}
      />
      <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('Search dependencies')}
            className="pl-8"
          />
        </div>
        <div className="flex items-center gap-1">
          {NODE_TYPE_ORDER.map((type) => (
            <Button
              key={type}
              variant={hiddenTypes.has(type) ? 'outline' : 'secondary'}
              size="sm"
              className={cn({ 'opacity-60': hiddenTypes.has(type) })}
              onClick={() => toggleType(type)}
            >
              {dependencyGraphLabels.nodeTypeLabel(type)}
            </Button>
          ))}
        </div>
        <span
          className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground"
          title={t(
            'Dashed edges only exist in a draft version and are not published yet.',
          )}
        >
          <span className="inline-block w-6 border-t-2 border-dashed border-muted-foreground" />
          {t('Draft-only references')}
        </span>
      </div>
      <div className="relative min-h-0 flex-1 border-t">
        {isLoading && (
          <div className="flex h-full items-center justify-center">
            <LoadingSpinner className="size-8" />
          </div>
        )}
        {isError && (
          <DataFetchErrorState
            entity={t('dependencies')}
            onRetry={refetch}
            className="h-full"
          />
        )}
        {!isLoading && !isError && filtered.nodes.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
            <p className="text-lg font-semibold">
              {t('No dependencies found')}
            </p>
            <p className="text-sm text-muted-foreground">
              {t('No objects in this project reference each other yet.')}
            </p>
          </div>
        )}
        {!isLoading && !isError && filtered.nodes.length > 0 && (
          <DependencyGraphCanvas
            nodes={filtered.nodes}
            edges={filtered.edges}
          />
        )}
      </div>
    </div>
  );
}
