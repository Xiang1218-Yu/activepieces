import { agentToolClassification } from '@activepieces/shared';
import { t } from 'i18next';

// What a configured action asks for before it can run. Shown on the agent page so a long tool
// list still reveals which entries need an account and which stop for approval.
export type ToolRequirementKind = 'connection' | 'approval';

export type ToolRequirement = {
  kind: ToolRequirementKind;
  label: string;
};

export function pieceActionRequirements({
  actionName,
  needsConnection,
}: {
  actionName: string;
  needsConnection: boolean;
}): ToolRequirement[] {
  const requirements: ToolRequirement[] = [];
  if (needsConnection) {
    requirements.push({
      kind: 'connection',
      label: t('Requires a connection'),
    });
  }
  // The run-time gate pauses for write-shaped verbs (send/create/delete/...) and anything whose
  // name does not prove it is read-only, so the same conservative classification is shown here.
  if (agentToolClassification.requiresActionPreview({ actionName })) {
    requirements.push({
      kind: 'approval',
      label: t('Asks for approval before changing things'),
    });
  }
  return requirements;
}
