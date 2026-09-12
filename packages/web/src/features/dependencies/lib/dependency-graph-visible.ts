import { DependencyEdge, DependencyNode } from '@activepieces/shared';

import { dependencyGraphLayout } from './dependency-graph-layout';

export const dependencyGraphVisible = {
  buildVisibleGraph({
    nodes,
    edges,
    renderLimit,
  }: BuildVisibleGraphParams): VisibleGraph {
    const visibleNodes = nodes.slice(0, Math.max(0, renderLimit));
    const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
    const visibleEdges = edges.filter(
      (edge) =>
        visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target),
    );
    const positions = dependencyGraphLayout.layout({
      nodes: visibleNodes,
      edges: visibleEdges,
    });
    return {
      nodes: visibleNodes,
      edges: visibleEdges,
      positions,
      totalCount: nodes.length,
      hasMore: nodes.length > visibleNodes.length,
    };
  },

  filterNodesToViewport({
    nodes,
    positions,
    viewportRect,
    margin,
  }: FilterNodesToViewportParams): DependencyNode[] {
    const nodeWidth = dependencyGraphLayout.nodeWidth;
    const nodeHeight = dependencyGraphLayout.nodeHeight;
    return nodes.filter((node) => {
      const position = positions.get(node.id);
      if (!position) {
        return false;
      }
      return (
        position.x + nodeWidth >= viewportRect.x - margin &&
        position.x <= viewportRect.x + viewportRect.width + margin &&
        position.y + nodeHeight >= viewportRect.y - margin &&
        position.y <= viewportRect.y + viewportRect.height + margin
      );
    });
  },

  computeBounds(positions: Map<string, { x: number; y: number }>): GraphBounds {
    const nodeWidth = dependencyGraphLayout.nodeWidth;
    const nodeHeight = dependencyGraphLayout.nodeHeight;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const position of positions.values()) {
      minX = Math.min(minX, position.x);
      minY = Math.min(minY, position.y);
      maxX = Math.max(maxX, position.x + nodeWidth);
      maxY = Math.max(maxY, position.y + nodeHeight);
    }
    return { minX, minY, maxX, maxY };
  },
};

type VisibleGraph = {
  nodes: DependencyNode[];
  edges: DependencyEdge[];
  positions: Map<string, { x: number; y: number }>;
  totalCount: number;
  hasMore: boolean;
};

type BuildVisibleGraphParams = {
  nodes: DependencyNode[];
  edges: DependencyEdge[];
  renderLimit: number;
};

export type ViewportRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type FilterNodesToViewportParams = {
  nodes: DependencyNode[];
  positions: Map<string, { x: number; y: number }>;
  viewportRect: ViewportRect;
  margin: number;
};

type GraphBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};
