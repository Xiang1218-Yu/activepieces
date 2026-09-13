import { isNil } from '@activepieces/core-utils';
import {
  BranchExecutionType,
  FlowAction,
  FlowActionType,
  FlowTrigger,
  LoopStepResult,
  StepOutput,
  StepOutputStatus,
} from '@activepieces/shared';

export type TimelineNodeStatus =
  | StepOutputStatus
  // The container (branch / iteration) never executed.
  | 'SKIPPED';

export type TimelineLoopPathEntry = { loopName: string; iteration: number };

export type TimelineErrorSummary = {
  stepName: string;
  stepDisplayName: string;
  message?: string;
};

type TimelineNodeBase = {
  /** Stable id across re-renders, built from the flow path. */
  id: string;
  depth: number;
  status: TimelineNodeStatus;
  /** Error bubbled up from this node or any descendant, even when collapsed. */
  errorSummary: TimelineErrorSummary | null;
  hasFailedDescendant: boolean;
};

export type TimelineStepNode = TimelineNodeBase & {
  kind: 'step';
  stepName: string;
  stepDisplayName: string;
  stepType: FlowActionType | FlowTrigger['type'];
  /** Loop selections needed to extract this step's output from the run. */
  loopPath: TimelineLoopPathEntry[];
  output: StepOutput | undefined;
};

export type TimelineBranchNode = TimelineNodeBase & {
  kind: 'branch';
  routerName: string;
  branchIndex: number;
  branchName: string;
  matched: boolean;
  isFallback: boolean;
  children: TimelineNode[];
};

export type TimelineRouterNode = TimelineNodeBase & {
  kind: 'router';
  step: TimelineStepNode;
  branches: TimelineBranchNode[];
};

export type TimelineIterationNode = TimelineNodeBase & {
  kind: 'iteration';
  loopName: string;
  iterationIndex: number;
  item: unknown;
  children: TimelineNode[];
};

export type TimelineLoopNode = TimelineNodeBase & {
  kind: 'loop';
  step: TimelineStepNode;
  iterations: TimelineIterationNode[];
};

export type TimelineLoadMoreNode = {
  kind: 'load-more-iterations';
  id: string;
  depth: number;
  loopName: string;
  loopNodeId: string;
  remainingCount: number;
};

export type TimelineNode =
  | TimelineStepNode
  | TimelineRouterNode
  | TimelineBranchNode
  | TimelineLoopNode
  | TimelineIterationNode;

type StepMeta = Pick<FlowAction | FlowTrigger, 'name' | 'displayName' | 'type'>;

type BuildContext = {
  /** Steps that actually ran at the current nesting level. */
  outputsById: Record<string, StepOutput>;
  depth: number;
  idPrefix: string;
  loopPath: TimelineLoopPathEntry[];
};

const summarizeError = (
  step: StepMeta,
  output: StepOutput | undefined,
): TimelineErrorSummary | null => {
  if (output?.status !== StepOutputStatus.FAILED) {
    return null;
  }
  return {
    stepName: step.name,
    stepDisplayName: step.displayName,
    message: output.errorMessage ?? undefined,
  };
};

const bubbleError = (
  own: TimelineErrorSummary | null,
  children: { errorSummary: TimelineErrorSummary | null }[],
): TimelineErrorSummary | null => {
  if (own) {
    return own;
  }
  // Child containers are rendered in execution order; the first failure is
  // the one that aborted the run and therefore the most relevant one.
  for (const child of children) {
    if (child.errorSummary) {
      return child.errorSummary;
    }
  }
  return null;
};

const hasStatus = (
  nodes: { status: TimelineNodeStatus }[],
  ...statuses: TimelineNodeStatus[]
): boolean => nodes.some((node) => statuses.includes(node.status));

export const aggregateChildrenStatus = (
  children: TimelineNode[],
): TimelineNodeStatus => {
  if (children.length === 0) {
    return StepOutputStatus.SUCCEEDED;
  }
  if (hasStatus(children, StepOutputStatus.FAILED)) {
    return StepOutputStatus.FAILED;
  }
  if (hasStatus(children, StepOutputStatus.RUNNING)) {
    return StepOutputStatus.RUNNING;
  }
  if (hasStatus(children, StepOutputStatus.PAUSED)) {
    return StepOutputStatus.PAUSED;
  }
  if (
    hasStatus(children, StepOutputStatus.SUCCEEDED, StepOutputStatus.STOPPED)
  ) {
    return StepOutputStatus.SUCCEEDED;
  }
  return 'SKIPPED';
};

const buildStepNode = (
  step: StepMeta,
  context: BuildContext,
): TimelineStepNode => ({
  kind: 'step',
  id: `${context.idPrefix}/${step.name}`,
  depth: context.depth,
  stepName: step.name,
  stepDisplayName: step.displayName,
  stepType: step.type,
  loopPath: context.loopPath,
  output: context.outputsById[step.name],
  status: context.outputsById[step.name]?.status ?? 'SKIPPED',
  errorSummary: summarizeError(step, context.outputsById[step.name]),
  hasFailedDescendant: false,
});

const buildActionChain = (
  firstAction: FlowAction | null | undefined,
  context: BuildContext,
): TimelineNode[] => {
  const nodes: TimelineNode[] = [];
  let action = firstAction;
  while (action) {
    nodes.push(buildActionNode(action, context));
    action = action.nextAction;
  }
  return nodes;
};

const buildLoopNode = (
  step: Extract<FlowAction, { type: FlowActionType.LOOP_ON_ITEMS }>,
  context: BuildContext,
): TimelineLoopNode => {
  const loopOutput = context.outputsById[step.name];
  const loopResult =
    loopOutput?.type === FlowActionType.LOOP_ON_ITEMS
      ? (loopOutput.output as LoopStepResult | undefined)
      : undefined;
  const stepNode = buildStepNode(step, context);
  const iterations: TimelineIterationNode[] = [];
  (loopResult?.iterations ?? []).forEach((iterationOutputs, iterationIndex) => {
    const iterationContext: BuildContext = {
      outputsById: iterationOutputs,
      depth: context.depth + 2,
      idPrefix: `${context.idPrefix}/${step.name}/iteration-${iterationIndex}`,
      loopPath: [
        ...context.loopPath,
        { loopName: step.name, iteration: iterationIndex },
      ],
    };
    const children = buildActionChain(
      step.firstLoopAction,
      iterationContext,
    );
    const status = aggregateChildrenStatus(children);
    const errorSummary = bubbleError(null, children);
    iterations.push({
      kind: 'iteration',
      id: iterationContext.idPrefix,
      depth: context.depth + 1,
      loopName: step.name,
      iterationIndex,
      item: loopResult?.item,
      status,
      children,
      errorSummary,
      hasFailedDescendant: !!errorSummary,
    });
  });

  const status =
    loopOutput?.status === StepOutputStatus.FAILED
      ? StepOutputStatus.FAILED
      : iterations.length === 0
      ? stepNode.status
      : aggregateChildrenStatus(iterations);
  const errorSummary = bubbleError(stepNode.errorSummary, iterations);
  return {
    kind: 'loop',
    id: `${context.idPrefix}/${step.name}`,
    depth: context.depth,
    step: { ...stepNode, hasFailedDescendant: !!errorSummary },
    iterations,
    status,
    errorSummary,
    hasFailedDescendant: !!errorSummary,
  };
};

// A matched branch always executes its head action; checking whether its
// outputs exist is therefore a reliable fallback signal of evaluation when the
// run was produced before the router recorded per-branch evaluation results.
const branchHasExecutedOutputs = (
  branchHead: FlowAction | null,
  context: BuildContext,
): boolean => {
  let action: FlowAction | null | undefined = branchHead;
  while (action) {
    if (!isNil(context.outputsById[action.name])) {
      return true;
    }
    action = action.nextAction;
  }
  return false;
};

const buildRouterNode = (
  step: Extract<FlowAction, { type: FlowActionType.ROUTER }>,
  context: BuildContext,
): TimelineRouterNode => {
  const routerOutput = context.outputsById[step.name];
  const routerStepNode = buildStepNode(step, context);
  const branchResults =
    routerOutput?.type === FlowActionType.ROUTER &&
    Array.isArray(routerOutput.output?.branches)
      ? routerOutput.output.branches
      : undefined;

  const branches: TimelineBranchNode[] = step.children.map(
    (branchHead, branchIndex) => {
      const result = branchResults?.[branchIndex];
      const inferredMatched = branchHasExecutedOutputs(branchHead, context);
      const matched = result?.evaluation ?? inferredMatched;
      const isFallback =
        step.settings.branches[branchIndex]?.branchType ===
        BranchExecutionType.FALLBACK;
      const branchContext: BuildContext = {
        ...context,
        depth: context.depth + 1,
        idPrefix: `${context.idPrefix}/${step.name}/branch-${branchIndex}`,
      };
      const children = matched
        ? buildActionChain(branchHead, branchContext)
        : [];
      const status = matched ? aggregateChildrenStatus(children) : 'SKIPPED';
      const errorSummary = matched ? bubbleError(null, children) : null;
      return {
        kind: 'branch',
        id: branchContext.idPrefix,
        depth: context.depth + 1,
        routerName: step.name,
        branchIndex,
        branchName:
          result?.branchName ??
          step.settings.branches[branchIndex]?.branchName ??
          `Branch ${branchIndex + 1}`,
        matched,
        isFallback,
        children,
        status,
        errorSummary,
        hasFailedDescendant: !!errorSummary,
      };
    },
  );

  const errorSummary = bubbleError(
    routerStepNode.errorSummary,
    branches.filter((branch) => branch.matched),
  );
  // A child step failure aborts the run before the router itself is marked
  // failed, so derive the router status from its matched branches as well.
  const status = errorSummary
    ? StepOutputStatus.FAILED
    : routerStepNode.status === 'SKIPPED'
    ? aggregateChildrenStatus(
        branches.filter((branch) => branch.matched),
      )
    : routerStepNode.status;

  return {
    kind: 'router',
    id: `${context.idPrefix}/${step.name}`,
    depth: context.depth,
    step: { ...routerStepNode, hasFailedDescendant: !!errorSummary },
    branches,
    status,
    errorSummary,
    hasFailedDescendant: !!errorSummary,
  };
};

const buildActionNode = (
  action: FlowAction,
  context: BuildContext,
): TimelineNode => {
  if (action.type === FlowActionType.LOOP_ON_ITEMS) {
    return buildLoopNode(action, context);
  }
  if (action.type === FlowActionType.ROUTER) {
    return buildRouterNode(action, context);
  }
  return buildStepNode(action, context);
};

/**
 * Turns a run's nested `steps` journal into an ordered timeline tree that
 * follows the flow definition (action chains, router branches and loop
 * iterations) so failures can be traced back to the branch / iteration they
 * happened in.
 */
export const buildRunTimelineTree = (
  trigger: FlowTrigger,
  runSteps: Record<string, StepOutput>,
): TimelineNode[] => {
  const rootContext: BuildContext = {
    outputsById: runSteps,
    depth: 0,
    idPrefix: 'run',
    loopPath: [],
  };

  const triggerNode = buildStepNode(trigger, rootContext);
  const actionNodes = buildActionChain(trigger.nextAction, rootContext);
  return [triggerNode, ...actionNodes];
};

/**
 * Ids of containers that should be open initially.
 * - Every router and matched branch is expanded so the branch a failure (or
 *   success) happened in is visible immediately; non-matched branches stay
 *   collapsed.
 * - The iteration containing a failed step is expanded. Successful iterations
 *   and healthy loops stay collapsed, since a loop may hold thousands of
 *   rounds — those are paged in on demand instead.
 */
export const collectInitiallyExpandedIds = (
  nodes: TimelineNode[],
): Set<string> => {
  const expanded = new Set<string>();
  const walk = (node: TimelineNode): boolean => {
    if (node.kind === 'step') {
      return node.status === StepOutputStatus.FAILED;
    }
    if (node.kind === 'iteration') {
      const childFailure = node.children.some(walk);
      if (childFailure) {
        expanded.add(node.id);
      }
      return childFailure;
    }
    if (node.kind === 'branch') {
      const childFailure = node.children.some(walk);
      if (childFailure) {
        expanded.add(node.id);
      }
      return childFailure;
    }
    if (node.kind === 'router') {
      const branchFailure = node.branches.some(walk);
      expanded.add(node.id);
      // Reveal the path that actually executed.
      node.branches.forEach((branch) => {
        if (branch.matched) {
          expanded.add(branch.id);
        }
      });
      return branchFailure;
    }
    // loop: only the loop itself and the failing iteration open by default.
    const iterationFailure = node.iterations.some(walk);
    if (iterationFailure || node.step.status === StepOutputStatus.FAILED) {
      expanded.add(node.id);
    }
    return iterationFailure;
  };
  nodes.forEach(walk);
  return expanded;
};

/**
 * Flattens visible (expanded) nodes into rows for virtualized rendering. When a
 * loop has more iterations than the current window, a trailing
 * `load-more-iterations` marker is appended so the panel can page them in
 * without mounting the whole iteration list.
 */
export const flattenTimelineTree = (
  nodes: TimelineNode[],
  expandedIds: Set<string>,
  visibleIterations: Record<string, number>,
  defaultVisibleIterations: number,
): (TimelineNode | TimelineLoadMoreNode)[] => {
  const rows: (TimelineNode | TimelineLoadMoreNode)[] = [];
  const walk = (node: TimelineNode) => {
    rows.push(node);
    if (!expandedIds.has(node.id)) {
      return;
    }
    if (node.kind === 'branch') {
      node.children.forEach(walk);
      return;
    }
    if (node.kind === 'router') {
      node.branches.forEach(walk);
      return;
    }
    if (node.kind === 'iteration') {
      // Expanding an iteration must reveal its steps — including nested loop
      // nodes, which then expand layer by layer on their own toggle.
      node.children.forEach(walk);
      return;
    }
    if (node.kind === 'loop') {
      const limit = visibleIterations[node.id] ?? defaultVisibleIterations;
      // Failing iterations beyond the paged window must stay reachable: the
      // failure path is auto-expanded, so never hide an iteration whose
      // subtree contains an error behind "load more".
      const visibleIndexes = new Set<number>();
      node.iterations.forEach((iteration, index) => {
        if (index < limit || iteration.errorSummary) {
          visibleIndexes.add(index);
        }
      });
      const sortedIndexes = [...visibleIndexes].sort((a, b) => a - b);
      sortedIndexes.forEach((index) => walk(node.iterations[index]));
      const remaining = node.iterations.length - visibleIndexes.size;
      if (remaining > 0) {
        rows.push({
          kind: 'load-more-iterations',
          id: `${node.id}/load-more`,
          depth: node.depth + 1,
          loopName: node.step.stepName,
          loopNodeId: node.id,
          remainingCount: remaining,
        });
      }
    }
  };
  nodes.forEach(walk);
  return rows;
};
