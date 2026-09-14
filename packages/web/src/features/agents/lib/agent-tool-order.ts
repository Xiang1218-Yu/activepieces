import { AgentTool, AgentToolType } from '@activepieces/shared';

// The flat `draft.tools` array is the single source of tool order — both the configuration page
// and the run/chat tool lists read it in this sequence. Grouping for display never re-sorts;
// a group takes the position of its first tool, so reordering rows moves the underlying tools.
// Knowledge tools live in the same array but are configured in their own section, so during a
// reorder they act as immovable anchor blocks rather than disappearing.
export type ToolGroupKind = 'piece' | AgentToolType.FLOW | AgentToolType.MCP;

export type ToolGroup = {
  key: string;
  kind: ToolGroupKind;
  tools: AgentTool[];
};

type OrderBlock = {
  key: string;
  movable: boolean;
  tools: AgentTool[];
};

export function groupConfiguredTools(tools: AgentTool[]): ToolGroup[] {
  return buildBlocks(tools)
    .filter((block) => block.movable)
    .map((block) => ({
      key: block.key,
      kind: groupKindOf(block.tools[0]),
      tools: block.tools,
    }));
}

function groupKindOf(tool: AgentTool): ToolGroupKind {
  return tool.type === AgentToolType.PIECE
    ? 'piece'
    : (tool.type as AgentToolType.FLOW | AgentToolType.MCP);
}

function groupKeyOf(tool: AgentTool): string {
  return tool.type === AgentToolType.PIECE
    ? tool.pieceMetadata.pieceName
    : tool.type;
}

function buildBlocks(tools: AgentTool[]): OrderBlock[] {
  const blocks: OrderBlock[] = [];
  const movableIndexByKey = new Map<string, number>();
  for (const tool of tools) {
    if (tool.type === AgentToolType.KNOWLEDGE_BASE) {
      // Each knowledge entry is its own anchor: it is never reordered from the tools list.
      blocks.push({ key: tool.toolName, movable: false, tools: [tool] });
      continue;
    }
    const key = groupKeyOf(tool);
    const existing = movableIndexByKey.get(key);
    if (existing === undefined) {
      movableIndexByKey.set(key, blocks.length);
      blocks.push({ key, movable: true, tools: [tool] });
    } else {
      blocks[existing].tools.push(tool);
    }
  }
  return blocks;
}

// Rewrite the flat array when a group row moves: all of the group's tools travel together, every
// other tool keeps its relative place, and knowledge anchors are never dropped.
export function moveToolGroup(
  tools: AgentTool[],
  activeKey: string,
  overKey: string,
): AgentTool[] {
  if (activeKey === overKey) {
    return tools;
  }
  const blocks = buildBlocks(tools);
  const from = blocks.findIndex((block) => block.key === activeKey);
  const to = blocks.findIndex((block) => block.key === overKey);
  if (from === -1 || to === -1) {
    return tools;
  }
  const [moved] = blocks.splice(from, 1);
  blocks.splice(to, 0, moved);
  return blocks.flatMap((block) => block.tools);
}

export function isKnowledgeTool(
  tool: AgentTool,
): tool is Extract<AgentTool, { type: AgentToolType.KNOWLEDGE_BASE }> {
  return tool.type === AgentToolType.KNOWLEDGE_BASE;
}
