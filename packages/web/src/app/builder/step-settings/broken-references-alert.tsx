import { isNil } from '@activepieces/core-utils';
import {
  FlowAction,
  FlowTrigger,
  flowStructureUtil,
  FlowVersion,
} from '@activepieces/shared';
import { AlertTriangle } from 'lucide-react';
import { t } from 'i18next';
import { useMemo } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

import { useBuilderStateContext } from '../builder-hooks';

import {
  BrokenStepReference,
  stepReferenceUtils,
} from './broken-step-references';

type BrokenReferencesAlertProps = {
  step: FlowAction | FlowTrigger;
};

export const BrokenReferencesAlert = ({ step }: BrokenReferencesAlertProps) => {
  const [flowVersion, outputSampleData, selectStepByName] =
    useBuilderStateContext((state) => [
      state.flowVersion,
      state.outputSampleData,
      state.selectStepByName,
    ]);

  const brokenReferences = useMemo(
    () =>
      stepReferenceUtils.findBrokenReferences({
        flowVersion,
        step,
        outputSampleData,
      }),
    [flowVersion, step, outputSampleData],
  );

  if (brokenReferences.length === 0) {
    return null;
  }

  const description = getDescription(brokenReferences);

  return (
    <Alert variant="warning" className="mb-1">
      <AlertTriangle className="size-4" />
      <AlertTitle>{t('References need attention')}</AlertTitle>
      <AlertDescription className="flex flex-col gap-2">
        <span>{description}</span>
        <div className="flex flex-col gap-1">
          {brokenReferences.map((reference, index) => (
            <BrokenReferenceRow
              key={`${reference.stepName}.${reference.fieldPath}.${reference.reason}.${index}`}
              flowVersion={flowVersion}
              reference={reference}
              onSelect={() => selectStepByName(reference.stepName)}
            />
          ))}
        </div>
      </AlertDescription>
    </Alert>
  );
};

function getDescription(brokenReferences: BrokenStepReference[]): string {
  if (
    brokenReferences.some((reference) => reference.reason === 'step-missing')
  ) {
    return t(
      'A referenced step was removed or replaced. Re-select the variables in the highlighted fields.',
    );
  }
  if (
    brokenReferences.some(
      (reference) => reference.reason === 'sample-data-missing',
    )
  ) {
    return t(
      'A referenced step has no sample data. Test that step, then re-check the variables below.',
    );
  }
  return t(
    'An upstream step returned different data. Open the fields below and re-select the variables.',
  );
}

type BrokenReferenceRowProps = {
  flowVersion: FlowVersion;
  reference: BrokenStepReference;
  onSelect: () => void;
};

const BrokenReferenceRow = ({
  flowVersion,
  reference,
  onSelect,
}: BrokenReferenceRowProps) => {
  const referencedStep = flowStructureUtil.getStep(
    reference.stepName,
    flowVersion.trigger,
  );
  const label = isNil(referencedStep)
    ? reference.stepName
    : referencedStep.displayName;
  return (
    <div className="flex items-center gap-2 text-xs flex-wrap">
      <span className="font-medium">{reference.fieldPath || t('Input')}</span>
      <span className="text-muted-foreground">→</span>
      <Button
        variant="outline"
        size="xs"
        disabled={isNil(referencedStep)}
        onClick={onSelect}
        className="h-6"
      >
        {label}
      </Button>
    </div>
  );
};
