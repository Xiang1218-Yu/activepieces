import { NoteColorVariant, flowStructureUtil } from '@activepieces/shared';
import { Editor } from '@tiptap/core';
import { useReactFlow } from '@xyflow/react';
import { t } from 'i18next';
import { CheckCircle2, Link2, Link2Off, TrashIcon } from 'lucide-react';
import { forwardRef, useRef, useState } from 'react';

import { useBuilderStateContext } from '@/app/builder/builder-hooks';
import {
  MarkdownTools,
  ToolWrapper,
} from '@/components/custom/markdown-input/tools';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

export const NoteTools = ({ editor, currentColor, id }: NoteToolsProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [
    updateNoteColor,
    deleteNote,
    note,
    flowVersion,
    setNoteResolved,
    attachNoteToStep,
    detachNoteFromStep,
  ] = useBuilderStateContext((state) => [
    state.updateNoteColor,
    state.deleteNote,
    state.getNoteById(id),
    state.flowVersion,
    state.setNoteResolved,
    state.attachNoteToStep,
    state.detachNoteFromStep,
  ]);
  const reactFlow = useReactFlow();
  if (!note) {
    return null;
  }
  const steps = flowStructureUtil.getAllSteps(flowVersion.trigger);

  const handleAttachToStep = (stepName: string) => {
    const stepNode = reactFlow.getNode(stepName);
    const noteNode = reactFlow.getNode(id);
    if (!stepNode || !noteNode) {
      return;
    }
    attachNoteToStep(id, stepName, {
      x: noteNode.position.x - stepNode.position.x,
      y: noteNode.position.y - stepNode.position.y,
    });
  };

  const handleDetachFromStep = () => {
    const noteNode = reactFlow.getNode(id);
    if (!noteNode) {
      return;
    }
    detachNoteFromStep(id, noteNode.position);
  };

  return (
    <div
      ref={containerRef}
      className="absolute cursor-default -top-[45px] w-full left-0"
    >
      <div className="flex items-center justify-center">
        <div className="p-1 bg-background flex items-center gap-0.5 shadow-md rounded-lg scale-65 border border-solid border-border">
          <NoteColorPicker
            currentColor={currentColor}
            setCurrentColor={(color: NoteColorVariant) => {
              updateNoteColor(id, color);
            }}
            container={containerRef.current}
          />
          <MarkdownTools editor={editor} />
          <Separator orientation="vertical" className="h-[30px]"></Separator>
          <ToolWrapper
            tooltip={note.resolved ? t('Reopen note') : t('Mark as resolved')}
          >
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setNoteResolved(id, !note.resolved);
              }}
            >
              <CheckCircle2
                className={cn('size-4', {
                  'text-primary': note.resolved,
                })}
              />
            </Button>
          </ToolWrapper>
          <DropdownMenu>
            <ToolWrapper
              tooltip={
                note.stepName ? t('Linked to a step') : t('Link to a step')
              }
            >
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                  {note.stepName ? (
                    <Link2 className="size-4 text-primary" />
                  ) : (
                    <Link2 className="size-4" />
                  )}
                </Button>
              </DropdownMenuTrigger>
            </ToolWrapper>
            <DropdownMenuContent className="w-56 max-h-64 overflow-y-auto">
              {note.stepName && (
                <>
                  <DropdownMenuItem onClick={handleDetachFromStep}>
                    <Link2Off className="mr-2 h-4 w-4" />
                    <span>{t('Detach from step')}</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              {steps.map((step) => (
                <DropdownMenuItem
                  key={step.name}
                  disabled={step.name === note.stepName}
                  onClick={() => handleAttachToStep(step.name)}
                >
                  <span className="truncate">{step.displayName}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <ToolWrapper tooltip={t('Delete')}>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                deleteNote(id);
              }}
            >
              <TrashIcon className="size-4 text-destructive" />
            </Button>
          </ToolWrapper>
        </div>
      </div>
    </div>
  );
};

const NoteColorPickerClassName = {
  [NoteColorVariant.YELLOW]: 'bg-amber-400',
  [NoteColorVariant.ORANGE]: 'bg-orange-400',
  [NoteColorVariant.RED]: 'bg-red-400',
  [NoteColorVariant.GREEN]: 'bg-green-400',
  [NoteColorVariant.BLUE]: 'bg-blue-400',
  [NoteColorVariant.PURPLE]: 'bg-purple-400',
};

const NoteColorPicker = ({
  currentColor,
  setCurrentColor,
  container,
}: NoteColorPickerProps) => {
  const [open, setOpen] = useState(false);
  const popoverTriggerRef = useRef<HTMLButtonElement>(null);
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <ToolWrapper tooltip={t('Color')}>
        <PopoverTrigger asChild>
          <div>
            <ColorButton
              color={currentColor}
              big={true}
              ref={popoverTriggerRef}
            />
          </div>
        </PopoverTrigger>
      </ToolWrapper>

      <PopoverContent
        container={container}
        side="top"
        className="w-[80px] p-1 mb-2"
      >
        <div className="flex items-center cursor-default gap-1 justify-between flex-wrap w-full ">
          {Object.values(NoteColorVariant).map((color) => (
            <ColorButton
              key={color}
              color={color}
              onClick={() => {
                setCurrentColor(color);
                setOpen(false);
                requestAnimationFrame(() => {
                  popoverTriggerRef.current?.focus();
                });
              }}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
};
NoteTools.displayName = 'NoteTools';

type NoteToolsProps = {
  editor: Editor;
  currentColor: NoteColorVariant;
  id: string;
};

type NoteColorPickerProps = {
  currentColor: NoteColorVariant;
  setCurrentColor: (color: NoteColorVariant) => void;
  container: HTMLDivElement | null;
};

const ColorButton = forwardRef<HTMLButtonElement, ColorButtonProps>(
  ({ color, onClick, big }, ref) => {
    return (
      <Button
        key={color}
        ref={ref}
        variant="ghost"
        size="icon"
        role="button"
        className={cn('size-5 shrink-0 grow flex items-center justify-center', {
          'size-6': big,
        })}
        onClick={onClick}
        onFocus={() => {
          console.log('focus');
        }}
      >
        <div
          className={cn(
            NoteColorPickerClassName[color] ??
              NoteColorPickerClassName[NoteColorVariant.YELLOW],
            'size-4 shrink-0 rounded-full',
            {
              'size-5': big,
            },
          )}
        ></div>
      </Button>
    );
  },
);
ColorButton.displayName = 'ColorButton';
type ColorButtonProps = {
  color: NoteColorVariant;
  onClick?: () => void;
  big?: boolean;
};
