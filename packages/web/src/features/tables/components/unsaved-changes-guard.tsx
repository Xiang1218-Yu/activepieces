import { t } from 'i18next';
import { useEffect, useState } from 'react';
import { unstable_useBlocker } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { tableCellStateUtils } from '../stores/store/ap-tables-client-state';

import {
  useOptionalTableStore,
  useTableState,
} from './ap-table-state-provider';

export function UnsavedChangesGuard() {
  const cellStates = useTableState((state) => state.cellStates);
  const savePendingChanges = useTableState((state) => state.savePendingChanges);
  const store = useOptionalTableStore();
  const hasUnsavedChanges = tableCellStateUtils.hasUnsavedChanges(cellStates);
  const [isSavingAndLeaving, setIsSavingAndLeaving] = useState(false);

  const blocker = unstable_useBlocker(
    ({ currentLocation, nextLocation }) =>
      hasUnsavedChanges && currentLocation.pathname !== nextLocation.pathname,
  );

  useEffect(() => {
    if (!hasUnsavedChanges) {
      return;
    }
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (!hasUnsavedChanges && blocker.state === 'blocked') {
      blocker.proceed();
    }
  }, [hasUnsavedChanges, blocker]);

  useEffect(() => {
    const handleSaveShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        savePendingChanges();
      }
    };
    document.addEventListener('keydown', handleSaveShortcut, {
      capture: true,
    });
    return () =>
      document.removeEventListener('keydown', handleSaveShortcut, {
        capture: true,
      });
  }, [savePendingChanges]);

  const handleSaveAndLeave = async () => {
    setIsSavingAndLeaving(true);
    try {
      await savePendingChanges();
      const stillUnsaved = store
        ? tableCellStateUtils.hasUnsavedChanges(store.getState().cellStates)
        : false;
      if (blocker.state !== 'blocked') {
        return;
      }
      if (stillUnsaved) {
        blocker.reset();
      } else {
        blocker.proceed();
      }
    } finally {
      setIsSavingAndLeaving(false);
    }
  };

  return (
    <Dialog
      open={blocker.state === 'blocked'}
      onOpenChange={(open) => {
        if (!open && blocker.state === 'blocked') {
          blocker.reset();
        }
      }}
    >
      <DialogContent className="max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{t('Leave without saving?')}</DialogTitle>
          <DialogDescription>
            {t(
              'Some cell edits have not been saved yet. Leave now and they are discarded.',
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              if (blocker.state === 'blocked') {
                blocker.reset();
              }
            }}
          >
            {t('Keep editing')}
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              if (blocker.state === 'blocked') {
                blocker.proceed();
              }
            }}
          >
            {t('Discard changes')}
          </Button>
          <Button
            onClick={handleSaveAndLeave}
            disabled={isSavingAndLeaving}
            loading={isSavingAndLeaving}
          >
            {t('Save and leave')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
