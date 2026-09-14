import { t } from 'i18next';
import { GripVertical } from 'lucide-react';

import type { DraggableSyntheticListeners } from '@dnd-kit/core';

// Shared by every draggable tool-group row. Sits inside an AccordionTrigger, so a click on the
// handle must not toggle the accordion and only the handle itself starts a drag.
export const ToolDragHandle = ({
  listeners,
  attributes,
}: {
  listeners?: DraggableSyntheticListeners;
  attributes?: Record<string, unknown>;
}) => (
  <span
    {...attributes}
    {...listeners}
    onClick={(event) => event.stopPropagation()}
    onPointerDown={(event) => event.stopPropagation()}
    className="flex cursor-grab items-center text-muted-foreground/50 transition-colors hover:text-muted-foreground active:cursor-grabbing"
    aria-label={t('Drag to reorder tools')}
  >
    <GripVertical className="size-4" />
  </span>
);
