import {
  DependencyNode,
  DependencyNodeStatus,
  DependencyNodeType,
} from '@activepieces/shared';
import { Handle, Node, NodeProps, Position } from '@xyflow/react';
import { t } from 'i18next';
import {
  Bot,
  KeyRound,
  Puzzle,
  Repeat,
  Table2,
  Trash2,
  Workflow,
} from 'lucide-react';

import { dependencyGraphLabels } from '@/features/dependencies';
import { cn } from '@/lib/utils';

const NODE_TYPE_ICONS: Record<DependencyNodeType, typeof Workflow> = {
  [DependencyNodeType.FLOW]: Workflow,
  [DependencyNodeType.TABLE]: Table2,
  [DependencyNodeType.CONNECTION]: KeyRound,
  [DependencyNodeType.PIECE]: Puzzle,
  [DependencyNodeType.AGENT]: Bot,
};

export function DependencyGraphNode({
  data,
}: NodeProps<DependencyGraphFlowNode>) {
  const { dependency } = data;
  const Icon = NODE_TYPE_ICONS[dependency.type];
  const isDeleted = dependency.status === DependencyNodeStatus.DELETED;

  return (
    <div
      className={cn(
        'flex h-[72px] w-[240px] flex-col justify-center gap-1 rounded-lg border bg-background px-3 py-2 shadow-sm transition-colors',
        {
          'border-dashed border-destructive/60 bg-destructive/5': isDeleted,
          'ring-2 ring-warning': dependency.inCycle && !isDeleted,
        },
      )}
    >
      <Handle type="target" position={Position.Left} className="opacity-0" />
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground',
            { 'bg-destructive/10 text-destructive': isDeleted },
          )}
        >
          <Icon className="size-4" />
        </span>
        <span
          className="truncate text-sm font-medium"
          title={dependency.displayName}
        >
          {dependency.displayName}
        </span>
      </div>
      <div className="flex items-center gap-1.5 pl-9 text-[11px] text-muted-foreground">
        <span>{dependencyGraphLabels.nodeTypeLabel(dependency.type)}</span>
        {isDeleted && (
          <span className="flex items-center gap-0.5 text-destructive">
            <Trash2 className="size-3" />
            {t('Deleted')}
          </span>
        )}
        {dependency.inCycle && (
          <span className="flex items-center gap-0.5 text-warning-700 dark:text-warning-300">
            <Repeat className="size-3" />
            {t('Cycle')}
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Right} className="opacity-0" />
    </div>
  );
}

export type DependencyGraphFlowNode = Node<{ dependency: DependencyNode }>;
