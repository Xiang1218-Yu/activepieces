import { describe, expect, it } from 'vitest';

import {
  FlowActionType,
  FlowTriggerType,
  FlowVersionState,
} from '@activepieces/shared';
import type { FlowAction, FlowTrigger, FlowVersion } from '@activepieces/shared';

import { stepReferenceUtils } from './broken-step-references';

function buildFlowVersion(actions: FlowAction[]): FlowVersion {
  let nextAction: FlowAction | undefined;
  [...actions].reverse().forEach((action) => {
    action.nextAction = nextAction;
    nextAction = action;
  });
  const trigger = {
    name: 'trigger',
    type: FlowTriggerType.PIECE,
    valid: true,
    displayName: 'Trigger',
    lastUpdatedDate: '2024-01-01T00:00:00Z',
    settings: {
      pieceName: '@activepieces/piece-foo',
      pieceVersion: '~0.0.1',
      triggerName: 'foo',
      input: {},
      sampleData: {
        lastTestDate: '2024-01-02T00:00:00Z',
        sampleDataFileId: 'trigger-file',
      },
    },
    nextAction,
  } as FlowTrigger;
  return {
    id: 'fv-1',
    flowId: 'flow-1',
    displayName: 'Flow',
    trigger,
    valid: true,
    state: FlowVersionState.DRAFT,
    schemaVersion: null,
    created: '2024-01-01T00:00:00Z',
    updated: '2024-01-01T00:00:00Z',
    updatedBy: null,
    connectionIds: [],
    agentIds: [],
    notes: [],
  };
}

function buildPieceAction(
  name: string,
  input: Record<string, unknown>,
  sampleData?: FlowAction['settings']['sampleData'],
): FlowAction {
  return {
    name,
    type: FlowActionType.PIECE,
    valid: true,
    displayName: name,
    skip: false,
    lastUpdatedDate: '2024-01-01T00:00:00Z',
    settings: {
      pieceName: '@activepieces/piece-bar',
      pieceVersion: '~0.0.1',
      actionName: 'bar',
      input,
      sampleData,
    },
  } as FlowAction;
}

describe('stepReferenceUtils.findBrokenReferences', () => {
  it('returns nothing when all referenced steps exist with fresh sample data and valid paths', () => {
    const upstream = buildPieceAction(
      'step_1',
      {},
      { lastTestDate: '2024-01-02T00:00:00Z' },
    );
    const downstream = buildPieceAction(
      'step_2',
      { url: "{{ step_1['output']['id'] }}" },
    );
    const flowVersion = buildFlowVersion([upstream, downstream]);
    const broken = stepReferenceUtils.findBrokenReferences({
      flowVersion,
      step: downstream,
      outputSampleData: { step_1: { id: 'abc' } },
    });
    expect(broken).toEqual([]);
  });

  it('flags a reference to a step that no longer exists', () => {
    const downstream = buildPieceAction('step_2', {
      url: "{{ deleted_step['output']['id'] }}",
    });
    const flowVersion = buildFlowVersion([downstream]);
    const broken = stepReferenceUtils.findBrokenReferences({
      flowVersion,
      step: downstream,
      outputSampleData: {},
    });
    expect(broken).toEqual([
      {
        stepName: 'deleted_step',
        fieldPath: 'url',
        reason: 'step-missing',
      },
    ]);
  });

  it('flags a reference to a step that was never tested', () => {
    const upstream = buildPieceAction('step_1', {});
    const downstream = buildPieceAction('step_2', {
      url: "{{ step_1['output']['id'] }}",
    });
    const flowVersion = buildFlowVersion([upstream, downstream]);
    const broken = stepReferenceUtils.findBrokenReferences({
      flowVersion,
      step: downstream,
      outputSampleData: { step_1: undefined },
    });
    expect(broken).toEqual([
      {
        stepName: 'step_1',
        fieldPath: 'url',
        reason: 'sample-data-missing',
      },
    ]);
  });

  it('flags a path missing from the upstream sample data after a retest', () => {
    const upstream = buildPieceAction(
      'step_1',
      {},
      { lastTestDate: '2024-01-03T00:00:00Z' },
    );
    const downstream = buildPieceAction('step_2', {
      url: "{{ step_1['output']['oldField'] }}",
    });
    const flowVersion = buildFlowVersion([upstream, downstream]);
    const broken = stepReferenceUtils.findBrokenReferences({
      flowVersion,
      step: downstream,
      outputSampleData: { step_1: { newField: 'value' } },
    });
    expect(broken).toEqual([
      {
        stepName: 'step_1',
        fieldPath: 'url',
        reason: 'path-missing',
      },
    ]);
  });

  it('does not flag formula expressions or connection references', () => {
    const upstream = buildPieceAction(
      'step_1',
      {},
      { lastTestDate: '2024-01-02T00:00:00Z' },
    );
    const downstream = buildPieceAction('step_2', {
      token: '{{connections.slack}}',
      joined: "{{ join_list(flattenNestedKeys(step_1, ['id'])); \",\") }}",
    });
    const flowVersion = buildFlowVersion([upstream, downstream]);
    const broken = stepReferenceUtils.findBrokenReferences({
      flowVersion,
      step: downstream,
      outputSampleData: { step_1: {} },
    });
    expect(broken).toEqual([]);
  });
});
