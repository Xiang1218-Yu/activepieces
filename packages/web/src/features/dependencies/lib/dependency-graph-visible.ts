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
