import { extractMustacheTokens } from '@activepieces/core-utils';
import {
  FlowAction,
  FlowTrigger,
  FlowVersion,
  flowStructureUtil,
} from '@activepieces/shared';

export type BrokenStepReferenceReason =
  | 'step-missing'
  | 'sample-data-missing'
  | 'path-missing';

export type BrokenStepReference = {
  stepName: string;
  fieldPath: string;
  reason: BrokenStepReferenceReason;
};

const RESERVED_REFERENCE_ROOTS = new Set(['connections', 'variables']);
const EXCLUDED_SETTING_KEYS = new Set(['sourceCode', 'sampleData']);

function collectStrings(
  value: unknown,
  path: string,
  results: { value: string; fieldPath: string }[],
): void {
  if (typeof value === 'string') {
    results.push({ value, fieldPath: path });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectStrings(item, `${path}[${index}]`, results),
    );
    return;
  }
  if (value !== null && typeof value === 'object') {
    Object.entries(value as Record<string, unknown>).forEach(
      ([key, item]) => {
        if (EXCLUDED_SETTING_KEYS.has(key)) {
          return;
        }
        collectStrings(item, path === '' ? key : `${path}.${key}`, results);
      },
    );
  }
}

function extractReferencedStepName(innerExpression: string): string | null {
  const flattenMatch = innerExpression.match(
    /flattenNestedKeys\(\s*([a-zA-Z_][a-zA-Z0-9_]*)/,
  );
  if (flattenMatch) {
    return flattenMatch[1];
  }
  const trimmed = innerExpression.trim();
  const rootMatch = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_]*)/);
  if (!rootMatch) {
    return null;
  }
  const root = rootMatch[1];
  if (RESERVED_REFERENCE_ROOTS.has(root)) {
    return null;
  }
  const afterRoot = trimmed.slice(root.length).trimStart();
  if (afterRoot.startsWith('(')) {
    return null;
  }
  return root;
}

function isPlainPathReference(innerExpression: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*|\[\s*['"][^'"]+['"]\s*\])*$/.test(
    innerExpression,
  );
}

function getPathAfterStep(innerExpression: string): string[] {
  const keyMatches = innerExpression.match(/\[\s*['"]([^'"]+)['"]\s*\]/g);
  if (!keyMatches) {
    return [];
  }
  return keyMatches.map((match) => {
    const keyMatch = match.match(/['"]([^'"]+)['"]/);
    return keyMatch ? keyMatch[1] : '';
  });
}

function hasPath(sampleData: unknown, path: string[]): boolean {
  let current: unknown = sampleData;
  for (const key of path) {
    if (current === null || typeof current !== 'object') {
      return false;
    }
    if (Object.prototype.hasOwnProperty.call(current, key)) {
      current = (current as Record<string, unknown>)[key];
      continue;
    }
    return false;
  }
  return true;
}

export const stepReferenceUtils = {
  findBrokenReferences({
    flowVersion,
    step,
    outputSampleData,
  }: {
    flowVersion: FlowVersion;
    step: FlowAction | FlowTrigger;
    outputSampleData: Record<string, unknown | undefined>;
  }): BrokenStepReference[] {
    const strings: { value: string; fieldPath: string }[] = [];
    collectStrings(step.settings, '', strings);

    const broken: BrokenStepReference[] = [];
    const reported = new Set<string>();
    const allSteps = flowStructureUtil.getAllSteps(flowVersion.trigger);

    strings.forEach(({ value, fieldPath }) => {
      extractMustacheTokens(value).forEach(({ inner }) => {
        const trimmedInner = inner.trim();
        const referencedStepName = extractReferencedStepName(trimmedInner);
        if (referencedStepName === null) {
          return;
        }
        const referencedStep = allSteps.find(
          (candidate) => candidate.name === referencedStepName,
        );
        let reason: BrokenStepReferenceReason | null = null;
        if (!referencedStep) {
          reason = 'step-missing';
        } else if (
          referencedStep.name !== step.name &&
          referencedStep.settings.sampleData?.lastTestDate === undefined
        ) {
          reason = 'sample-data-missing';
        } else if (isPlainPathReference(trimmedInner)) {
          const path = getPathAfterStep(trimmedInner).filter(
            (key) => key !== 'output' && key !== '',
          );
          if (
            path.length > 0 &&
            !hasPath(outputSampleData[referencedStepName], path)
          ) {
            reason = 'path-missing';
          }
        }
        if (reason === null) {
          return;
        }
        const dedupeKey = `${referencedStepName}.${fieldPath}.${reason}`;
        if (reported.has(dedupeKey)) {
          return;
        }
        reported.add(dedupeKey);
        broken.push({ stepName: referencedStepName, fieldPath, reason });
      });
    });
    return broken;
  },
};
