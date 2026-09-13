import { SampleDataFileType } from '@activepieces/shared';
import { describe, expect, it } from 'vitest';

import { getSampleDataSaveKey } from '@/app/builder/state/flow-state';

describe('getSampleDataSaveKey', () => {
  it('builds a unique key per step and sample data type', () => {
    expect(
      getSampleDataSaveKey({
        stepName: 'step_1',
        type: SampleDataFileType.OUTPUT,
      }),
    ).toBe('step_1.OUTPUT');
    expect(
      getSampleDataSaveKey({
        stepName: 'step_1',
        type: SampleDataFileType.INPUT,
      }),
    ).toBe('step_1.INPUT');
    expect(
      getSampleDataSaveKey({
        stepName: 'step_2',
        type: SampleDataFileType.OUTPUT,
      }),
    ).toBe('step_2.OUTPUT');
  });
});
