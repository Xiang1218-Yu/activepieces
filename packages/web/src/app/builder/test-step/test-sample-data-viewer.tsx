import { isNil, tryParseFriendlyPieceError } from '@activepieces/core-utils';
import {
  AgentResult,
  AgentTaskStatus,
  FlowAction,
  FlowTrigger,
  flowStructureUtil,
} from '@activepieces/shared';
import { t } from 'i18next';
import { Loader2, Play, RefreshCw, TriangleAlert } from 'lucide-react';
import React, { useState } from 'react';

import { SmartOutputViewer } from '@/components/custom/smart-output-viewer';
import type { OutputSchema } from '@/components/custom/smart-output-viewer/types';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { useBuilderStateContext } from '../builder-hooks';
import { DataDisplayTabs } from '../data-display/data-display-tabs';
import { ErrorExplanationContext } from '../data-display/explanation-prompt';
import { FriendlyErrorView } from '../data-display/friendly-error-view';
import { ClosePanelButton } from '../step-data/close-panel-button';
import { StepDataPanelHeader } from '../step-data/step-data-panel-header';
import { StepDataPanelViewToggle } from '../step-data/step-data-panel-view-toggle';

import { AgentTestStep, isRunAgent } from './agent-test-step';
import { JsonTreeSkeleton } from './json-tree-skeleton';
import { TestButtonTooltip } from './test-step-tooltip';
import { testStepHooks } from './utils/test-step-hooks';

type TestSampleDataViewerProps = {
  isValid: boolean;
  currentStep?: FlowAction | FlowTrigger;
  stepName: string;
  isTesting: boolean;
  agentResult?: AgentResult;
  sampleData?: unknown;
  sampleDataInput?: unknown | null;
  errorMessage: string | null;
  lastTestDate: string | undefined;
  children?: React.ReactNode;
  consoleLogs: string | null;
  explanationContext?: ErrorExplanationContext;
  pieceDisplayName?: string;
  pieceSchema?: OutputSchema | null;
} & (
  | {
      hideCancel: true;
      onCancelTesting?: undefined;
    }
  | {
      hideCancel?: false;
      onCancelTesting: () => void;
    }
) &
  RetestButtonProps;

type RetestButtonProps = {
  isValid: boolean;
  isSaving: boolean;
  isTesting: boolean;
  onRetest: () => void;
};

type ActiveTab = 'Input' | 'Output' | 'Logs';

type SampleDataSaveFailureBannerProps = {
  stepName: string;
};

const SampleDataSaveFailureBanner = ({
  stepName,
}: SampleDataSaveFailureBannerProps) => {
  const [failedSampleDataSaves, retryFailedSampleDataSave] =
    useBuilderStateContext((state) => [
      state.failedSampleDataSaves,
      state.retryFailedSampleDataSave,
    ]);
  const failedSaves = Object.entries(failedSampleDataSaves)
    .filter(([, save]) => save.stepName === stepName)
    .map(([saveKey]) => saveKey);
  if (failedSaves.length === 0) {
    return null;
  }
  return (
    <div className="px-3 pt-2 shrink-0 flex flex-col gap-1">
      {failedSaves.map((saveKey) => (
        <Alert key={saveKey} variant="warning" className="py-2">
          <TriangleAlert className="size-4" />
          <AlertDescription className="flex items-center justify-between gap-2">
            <span>
              {t(
                'Could not save this sample data. Your test result is kept locally until the save succeeds.',
              )}
            </span>
            <Button
              variant="outline"
              size="xs"
              className="shrink-0"
              onClick={() => retryFailedSampleDataSave(saveKey)}
            >
              {t('Retry save')}
            </Button>
          </AlertDescription>
        </Alert>
      ))}
    </div>
  );
};

const isConsoleLogsValid = (value: unknown) => {
  if (isNil(value)) return false;
  return value !== '';
};

export const TestSampleDataViewer = React.memo(
  (props: TestSampleDataViewerProps) => {
    const {
      isValid,
      isTesting,
      sampleData,
      errorMessage,
      lastTestDate,
      currentStep,
      stepName,
      children,
      isSaving,
      onRetest,
      onCancelTesting,
      hideCancel,
      sampleDataInput,
      consoleLogs,
      explanationContext,
      pieceDisplayName,
      pieceSchema,
    } = props;
    const [requestedTab, setActiveTab] = useState<ActiveTab>('Output');
    const hasInput = !isNil(sampleDataInput);
    const hasLogs = isConsoleLogsValid(consoleLogs);
    const activeTab: ActiveTab =
      (requestedTab === 'Input' && !hasInput) ||
      (requestedTab === 'Logs' && !hasLogs)
        ? 'Output'
        : requestedTab;

    const isFailed =
      !isNil(errorMessage) ||
      (isRunAgent(currentStep) &&
        (sampleData as AgentResult | undefined)?.status ===
          AgentTaskStatus.FAILED);

    const status: 'success' | 'failed' | 'testing' | 'idle' = isTesting
      ? 'testing'
      : isFailed
      ? 'failed'
      : 'success';

    const outputData = errorMessage ?? sampleData;
    const activeData =
      activeTab === 'Input'
        ? sampleDataInput
        : activeTab === 'Logs'
        ? consoleLogs
        : outputData;

    const showAgentView = isRunAgent(currentStep) && !errorMessage;
    const friendlyError =
      !isTesting && !showAgentView && activeTab === 'Output'
        ? tryParseFriendlyPieceError(errorMessage)
        : null;

    return (
      <div className="flex flex-col h-full w-full min-h-0">
        <StepDataPanelHeader status={status} lastTestDate={lastTestDate} />
        <div className="flex-1 flex flex-col w-full text-start min-h-0">
          <SampleDataSaveFailureBanner stepName={stepName} />
          {errorMessage && !isTesting && (
            <div className="px-3 pt-2 text-xs text-muted-foreground shrink-0">
              {t('Errors are not saved on refresh')}
            </div>
          )}
          {!showAgentView && (
            <TestPanelToolbar
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              hasInput={hasInput}
              hasLogs={hasLogs}
              disabled={isTesting}
              stepName={stepName}
            />
          )}
          {!isTesting && !showAgentView && children}
          <div className="flex-1 min-h-0 px-3 pb-3 overflow-auto">
            {isTesting && !showAgentView ? (
              <TestingPreviewContent data={activeData} />
            ) : showAgentView ? (
              <AgentTestStep
                agentResult={getAgentResult(sampleData)}
                errorMessage={errorMessage}
              />
            ) : friendlyError ? (
              <FriendlyErrorView
                error={friendlyError}
                explanationContext={explanationContext}
                pieceDisplayName={pieceDisplayName}
              />
            ) : activeTab === 'Output' && !errorMessage ? (
              <SmartOutputViewer
                json={outputData}
                title={t('Output')}
                pieceSchema={pieceSchema ?? null}
              />
            ) : (
              <DataDisplayTabs
                data={activeData}
                title={t(activeTab)}
                copyableData={activeData}
                downloadFileName={`${
                  currentStep?.name ?? 'output'
                }-${activeTab.toLowerCase()}`}
              />
            )}
          </div>
        </div>
        {isTesting ? (
          <CancelTestingBar
            onCancel={hideCancel ? undefined : onCancelTesting}
          />
        ) : (
          <RetestActionBar
            onRetest={onRetest}
            disabled={!isValid || isSaving}
            isValid={isValid}
            isSaving={isSaving}
          />
        )}
      </div>
    );
  },
);

type TestPanelToolbarProps = {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  hasInput: boolean;
  hasLogs: boolean;
  disabled?: boolean;
  stepName: string;
};

const TestPanelToolbar = ({
  activeTab,
  setActiveTab,
  hasInput,
  hasLogs,
  disabled = false,
  stepName,
}: TestPanelToolbarProps) => (
  <div className="flex items-center justify-between px-3 py-2 gap-2 shrink-0">
    <SegmentedTabs
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      hasInput={hasInput}
      hasLogs={hasLogs}
      disabled={disabled}
    />
    <div className="flex items-center gap-1 shrink-0">
      <RefreshSampleDataButton disabled={disabled} stepName={stepName} />
      <StepDataPanelViewToggle disabled={disabled} />
      <ClosePanelButton />
    </div>
  </div>
);

type RefreshSampleDataButtonProps = {
  stepName: string;
  disabled?: boolean;
};

const RefreshSampleDataButton = ({
  stepName,
  disabled = false,
}: RefreshSampleDataButtonProps) => {
  const [currentStep, isStepBeingTested] = useBuilderStateContext((state) => [
    state.selectedStep
      ? flowStructureUtil.getStep(state.selectedStep, state.flowVersion.trigger)
      : null,
    state.isStepBeingTested,
  ]);
  const { mutate, isPending } = testStepHooks.useRefreshSampleData({
    currentStep: currentStep ?? undefined,
  });
  const isTesting = isStepBeingTested(stepName);
  const refreshDisabled =
    disabled || isPending || isTesting || isNil(currentStep);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={refreshDisabled}
          loading={isPending}
          onClick={() => mutate()}
          aria-label={t('Refresh sample data')}
        >
          {!isPending && <RefreshCw className="size-4" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t('Refresh sample data')}</TooltipContent>
    </Tooltip>
  );
};

type SegmentedTabsProps = {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  hasInput: boolean;
  hasLogs: boolean;
  disabled?: boolean;
};

const SegmentedTabs = ({
  activeTab,
  setActiveTab,
  hasInput,
  hasLogs,
  disabled,
}: SegmentedTabsProps) => (
  <div
    className={cn(
      'inline-flex items-center rounded-md bg-muted p-0.5 gap-0.5',
      disabled && 'opacity-50',
    )}
  >
    <SegmentedTabsButton
      label={t('Output')}
      active={activeTab === 'Output'}
      onClick={() => setActiveTab('Output')}
      disabled={disabled}
    />
    {hasInput && (
      <SegmentedTabsButton
        label={t('Input')}
        active={activeTab === 'Input'}
        onClick={() => setActiveTab('Input')}
        disabled={disabled}
      />
    )}
    {hasLogs && (
      <SegmentedTabsButton
        label={t('Logs')}
        active={activeTab === 'Logs'}
        onClick={() => setActiveTab('Logs')}
        disabled={disabled}
      />
    )}
  </div>
);

type SegmentedTabsButtonProps = {
  label: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
};

const SegmentedTabsButton = ({
  label,
  active,
  onClick,
  disabled,
}: SegmentedTabsButtonProps) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={cn(
      'px-3 py-1 text-xs font-medium rounded-sm transition-colors disabled:cursor-not-allowed',
      active
        ? 'bg-background text-foreground shadow-sm'
        : 'text-muted-foreground hover:text-foreground',
    )}
  >
    {label}
  </button>
);

type RetestActionBarProps = {
  onRetest: () => void;
  disabled: boolean;
  isValid: boolean;
  isSaving: boolean;
};

const RetestActionBar = ({
  onRetest,
  disabled,
  isValid,
  isSaving,
}: RetestActionBarProps) => (
  <div
    data-test-panel-trigger
    className="relative px-3 py-3 bg-background z-10 shrink-0"
  >
    <div
      aria-hidden
      className="pointer-events-none absolute -top-6 left-0 right-0 h-6 bg-gradient-to-t from-background to-transparent"
    />
    <TestButtonTooltip saving={isSaving} invalid={!isValid}>
      <Button
        variant="outline"
        onClick={onRetest}
        disabled={disabled}
        keyboardShortcut="G"
        onKeyboardShortcut={onRetest}
        className="w-full justify-center bg-primary/5 enabled:hover:bg-primary/15 enabled:hover:text-primary text-primary border-primary/20"
        size="sm"
      >
        <Play className="size-4 fill-current" />
        {t('Retest Step')}
      </Button>
    </TestButtonTooltip>
  </div>
);

type CancelTestingBarProps = {
  onCancel?: () => void;
};

const CancelTestingBar = ({ onCancel }: CancelTestingBarProps) => (
  <div
    data-test-panel-trigger
    className="relative px-3 py-3 bg-background z-10 shrink-0"
  >
    <div
      aria-hidden
      className="pointer-events-none absolute -top-6 left-0 right-0 h-6 bg-gradient-to-t from-background to-transparent"
    />
    <Button
      onClick={onCancel}
      disabled={!onCancel}
      variant="outline"
      className="w-full justify-center bg-primary/5 hover:bg-primary/10 text-primary border-primary/20"
      size="sm"
    >
      <Loader2 className="size-4 animate-spin" />
      {t('Cancel Testing')}
    </Button>
  </div>
);

type TestingPreviewContentProps = {
  data: unknown;
};

const TestingPreviewContent = ({ data }: TestingPreviewContentProps) => {
  if (!isNil(data)) {
    return (
      <div className="opacity-40 animate-pulse pointer-events-none select-none">
        <DataDisplayTabs data={data} title={t('Output')} />
      </div>
    );
  }
  return <JsonTreeSkeleton />;
};

TestSampleDataViewer.displayName = 'TestSampleDataViewer';

//In case the user has mangled sample data
function getAgentResult(sampleData: unknown) {
  if (isNil(sampleData)) return undefined;
  if (typeof sampleData !== 'object' || sampleData === null) return undefined;
  if (!('status' in sampleData)) return undefined;
  if (!('steps' in sampleData)) return undefined;
  if (!('prompt' in sampleData)) return undefined;
  return sampleData as AgentResult;
}
