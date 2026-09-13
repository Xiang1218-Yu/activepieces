import { describe, expect, it } from 'vitest';

import {
  FlowActionType,
  FlowTriggerType,
  StepOutput,
  StepOutputStatus,
} from '@activepieces/shared';

import {
  buildRunTimelineTree,
  collectInitiallyExpandedIds,
  flattenTimelineTree,
  TimelineNode,
} from '@/app/builder/run-details/run-timeline/run-timeline-tree';

const s = (
  status: StepOutputStatus,
  extra: Partial<StepOutput> = {},
): StepOutput =>
  ({
    type: FlowActionType.PIECE,
    status,
    duration: 10,
    input: {},
    ...extra,
  }) as StepOutput;

const routerOutput = (evaluations: boolean[]) =>
  ({
    type: FlowActionType.ROUTER,
    status: StepOutputStatus.SUCCEEDED,
    duration: 1,
    input: {},
    output: {
      branches: evaluations.map((evaluation, index) => ({
        branchName: `Branch ${index + 1}`,
        branchIndex: index + 1,
        evaluation,
      })),
    },
  }) as StepOutput;

const loopOutput = (iterations: Record<string, StepOutput>[]): StepOutput =>
  ({
    type: FlowActionType.LOOP_ON_ITEMS,
    status: StepOutputStatus.SUCCEEDED,
    duration: 5,
    input: {},
    output: { item: undefined, index: 0, iterations },
  }) as StepOutput;

describe('buildRunTimelineTree', () => {
  const trigger: any = {
    name: 'trigger',
    displayName: 'Webhook',
    type: FlowTriggerType.PIECE,
    nextAction: {
      name: 'router1',
      displayName: 'Route',
      type: FlowActionType.ROUTER,
      settings: {
        branches: [
          { branchName: 'VIP', branchType: 'CONDITION' },
          { branchName: 'Normal', branchType: 'CONDITION' },
          { branchName: 'Else', branchType: 'FALLBACK' },
        ],
      },
      children: [
        {
          name: 'a1',
          displayName: 'A1',
          type: FlowActionType.PIECE,
          nextAction: {
            name: 'a2',
            displayName: 'A2',
            type: FlowActionType.PIECE,
          },
        },
        { name: 'c1', displayName: 'C1', type: FlowActionType.PIECE },
        null,
      ],
      nextAction: {
        name: 'loop1',
        displayName: 'Loop',
        type: FlowActionType.LOOP_ON_ITEMS,
        firstLoopAction: {
          name: 'd1',
          displayName: 'D1',
          type: FlowActionType.PIECE,
        },
      },
    },
  };

  const runSteps: Record<string, StepOutput> = {
    trigger: s(StepOutputStatus.SUCCEEDED, {
      type: FlowTriggerType.PIECE,
    }),
    router1: routerOutput([true, false, false]),
    a1: s(StepOutputStatus.SUCCEEDED),
    a2: s(StepOutputStatus.FAILED, { errorMessage: 'Boom' }),
    loop1: loopOutput([
      { d1: s(StepOutputStatus.SUCCEEDED) },
      { d1: s(StepOutputStatus.FAILED, { errorMessage: 'iter fail' }) },
      { d1: s(StepOutputStatus.SUCCEEDED) },
    ]),
  };

  const nestedTrigger: any = {
    name: 'trigger',
    displayName: 'T',
    type: FlowTriggerType.PIECE,
    nextAction: {
      name: 'outer',
      displayName: 'Outer',
      type: FlowActionType.LOOP_ON_ITEMS,
      firstLoopAction: {
        name: 'inner',
        displayName: 'Inner',
        type: FlowActionType.LOOP_ON_ITEMS,
        firstLoopAction: {
          name: 'p1',
          displayName: 'P1',
          type: FlowActionType.PIECE,
        },
      },
    },
  };

  const nestedSteps: Record<string, StepOutput> = {
    trigger: s(StepOutputStatus.SUCCEEDED),
    outer: loopOutput([
      {
        inner: loopOutput([
          { p1: s(StepOutputStatus.SUCCEEDED) },
          { p1: s(StepOutputStatus.FAILED, { errorMessage: 'nested' }) },
        ]),
      },
    ]),
  };

  it('builds router branches with matched statuses', () => {
    const tree = buildRunTimelineTree(trigger, runSteps);
    const router = tree[1];
    expect(router.kind).toBe('router');
    if (router.kind !== 'router') {
      return;
    }
    expect(router.status).toBe(StepOutputStatus.FAILED);
    expect(router.errorSummary?.stepName).toBe('a2');
    expect(router.branches[0].matched).toBe(true);
    expect(router.branches[0].status).toBe(StepOutputStatus.FAILED);
    expect(router.branches[1].matched).toBe(false);
    expect(router.branches[1].status).toBe('SKIPPED');
    expect(router.branches[2].isFallback).toBe(true);
  });

  it('bubbles iteration failures to the loop and keeps the loop path', () => {
    const tree = buildRunTimelineTree(trigger, runSteps);
    const loop = tree[2];
    expect(loop.kind).toBe('loop');
    if (loop.kind !== 'loop') {
      return;
    }
    expect(loop.errorSummary?.stepName).toBe('d1');
    expect(loop.iterations[1].errorSummary?.message).toBe('iter fail');
    const childStep = loop.iterations[1].children[0];
    expect(childStep.kind).toBe('step');
    if (childStep.kind === 'step') {
      expect(childStep.loopPath).toEqual([
        { loopName: 'loop1', iteration: 1 },
      ]);
    }
  });

  it('expands failure paths and matched router branches only', () => {
    const tree = buildRunTimelineTree(trigger, runSteps);
    const expanded = collectInitiallyExpandedIds(tree);
    expect(expanded.has('run/router1')).toBe(true);
    expect(expanded.has('run/router1/branch-0')).toBe(true);
    expect(expanded.has('run/router1/branch-1')).toBe(false);
    expect(expanded.has('run/loop1')).toBe(true);
    expect(expanded.has('run/loop1/iteration-0')).toBe(false);
    expect(expanded.has('run/loop1/iteration-1')).toBe(true);
  });

  it('keeps failed steps visible in flattened rows and pages iterations', () => {
    const tree = buildRunTimelineTree(trigger, runSteps);
    const expanded = collectInitiallyExpandedIds(tree);
    const rows = flattenTimelineTree(tree, expanded, {}, 1);
    const stepNames = rows
      .filter((row) => row.kind === 'step')
      .map((row) => (row.kind === 'step' ? row.stepName : ''));
    expect(stepNames).toContain('a2');
    // The failing iteration (index 1) stays visible even though the paging
    // window only covers the first iteration.
    const failingIteration = rows.find(
      (row) =>
        row.kind === 'iteration' &&
        row.iterationIndex === 1 &&
        row.errorSummary?.stepName === 'd1',
    );
    expect(failingIteration).toBeDefined();
    // The failing iteration is auto-expanded, so its child step row must be
    // present in the flattened rows (regression: iteration children were
    // never walked by the flattener).
    expect(stepNames).toContain('d1');
    expect(rows.some((row) => row.kind === 'load-more-iterations')).toBe(true);
    const loadMore = rows.find(
      (row) => row.kind === 'load-more-iterations',
    );
    expect(
      loadMore && loadMore.kind === 'load-more-iterations'
        ? loadMore.remainingCount
        : 0,
    ).toBe(1);
  });

  it('reveals iteration child step rows when the iteration is expanded', () => {
    const tree = buildRunTimelineTree(trigger, runSteps);
    // Collapse everything except the loop and its *healthy* first iteration,
    // mirroring a user clicking through the tree.
    const expanded = new Set<string>([
      'run/loop1',
      'run/loop1/iteration-0',
    ]);
    const rows = flattenTimelineTree(tree, expanded, {}, 50);
    const stepNames = rows
      .filter((row) => row.kind === 'step')
      .map((row) => (row.kind === 'step' ? row.stepName : ''));
    // The step executed inside that iteration must be a visible row.
    expect(stepNames).toContain('d1');
    const d1Row = rows.find(
      (row) => row.kind === 'step' && row.stepName === 'd1',
    );
    if (d1Row && d1Row.kind === 'step') {
      expect(d1Row.output?.status).toBe(StepOutputStatus.SUCCEEDED);
      expect(d1Row.output?.duration).toBe(10);
    }
    // Rows from the still-collapsed router branches stay out of the list.
    expect(stepNames).not.toContain('a1');
    expect(stepNames).not.toContain('a2');

    // Collapsing the iteration again hides the child step row.
    const collapsedRows = flattenTimelineTree(
      tree,
      new Set<string>(['run/loop1']),
      {},
      50,
    );
    const collapsedNames = collapsedRows
      .filter((row) => row.kind === 'step')
      .map((row) => (row.kind === 'step' ? row.stepName : ''));
    expect(collapsedNames).not.toContain('d1');
  });

  it('expands nested loops layer by layer', () => {
    const tree = buildRunTimelineTree(nestedTrigger, nestedSteps);
    const outer = tree[1];
    expect(outer.kind).toBe('loop');
    if (outer.kind !== 'loop') {
      return;
    }
    const inner = outer.iterations[0].children[0];
    expect(inner.kind).toBe('loop');
    if (inner.kind !== 'loop') {
      return;
    }

    // Only the outer loop + its first iteration open: the inner loop header
    // is visible, but no p1 rows yet.
    const outerOpen = new Set<string>([
      'run/outer',
      'run/outer/iteration-0',
    ]);
    let rows = flattenTimelineTree(tree, outerOpen, {}, 50);
    let stepNames = rows
      .filter((row) => row.kind === 'step')
      .map((row) => (row.kind === 'step' ? row.stepName : ''));
    expect(rows.some((row) => row.id === inner.id)).toBe(true);
    expect(stepNames).not.toContain('p1');

    // Expand the inner loop and its first iteration: first-round p1 shows.
    const innerFirstIterationOpen = new Set<string>([
      ...outerOpen,
      inner.id,
      `${inner.id}/iteration-0`,
    ]);
    rows = flattenTimelineTree(tree, innerFirstIterationOpen, {}, 50);
    stepNames = rows
      .filter((row) => row.kind === 'step')
      .map((row) => (row.kind === 'step' ? row.stepName : ''));
    expect(stepNames).toContain('p1');
    const p1Rows = rows.filter(
      (row) => row.kind === 'step' && row.stepName === 'p1',
    );
    expect(p1Rows).toHaveLength(1);

    // Expanding the second (failing) inner iteration reveals its p1 row too.
    const allOpen = new Set<string>([
      ...innerFirstIterationOpen,
      `${inner.id}/iteration-1`,
    ]);
    rows = flattenTimelineTree(tree, allOpen, {}, 50);
    expect(
      rows.filter((row) => row.kind === 'step' && row.stepName === 'p1'),
    ).toHaveLength(2);
  });

  it('marks unexecuted steps as SKIPPED for an empty run', () => {
    const tree = buildRunTimelineTree(trigger, {});
    const step = tree[0];
    expect(step.kind).toBe('step');
    expect(step.status).toBe('SKIPPED');
    const router = tree[1];
    expect(router.kind).toBe('router');
    if (router.kind === 'router') {
      expect(router.branches.every((b) => b.status === 'SKIPPED')).toBe(true);
    }
  });

  it('handles nested loops with full loop paths', () => {
    const tree = buildRunTimelineTree(nestedTrigger, nestedSteps);
    const outer = tree[1];
    expect(outer.kind).toBe('loop');
    if (outer.kind !== 'loop') {
      return;
    }
    const inner: TimelineNode = outer.iterations[0].children[0];
    expect(inner.kind).toBe('loop');
    if (inner.kind !== 'loop') {
      return;
    }
    expect(inner.errorSummary?.message).toBe('nested');
    const failingStep = inner.iterations[1].children[0];
    if (failingStep.kind === 'step') {
      expect(failingStep.loopPath).toEqual([
        { loopName: 'outer', iteration: 0 },
        { loopName: 'inner', iteration: 1 },
      ]);
    }
  });
});
