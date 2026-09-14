import { AIProviderName } from '@activepieces/core-utils';
import { AgentToolType } from '@activepieces/shared';
import type {
  AgentKnowledgeBaseTool,
  AgentPieceTool,
  AgentTool,
} from '@activepieces/shared';
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  restrictToParentElement,
  restrictToVerticalAxis,
} from '@dnd-kit/modifiers';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { t } from 'i18next';
import { Plus } from 'lucide-react';

import { Accordion } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import {
  AddToolDropdown,
  AgentFlowToolComponent,
  AgentMcpToolComponent,
  AgentPieceToolComponent,
  AgentFlowToolDialog,
  AgentMcpDialog,
  KnowledgeBaseSection,
} from '@/features/agents';
import { AddRow } from '@/features/agents/agent-tools/components/add-row';
import { SortableToolRow } from '@/features/agents/agent-tools/components/sortable-tool-row';
import {
  groupConfiguredTools,
  moveToolGroup,
} from '@/features/agents/lib/agent-tool-order';
import { cn } from '@/lib/utils';

import { AgentPieceDialog } from './piece-tool-dialog';

const icons = [
  'https://cdn.activepieces.com/pieces/youtube.png',
  'https://cdn.activepieces.com/pieces/slack.png',
  'https://cdn.activepieces.com/pieces/github.png',
  'https://cdn.activepieces.com/pieces/notion.png',
];

interface AgentToolsProps {
  toolsField: AgentFormField;
  disabled?: boolean;
  selectedProvider?: AIProviderName;
  layout?: 'card' | 'rows';
}

type AgentFormField = {
  value: unknown;
  onChange: (value: AgentTool[]) => void;
};

export const AgentTools = ({
  disabled,
  toolsField: agentToolsField,
  selectedProvider,
  layout = 'card',
}: AgentToolsProps) => {
  const tools = Array.isArray(agentToolsField.value)
    ? (agentToolsField.value as AgentTool[])
    : [];

  const onToolsUpdate = (tools: AgentTool[]) => agentToolsField.onChange(tools);

  const removeTool = (toolName: string) => {
    onToolsUpdate(tools.filter((tool) => toolName !== tool.toolName));
  };

  // Group order follows the saved array: each group takes the position of its first tool, which is
  // the order the model reaches them in a run and the order the chat session list shows them in.
  const orderedGroups = groupConfiguredTools(tools);
  const kbTools = tools.filter(
    (tool): tool is AgentKnowledgeBaseTool =>
      tool.type === AgentToolType.KNOWLEDGE_BASE,
  );

  const asRows = layout === 'rows';

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 8 },
    }),
    useSensor(KeyboardSensor),
  );

  const handleReorder = (activeId: string, overId: string) => {
    if (activeId === overId) return;
    onToolsUpdate(moveToolGroup(tools, activeId, overId));
  };

  const groupedTools = (
    <Accordion
      type="single"
      collapsible
      className={cn(
        'overflow-hidden shadow-none',
        asRows ? 'rounded-[10px] border' : 'rounded-md border',
      )}
    >
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        onDragEnd={({ active, over }) => {
          if (over) {
            handleReorder(String(active.id), String(over.id));
          }
        }}
      >
        <SortableContext
          items={orderedGroups.map((group) => group.key)}
          strategy={verticalListSortingStrategy}
        >
          {orderedGroups.map((group) => {
            if (group.kind === 'piece') {
              return (
                <SortableToolRow key={group.key} id={group.key}>
                  <AgentPieceToolComponent
                    disabled={disabled}
                    tools={group.tools as AgentPieceTool[]}
                    removeTool={removeTool}
                    sortable={asRows}
                  />
                </SortableToolRow>
              );
            }
            if (group.kind === AgentToolType.FLOW) {
              return (
                <SortableToolRow key={group.key} id={group.key}>
                  <AgentFlowToolComponent
                    disabled={disabled}
                    tools={
                      group.tools as Extract<
                        AgentTool,
                        { type: AgentToolType.FLOW }
                      >[]
                    }
                    removeTool={removeTool}
                    sortable={asRows}
                  />
                </SortableToolRow>
              );
            }
            return (
              <SortableToolRow key={group.key} id={group.key}>
                <AgentMcpToolComponent
                  disabled={disabled}
                  tools={
                    group.tools as Extract<
                      AgentTool,
                      { type: AgentToolType.MCP }
                    >[]
                  }
                  removeTool={removeTool}
                  sortable={asRows}
                />
              </SortableToolRow>
            );
          })}
        </SortableContext>
      </DndContext>
    </Accordion>
  );

  return (
    <div>
      {!asRows && <h2 className="text-sm font-medium">{t('Agent Tools')}</h2>}

      <div className={cn(!asRows && 'mt-2')}>
        {orderedGroups.length > 0 ? (
          <>
            {groupedTools}
            <AddToolDropdown disabled={disabled} align="start">
              {asRows ? (
                <div className="mt-[7px]">
                  <AddRow label={t('Add tool')} disabled={disabled} />
                </div>
              ) : (
                <Button variant="outline" className="mt-2">
                  <Plus className="size-4 mr-2" />
                  {t('Add')}
                </Button>
              )}
            </AddToolDropdown>
          </>
        ) : asRows ? (
          <AddToolDropdown disabled={disabled} align="start">
            <AddRow label={t('Add tool')} disabled={disabled} />
          </AddToolDropdown>
        ) : (
          <div className="flex flex-col items-center justify-center gap-4 rounded-xl border bg-card px-4 py-8 text-center">
            <div className="flex items-center">
              {icons.slice(0, 4).map((icon, index) => (
                <div
                  key={icon}
                  className="relative flex size-9 items-center justify-center rounded-full border bg-background"
                  style={{ marginLeft: index === 0 ? 0 : -10 }}
                >
                  <img
                    src={icon}
                    alt={icon}
                    className="size-4 object-contain"
                  />
                </div>
              ))}
              <div
                className="relative flex size-9 items-center justify-center rounded-full border text-[10px] bg-background text-foreground font-medium"
                style={{ marginLeft: -10 }}
              >
                <span>+500</span>
              </div>
            </div>

            <p className="text-sm font-medium text-muted-foreground">
              {t('Connect apps, flows, MCPs and more.')}
            </p>

            <AddToolDropdown disabled={disabled} align="center">
              <Button variant="outline" className="gap-2">
                <Plus className="size-4" />
                {t('Add')}
              </Button>
            </AddToolDropdown>
          </div>
        )}
      </div>

      {!asRows && (
        <KnowledgeBaseSection
          disabled={disabled}
          tools={kbTools}
          allTools={tools}
          removeTool={removeTool}
          onToolsUpdate={onToolsUpdate}
          selectedProvider={selectedProvider}
        />
      )}

      <AgentFlowToolDialog onToolsUpdate={onToolsUpdate} tools={tools} />
      <AgentPieceDialog tools={tools} onToolsUpdate={onToolsUpdate} />
      <AgentMcpDialog tools={tools} onToolsUpdate={onToolsUpdate} />
    </div>
  );
};
