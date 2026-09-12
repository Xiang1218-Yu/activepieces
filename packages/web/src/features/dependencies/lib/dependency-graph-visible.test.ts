import {
  DependencyEdge,
  DependencyEdgeStatus,
  DependencyEdgeType,
  DependencyNode,
  DependencyNodeStatus,
  DependencyNodeType,
} from '@activepieces/shared';

import { dependencyGraphNavigation } from './dependency-graph-navigation';
import { dependencyGraphVisible } from './dependency-graph-visible';

function makeNode(index: number): DependencyNode {
  return {
    id: `FLOW:flow-${index}`,
    type: DependencyNodeType.FLOW,
    displayName: `Flow ${index}`,
    status: DependencyNodeStatus.ACTIVE,
    refId: `flow-id-${index}`,
    inCycle: false,
  };
}

function makeEdge(index: number): DependencyEdge {
  return {
    id: `FLOW:flow-${index}|SUBFLOW_CALL|FLOW:flow-${index + 1}`,
    source: `FLOW:flow-${index}`,
    target: `FLOW:flow-${index + 1}`,
    type: DependencyEdgeType.SUBFLOW_CALL,
    status: DependencyEdgeStatus.PUBLISHED,
    stepNames: [],
  };
}

const LARGE_PROJECT_NODE_COUNT = 5000;
const FIRST_BATCH = 100;

describe('dependencyGraphVisible.buildVisibleGraph', () => {
  const nodes = Array.from({ length: LARGE_PROJECT_NODE_COUNT }, (_, index) =>
    makeNode(index),
  );
  const edges = Array.from(
    { length: LARGE_PROJECT_NODE_COUNT - 1 },
    (_, index) => makeEdge(index),
  );

  it('only processes the first batch of nodes for the initial render of a large project', () => {
    const result = dependencyGraphVisible.buildVisibleGraph({
      nodes,
      edges,
      renderLimit: FIRST_BATCH,
    });

    expect(result.nodes).toHaveLength(FIRST_BATCH);
    expect(result.positions.size).toBe(FIRST_BATCH);
    expect(result.totalCount).toBe(LARGE_PROJECT_NODE_COUNT);
    expect(result.hasMore).toBe(true);

    for (const [nodeId] of result.positions) {
      const index = Number(nodeId.replace('FLOW:flow-', ''));
      expect(index).toBeLessThan(FIRST_BATCH);
    }

    const visibleIds = new Set(result.nodes.map((node) => node.id));
    expect(visibleIds.has('FLOW:flow-4999')).toBe(false);
    for (const edge of result.edges) {
      expect(visibleIds.has(edge.source)).toBe(true);
      expect(visibleIds.has(edge.target)).toBe(true);
    }
    expect(result.edges).toHaveLength(FIRST_BATCH - 1);
  });

  it('lays out every node only when the render limit covers the whole graph', () => {
    const result = dependencyGraphVisible.buildVisibleGraph({
      nodes,
      edges,
      renderLimit: LARGE_PROJECT_NODE_COUNT,
    });

    expect(result.nodes).toHaveLength(LARGE_PROJECT_NODE_COUNT);
    expect(result.positions.size).toBe(LARGE_PROJECT_NODE_COUNT);
    expect(result.hasMore).toBe(false);
    expect(result.edges).toHaveLength(LARGE_PROJECT_NODE_COUNT - 1);
  });

  it('handles a render limit larger than the graph and an empty graph', () => {
    const overLimited = dependencyGraphVisible.buildVisibleGraph({
      nodes: nodes.slice(0, 5),
      edges: edges.slice(0, 4),
      renderLimit: FIRST_BATCH,
    });
    expect(overLimited.nodes).toHaveLength(5);
    expect(overLimited.hasMore).toBe(false);

    const empty = dependencyGraphVisible.buildVisibleGraph({
      nodes: [],
      edges: [],
      renderLimit: FIRST_BATCH,
    });
    expect(empty.nodes).toHaveLength(0);
    expect(empty.positions.size).toBe(0);
    expect(empty.hasMore).toBe(false);
  });
});

describe('dependencyGraphNavigation.getNodePath', () => {
  const base = {
    status: DependencyNodeStatus.ACTIVE,
    inCycle: false,
  };

  it('builds detail paths for flows, tables, agents and connections', () => {
    expect(
      dependencyGraphNavigation.getNodePath({
        ...base,
        id: 'FLOW:flow-1',
        type: DependencyNodeType.FLOW,
        displayName: 'My Flow',
        refId: 'flow-id-1',
      }),
    ).toBe('/flows/flow-id-1');

    expect(
      dependencyGraphNavigation.getNodePath({
        ...base,
        id: 'TABLE:table-1',
        type: DependencyNodeType.TABLE,
        displayName: 'My Table',
        refId: 'table-id-1',
      }),
    ).toBe('/tables/table-id-1');

    expect(
      dependencyGraphNavigation.getNodePath({
        ...base,
        id: 'AGENT:agent-1',
        type: DependencyNodeType.AGENT,
        displayName: 'My Agent',
        refId: 'agent-id-1',
      }),
    ).toBe('/agents/agent-id-1');

    expect(
      dependencyGraphNavigation.getNodePath({
        ...base,
        id: 'CONNECTION:conn-1',
        type: DependencyNodeType.CONNECTION,
        displayName: 'My Connection (prod)',
        refId: 'connection-id-1',
      }),
    ).toBe(
      `/connections?displayName=${encodeURIComponent('My Connection (prod)')}`,
    );
  });

  it('returns null for pieces, deleted objects and missing references', () => {
    expect(
      dependencyGraphNavigation.getNodePath({
        ...base,
        id: 'PIECE:@activepieces/piece-http',
        type: DependencyNodeType.PIECE,
        displayName: '@activepieces/piece-http',
        refId: null,
      }),
    ).toBeNull();

    expect(
      dependencyGraphNavigation.getNodePath({
        ...base,
        id: 'FLOW:deleted-flow',
        type: DependencyNodeType.FLOW,
        displayName: 'deleted-flow',
        status: DependencyNodeStatus.DELETED,
        refId: null,
      }),
    ).toBeNull();

    expect(
      dependencyGraphNavigation.getNodePath({
        ...base,
        id: 'FLOW:flow-2',
        type: DependencyNodeType.FLOW,
        displayName: 'Flow 2',
        refId: null,
      }),
    ).toBeNull();
  });
});
