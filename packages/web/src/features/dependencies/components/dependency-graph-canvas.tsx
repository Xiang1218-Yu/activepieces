import { isNil } from '@activepieces/core-utils';
import {
  DependencyEdge,
  DependencyEdgeStatus,
  DependencyNode,
} from '@activepieces/shared';
import {
  Background,
  BackgroundVariant,
  Controls,
  Edge,
  ReactFlow,
  Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { t } from 'i18next';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { authenticationSession } from '@/lib/authentication-session';

import { dependencyGraphNavigation } from '../lib/dependency-graph-navigation';
import {
  dependencyGraphVisible,
  ViewportRect,
} from '../lib/dependency-graph-visible';

import {
  DependencyGraphFlowNode,
  DependencyGraphNode,
} from './dependency-node';

const RENDER_BATCH_SIZE = 100;
const VIEWPORT_LOAD_MARGIN = 400;
const VIEWPORT_CULL_MARGIN = 600;

const nodeTypes = { dependency: DependencyGraphNode };

export function DependencyGraphCanvas({
  nodes,
  edges,
}: DependencyGraphCanvasProps) {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const [renderLimit, setRenderLimit] = useState(RENDER_BATCH_SIZE);
  const [viewport, setViewport] = useState<Viewport | null>(null);

  useEffect(() => {
    setRenderLimit(RENDER_BATCH_SIZE);
    setViewport(null);
  }, [nodes, edges]);

  const visibleGraph = useMemo(
    () =>
      dependencyGraphVisible.buildVisibleGraph({
        nodes,
        edges,
        renderLimit,
      }),
    [nodes, edges, renderLimit],
  );

  const viewportRect = computeViewportRect({
    viewport,
    container: containerRef.current,
  });

  const displayedNodes = useMemo(() => {
    if (isNil(viewportRect)) {
      return visibleGraph.nodes;
    }
    return dependencyGraphVisible.filterNodesToViewport({
      nodes: visibleGraph.nodes,
      positions: visibleGraph.positions,
      viewportRect,
      margin: VIEWPORT_CULL_MARGIN,
    });
  }, [visibleGraph, viewportRect]);

  const displayedNodeIds = new Set(displayedNodes.map((node) => node.id));
  const displayedEdges = visibleGraph.edges.filter(
    (edge) =>
      displayedNodeIds.has(edge.source) && displayedNodeIds.has(edge.target),
  );

  const flowNodes: DependencyGraphFlowNode[] = displayedNodes.map((node) => ({
    id: node.id,
    type: 'dependency',
    position: visibleGraph.positions.get(node.id) ?? { x: 0, y: 0 },
    data: { dependency: node },
    draggable: true,
  }));
  const flowEdges: Edge[] = displayedEdges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    animated: edge.status === DependencyEdgeStatus.DRAFT_ONLY,
    style:
      edge.status === DependencyEdgeStatus.DRAFT_ONLY
        ? { strokeDasharray: '6 4' }
        : undefined,
  }));

  const loadNextBatch = () => {
    setRenderLimit((limit) =>
      Math.min(limit + RENDER_BATCH_SIZE, nodes.length),
    );
  };

  const handleMoveEnd = () => {
    if (!visibleGraph.hasMore || isNil(viewportRect)) {
      return;
    }
    const renderedBounds = dependencyGraphVisible.computeBounds(
      visibleGraph.positions,
    );
    const reachesBeyondRendered =
      viewportRect.x + viewportRect.width >
        renderedBounds.maxX + VIEWPORT_LOAD_MARGIN ||
      viewportRect.y + viewportRect.height >
        renderedBounds.maxY + VIEWPORT_LOAD_MARGIN ||
      viewportRect.x < renderedBounds.minX - VIEWPORT_LOAD_MARGIN ||
      viewportRect.y < renderedBounds.minY - VIEWPORT_LOAD_MARGIN;
    if (reachesBeyondRendered) {
      loadNextBatch();
    }
  };

  return (
    <div className="relative h-full w-full" ref={containerRef}>
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.1}
        onlyRenderVisibleElements
        nodesConnectable={false}
        deleteKeyCode={null}
        onMove={(_, nextViewport) => setViewport(nextViewport)}
        onMoveEnd={() => handleMoveEnd()}
        onNodeClick={(_, node) => {
          const path = dependencyGraphNavigation.getNodePath(
            node.data.dependency,
          );
          if (!isNil(path)) {
            navigate(authenticationSession.appendProjectRoutePrefix(path));
          }
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
      {visibleGraph.hasMore && (
        <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-full border bg-background px-4 py-2 shadow-md">
          <span className="text-xs text-muted-foreground">
            {t('Showing {shown} of {total} nodes', {
              shown: visibleGraph.nodes.length,
              total: visibleGraph.totalCount,
            })}
          </span>
          <Button size="sm" variant="outline" onClick={loadNextBatch}>
            {t('Show more')}
          </Button>
        </div>
      )}
    </div>
  );
}

function computeViewportRect({
  viewport,
  container,
}: {
  viewport: Viewport | null;
  container: HTMLDivElement | null;
}): ViewportRect | null {
  if (isNil(viewport) || isNil(container)) {
    return null;
  }
  return {
    x: -viewport.x / viewport.zoom,
    y: -viewport.y / viewport.zoom,
    width: container.clientWidth / viewport.zoom,
    height: container.clientHeight / viewport.zoom,
  };
}

type DependencyGraphCanvasProps = {
  nodes: DependencyNode[];
  edges: DependencyEdge[];
};
