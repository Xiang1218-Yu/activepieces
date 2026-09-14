import { AgentTool, AgentToolType } from '@activepieces/shared';
import { describe, expect, it } from 'vitest';

import {
  groupConfiguredTools,
  isKnowledgeTool,
  moveToolGroup,
} from './agent-tool-order';

const pieceTool = (
  pieceName: string,
  actionName: string,
): AgentTool => ({
  type: AgentToolType.PIECE,
  toolName: `${pieceName}:${actionName}`,
  pieceMetadata: {
    pieceName,
    pieceVersion: '1.0.0',
    actionName,
  },
});

const flowTool = (name: string): AgentTool => ({
  type: AgentToolType.FLOW,
  toolName: name,
  externalFlowId: name,
  flowDisplayName: name,
});

const mcpTool = (name: string): AgentTool => ({
  type: AgentToolType.MCP,
  toolName: name,
  serverUrl: 'https://example.com/mcp',
  protocol: 'streamable-http' as never,
  auth: { type: 'none' as never },
});

describe('groupConfiguredTools', () => {
  it('groups consecutive piece tools by piece and keeps first-occurrence order', () => {
    const tools: AgentTool[] = [
      pieceTool('slack', 'send_message'),
      flowTool('flow-a'),
      pieceTool('slack', 'list_channels'),
      pieceTool('github', 'create_issue'),
    ];

    const groups = groupConfiguredTools(tools);

    expect(groups.map((group) => group.key)).toEqual([
      'slack',
      AgentToolType.FLOW,
      'github',
    ]);
    expect(groups[0].tools).toHaveLength(2);
  });

  it('groups all flow and mcp tools into single buckets', () => {
    const groups = groupConfiguredTools([
      flowTool('flow-a'),
      mcpTool('mcp-a'),
      flowTool('flow-b'),
      mcpTool('mcp-b'),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0].tools.map((tool) => tool.toolName)).toEqual([
      'flow-a',
      'flow-b',
    ]);
    expect(groups[1].tools.map((tool) => tool.toolName)).toEqual([
      'mcp-a',
      'mcp-b',
    ]);
  });

  it('leaves knowledge tools out of the draggable groups', () => {
    const groups = groupConfiguredTools([
      pieceTool('slack', 'send_message'),
      {
        type: AgentToolType.KNOWLEDGE_BASE,
        toolName: 'kb',
        sourceType: 'FILE' as never,
        sourceId: 'file-1',
        sourceName: 'handbook',
      },
    ]);

    expect(groups.map((group) => group.key)).toEqual(['slack']);
    expect(isKnowledgeTool(groups[0].tools[0])).toBe(false);
  });
});

describe('moveToolGroup', () => {
  it('moves a whole group together, preserving tool order inside it', () => {
    const tools: AgentTool[] = [
      pieceTool('slack', 'send_message'),
      pieceTool('slack', 'list_channels'),
      flowTool('flow-a'),
      mcpTool('mcp-a'),
    ];

    const moved = moveToolGroup(tools, AgentToolType.FLOW, 'slack');

    // The flow block jumps ahead of both slack actions, and the slack actions keep their order.
    expect(moved.map((tool) => tool.toolName)).toEqual([
      'flow-a',
      'slack:send_message',
      'slack:list_channels',
      'mcp-a',
    ]);
  });

  it('is a no-op for unknown keys or when moving onto itself', () => {
    const tools: AgentTool[] = [pieceTool('slack', 'send_message')];

    expect(moveToolGroup(tools, 'slack', 'slack')).toBe(tools);
    expect(moveToolGroup(tools, 'missing', 'slack')).toBe(tools);
  });

  it('round-trips: regrouping after a move reflects the new order', () => {
    const tools: AgentTool[] = [
      mcpTool('mcp-a'),
      pieceTool('slack', 'send_message'),
      flowTool('flow-a'),
    ];

    const moved = moveToolGroup(tools, 'slack', AgentToolType.MCP);

    expect(groupConfiguredTools(moved).map((group) => group.key)).toEqual([
      'slack',
      AgentToolType.MCP,
      AgentToolType.FLOW,
    ]);
  });

  it('keeps knowledge tools anchored in the array instead of dropping them', () => {
    const knowledge: AgentTool = {
      type: AgentToolType.KNOWLEDGE_BASE,
      toolName: 'kb',
      sourceType: 'FILE' as never,
      sourceId: 'file-1',
      sourceName: 'handbook',
    };
    const tools: AgentTool[] = [
      pieceTool('slack', 'send_message'),
      knowledge,
      flowTool('flow-a'),
    ];

    const moved = moveToolGroup(tools, AgentToolType.FLOW, 'slack');

    expect(moved).toHaveLength(3);
    expect(
      moved.filter((tool) => tool.type === AgentToolType.KNOWLEDGE_BASE),
    ).toHaveLength(1);
    expect(moved.map((tool) => tool.toolName)).toEqual([
      'flow-a',
      'slack:send_message',
      'kb',
    ]);
  });
});
