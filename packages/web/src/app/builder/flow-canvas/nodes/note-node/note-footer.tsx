import { isNil } from '@activepieces/core-utils';
import { flowStructureUtil } from '@activepieces/shared';
import { t } from 'i18next';
import { CheckCircle2, Link2 } from 'lucide-react';

import { ApAvatar } from '@/components/custom/ap-avatar';
import { useEmbedding } from '@/components/providers/embed-provider';

import { useBuilderStateContext } from '../../../builder-hooks';

export const NoteFooter = ({ id, isDragging }: NoteFooterProps) => {
  const {
    embedState: { isEmbedded },
  } = useEmbedding();
  const [note, flowVersion, selectStepByName] = useBuilderStateContext(
    (state) => [
      state.getNoteById(id),
      state.flowVersion,
      state.selectStepByName,
    ],
  );
  if (isEmbedded || isNil(note)) {
    return null;
  }
  const attachedStep = note.stepName
    ? flowStructureUtil.getStep(note.stepName, flowVersion.trigger)
    : null;
  const lastUpdatedBy = note.lastUpdatedBy ?? note.ownerId;
  return (
    <div className="flex items-center justify-between gap-2 cursor-grabbing overflow-hidden">
      <div className="flex items-center gap-2 min-w-0">
        {note.resolved && (
          <span className="flex items-center gap-1 text-xss opacity-75 shrink-0">
            <CheckCircle2 className="size-3" />
            {t('Resolved')}
          </span>
        )}
        {attachedStep && (
          <button
            type="button"
            className="flex items-center gap-1 text-xss opacity-75 hover:opacity-100 truncate"
            onClick={(e) => {
              e.stopPropagation();
              selectStepByName(attachedStep.name);
            }}
          >
            <Link2 className="size-3 shrink-0" />
            <span className="truncate">{attachedStep.displayName}</span>
          </button>
        )}
      </div>
      <div className="grow"></div>
      {!isNil(lastUpdatedBy) && (
        <ApAvatar
          size="xsmall"
          id={lastUpdatedBy}
          includeName={true}
          hideHover={isDragging}
        />
      )}
    </div>
  );
};
NoteFooter.displayName = 'NoteFooter';

type NoteFooterProps = {
  id: string;
  isDragging?: boolean;
};
