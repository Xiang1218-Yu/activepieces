import { DiffReleaseRequest, ProjectReleaseType } from '@activepieces/shared';
import { Rocket } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { projectReleaseMutations } from '@/features/project-releases';

import { CreateReleaseDialog } from '../../project-release/create-release-dialog';

type ContinueToReleaseButtonProps = {
  snapshotToken: string;
  sourceProjectId: string;
  targetProjectId: string;
  hasBlockers: boolean;
};

export function ContinueToReleaseButton({
  snapshotToken,
  sourceProjectId,
  targetProjectId,
  hasBlockers,
}: ContinueToReleaseButtonProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<
    Parameters<typeof CreateReleaseDialog>[0]['plan'] | null
  >(null);
  const [loading, setLoading] = useState(false);

  const diffRequest: DiffReleaseRequest = {
    projectId: targetProjectId,
    type: ProjectReleaseType.PROJECT,
    targetProjectId: sourceProjectId,
    snapshotToken,
  };

  const { mutate: diffRelease } = projectReleaseMutations.useDiffRelease({
    onSuccess: (resolvedPlan) => {
      setLoading(false);
      setPlan(resolvedPlan);
      setOpen(true);
    },
    onError: () => {
      setLoading(false);
    },
  });

  return (
    <>
      <Button
        size="sm"
        loading={loading}
        onClick={() => {
          setLoading(true);
          diffRelease(diffRequest);
        }}
      >
        <Rocket className="size-4 mr-2" />
        {hasBlockers
          ? t('Continue despite blockers')
          : t('Continue to release')}
      </Button>
      {plan && (
        <CreateReleaseDialog
          open={open}
          setOpen={setOpen}
          loading={false}
          refetch={() => undefined}
          diffRequest={diffRequest}
          plan={plan}
        />
      )}
    </>
  );
}
