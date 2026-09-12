import { isNil } from '@activepieces/core-utils';
import { DependencyEdge, DependencyNode } from '@activepieces/shared';

const NODE_WIDTH = 240;
const NODE_HEIGHT = 72;
const LAYER_GAP_X = NODE_WIDTH + 120;
const LAYER_GAP_Y = NODE_HEIGHT + 28;

export const dependencyGraphLayout = {
  nodeWidth: NODE_WIDTH,
  nodeHeight: NODE_HEIGHT,
  layout({
    nodes,
    edges,
  }: LayoutParams): Map<string, { x: number; y: number }> {
    const layers = computeLayers({ nodes, edges });
    const nodesByLayer = new Map<number, DependencyNode[]>();
    for (const node of nodes) {
      const layer = layers.get(node.id) ?? 0;
      const layerNodes = nodesByLayer.get(layer) ?? [];
      layerNodes.push(node);
      nodesByLayer.set(layer, layerNodes);
    }
    const positions = new Map<string, { x: number; y: number }>();
    for (const [layer, layerNodes] of nodesByLayer) {
      layerNodes.forEach((node, index) => {
        positions.set(node.id, {
          x: layer * LAYER_GAP_X,
          y: index * LAYER_GAP_Y,
        });
      });
    }
    return positions;
  },
};

function computeLayers({ nodes, edges }: LayoutParams): Map<string, number> {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const indegree = new Map<string, number>();
  const targetsBySource = new Map<string, string[]>();
  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      continue;
    }
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    const targets = targetsBySource.get(edge.source) ?? [];
    targets.push(edge.target);
    targetsBySource.set(edge.source, targets);
  }
  const layers = new Map<string, number>();
  const queue: string[] = [];
  for (const node of nodes) {
    if (!indegree.has(node.id)) {
      layers.set(node.id, 0);
      queue.push(node.id);
    }
  }
  const remainingIndegree = new Map(indegree);
  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentLayer = layers.get(current) ?? 0;
    for (const target of targetsBySource.get(current) ?? []) {
      if (target === current) {
        continue;
      }
      layers.set(target, Math.max(layers.get(target) ?? 0, currentLayer + 1));
      const nextIndegree = (remainingIndegree.get(target) ?? 0) - 1;
      remainingIndegree.set(target, nextIndegree);
      if (nextIndegree <= 0) {
        queue.push(target);
      }
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (layers.has(node.id)) {
        continue;
      }
      const predecessorLayers = edges
        .filter(
          (edge) => edge.target === node.id && !isNil(layers.get(edge.source)),
        )
        .map((edge) => layers.get(edge.source)!);
      if (predecessorLayers.length > 0) {
        layers.set(node.id, Math.max(...predecessorLayers) + 1);
        changed = true;
      }
    }
  }
  for (const node of nodes) {
    if (!layers.has(node.id)) {
      layers.set(node.id, 0);
    }
  }
  return layers;
}

type LayoutParams = {
  nodes: DependencyNode[];
  edges: DependencyEdge[];
};
