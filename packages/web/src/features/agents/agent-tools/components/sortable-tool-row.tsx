import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  createContext,
  type CSSProperties,
  type ReactNode,
  useContext,
} from 'react';

import { ToolDragHandle } from './tool-drag-handle';

type SortableToolRowContextValue = {
  handle: ReactNode;
  setNodeRef: (node: HTMLElement | null) => void;
  style: CSSProperties;
  isDragging: boolean;
};

const SortableHandleContext = createContext<SortableToolRowContextValue | null>(
  null,
);

// Registers an accordion item as a sortable row. The item component spreads the context's ref and
// style onto its AccordionItem so the accordion layout (borders, header flex row) stays intact,
// and only the grip carries drag listeners — clicking the rest of the trigger still expands it.
export const SortableToolRow = ({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  return (
    <SortableHandleContext.Provider
      value={{
        handle: (
          <ToolDragHandle attributes={attributes} listeners={listeners} />
        ),
        setNodeRef,
        style: {
          transform: CSS.Translate.toString(transform),
          transition,
          ...(isDragging ? { position: 'relative' as const, zIndex: 10 } : {}),
        },
        isDragging,
      }}
    >
      {children}
    </SortableHandleContext.Provider>
  );
};

export const useSortableToolRow = () => useContext(SortableHandleContext);
