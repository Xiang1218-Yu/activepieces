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

  const uniqueStepNames = Array.from(
    new Set(brokenReferences.map((reference) => reference.stepName)),
  );
  const description = getDescription(brokenReferences);

  return (
    <Alert variant="warning" className="mb-1">
      <AlertTriangle className="size-4" />
      <AlertTitle>{t('References need attention')}</AlertTitle>
      <AlertDescription className="flex flex-col gap-2">
        <span>{description}</span>
        <div className="flex flex-wrap gap-1">
          {uniqueStepNames.map((stepName) => (
            <BrokenReferenceStepButton
              key={stepName}
              flowVersion={flowVersion}
              stepName={stepName}
              onSelect={() => selectStepByName(stepName)}
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

type BrokenReferenceStepButtonProps = {
  flowVersion: FlowVersion;
  stepName: string;
  onSelect: () => void;
};

const BrokenReferenceStepButton = ({
  flowVersion,
  stepName,
  onSelect,
}: BrokenReferenceStepButtonProps) => {
  const referencedStep = flowStructureUtil.getStep(
    stepName,
    flowVersion.trigger,
  );
  if (isNil(referencedStep)) {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled={true}
        className="h-7 text-xs"
      >
        {stepName}
      </Button>
    );
  }
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onSelect}
      className="h-7 text-xs"
    >
      {referencedStep.displayName}
    </Button>
  );
};
