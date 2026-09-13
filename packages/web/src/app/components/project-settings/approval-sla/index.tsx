import {
  FlowApprovalPriority,
  isNil,
  Permission,
  UpsertApprovalSlaPolicyRequestBody,
} from '@activepieces/shared';
import { t } from 'i18next';
import { Timer } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import LockedFeatureGuard from '@/app/components/locked-feature-guard';
import { LoadingSpinner } from '@/components/custom/spinner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { approvalSlaPolicyHooks } from '@/features/flow-approvals';
import { projectMembersHooks } from '@/features/members/hooks/project-members-hooks';
import { useAuthorization } from '@/hooks/authorization-hooks';
import { platformHooks } from '@/hooks/platform-hooks';

const PRIORITIES = [
  FlowApprovalPriority.LOW,
  FlowApprovalPriority.NORMAL,
  FlowApprovalPriority.HIGH,
  FlowApprovalPriority.URGENT,
] as const;

const PRIORITY_LABELS: Record<FlowApprovalPriority, string> = {
  [FlowApprovalPriority.LOW]: 'Low',
  [FlowApprovalPriority.NORMAL]: 'Normal',
  [FlowApprovalPriority.HIGH]: 'High',
  [FlowApprovalPriority.URGENT]: 'Urgent',
};

type RuleDraft = {
  enabled: boolean;
  timeoutMinutes: number;
  escalationMinutes: number | undefined;
  escalationTargetUserIds: string[];
};

const DEFAULT_TIMEZONE = 'Etc/UTC';

const emptyRules = (): Record<FlowApprovalPriority, RuleDraft> => ({
  [FlowApprovalPriority.LOW]: {
    enabled: false,
    timeoutMinutes: 1440,
    escalationMinutes: undefined,
    escalationTargetUserIds: [],
  },
  [FlowApprovalPriority.NORMAL]: {
    enabled: true,
    timeoutMinutes: 480,
    escalationMinutes: undefined,
    escalationTargetUserIds: [],
  },
  [FlowApprovalPriority.HIGH]: {
    enabled: true,
    timeoutMinutes: 120,
    escalationMinutes: undefined,
    escalationTargetUserIds: [],
  },
  [FlowApprovalPriority.URGENT]: {
    enabled: true,
    timeoutMinutes: 30,
    escalationMinutes: undefined,
    escalationTargetUserIds: [],
  },
});

export function ApprovalSlaSettings() {
  const { platform } = platformHooks.useCurrentPlatform();
  const { checkAccess } = useAuthorization();
  const canEdit = checkAccess(Permission.WRITE_PROJECT);
  const { data: policy, isLoading } = approvalSlaPolicyHooks.usePolicy();
  const { projectMembers } = projectMembersHooks.useProjectMembers();
  const { mutateAsync: upsert, isPending: isSaving } =
    approvalSlaPolicyHooks.useUpsertPolicy();

  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const [rules, setRules] =
    useState<Record<FlowApprovalPriority, RuleDraft>>(emptyRules);

  useEffect(() => {
    if (!policy) {
      return;
    }
    const saved = policy.rules as Record<
      FlowApprovalPriority,
      {
        timeoutMinutes: number;
        escalationMinutes?: number;
        escalationTargetUserIds: string[];
      }
    >;
    setTimezone(policy.timezone ?? DEFAULT_TIMEZONE);
    setRules(
      PRIORITIES.reduce((acc, priority) => {
        const rule = saved[priority];
        acc[priority] = rule
          ? {
              enabled: true,
              timeoutMinutes: rule.timeoutMinutes,
              escalationMinutes: rule.escalationMinutes,
              escalationTargetUserIds: rule.escalationTargetUserIds ?? [],
            }
          : {
              enabled: false,
              timeoutMinutes: emptyRules()[priority].timeoutMinutes,
              escalationMinutes: undefined,
              escalationTargetUserIds: [],
            };
        return acc;
      }, {} as Record<FlowApprovalPriority, RuleDraft>),
    );
  }, [policy]);

  const timezones = useMemo(() => Intl.supportedValuesOf('timeZone'), []);
  const enabledPriorities = PRIORITIES.filter((p) => rules[p].enabled);

  const handleSave = async () => {
    const body: UpsertApprovalSlaPolicyRequestBody = {
      timezone,
      rules: enabledPriorities.map((priority) => {
        const draft = rules[priority];
        return {
          priority,
          rule: {
            timeoutMinutes: draft.timeoutMinutes,
            ...(isNil(draft.escalationMinutes) || draft.escalationMinutes <= 0
              ? {}
              : { escalationMinutes: draft.escalationMinutes }),
            escalationTargetUserIds: draft.escalationTargetUserIds,
          },
        };
      }),
    };
    await upsert(body);
  };

  const validationError = useMemo(() => {
    for (const priority of enabledPriorities) {
      const draft = rules[priority];
      if (draft.timeoutMinutes <= 0) {
        return t('Timeout must be greater than zero.');
      }
      if (
        !isNil(draft.escalationMinutes) &&
        draft.escalationMinutes > 0 &&
        draft.escalationMinutes <= draft.timeoutMinutes
      ) {
        return t('Escalation time must be after the SLA timeout.');
      }
    }
    return null;
  }, [rules, enabledPriorities]);

  return (
    <LockedFeatureGuard
      featureKey="ENVIRONMENT"
      locked={!platform.plan.environmentsEnabled}
      lockTitle={t('Enable Approval SLA')}
      lockDescription={t(
        'Track approval deadlines per priority with time-zone-aware due dates and automatic escalation.',
      )}
    >
      <div className="flex w-full flex-col gap-4">
        {isLoading ? (
          <div className="flex grow justify-center items-center py-12">
            <LoadingSpinner className="size-5" />
          </div>
        ) : (
          <>
            <Card className="w-full p-4 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Timer className="size-4" />
                <span className="font-medium">{t('Time zone')}</span>
              </div>
              <p className="text-sm text-muted-foreground">
                {t(
                  'Deadlines are calculated on the server in this time zone, including daylight-saving transitions.',
                )}
              </p>
              <Select
                value={timezone}
                onValueChange={setTimezone}
                disabled={!canEdit}
              >
                <SelectTrigger className="w-[320px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {timezones.map((tz) => (
                    <SelectItem key={tz} value={tz}>
                      {tz}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Card>

            <div className="flex flex-col gap-3">
              {PRIORITIES.map((priority) => (
                <PriorityRuleCard
                  key={priority}
                  priority={priority}
                  draft={rules[priority]}
                  disabled={!canEdit}
                  members={
                    projectMembers?.map((member) => ({
                      userId: member.userId,
                      label:
                        member.user.firstName || member.user.lastName
                          ? `${member.user.firstName ?? ''} ${
                              member.user.lastName ?? ''
                            }`.trim()
                          : member.user.email,
                    })) ?? []
                  }
                  onChange={(next) =>
                    setRules((prev) => ({ ...prev, [priority]: next }))
                  }
                />
              ))}
            </div>

            {validationError && (
              <p className="text-sm text-destructive">{validationError}</p>
            )}

            {canEdit && (
              <div className="flex justify-end">
                <Button
                  size="sm"
                  loading={isSaving}
                  disabled={enabledPriorities.length === 0 || !!validationError}
                  onClick={handleSave}
                >
                  {t('Save SLA policy')}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </LockedFeatureGuard>
  );
}

function PriorityRuleCard({
  priority,
  draft,
  disabled,
  members,
  onChange,
}: {
  priority: FlowApprovalPriority;
  draft: RuleDraft;
  disabled: boolean;
  members: { userId: string; label: string }[];
  onChange: (next: RuleDraft) => void;
}) {
  return (
    <Card className="w-full p-4 flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Checkbox
          checked={draft.enabled}
          disabled={disabled}
          onCheckedChange={(checked) =>
            onChange({ ...draft, enabled: checked === true })
          }
        />
        <span className="font-medium">{t(PRIORITY_LABELS[priority])}</span>
      </div>
      {draft.enabled && (
        <>
          <div className="flex items-center gap-3">
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">
                {t('Timeout (minutes)')}
              </Label>
              <Input
                type="number"
                min={1}
                className="w-40"
                value={draft.timeoutMinutes}
                disabled={disabled}
                onChange={(e) =>
                  onChange({ ...draft, timeoutMinutes: Number(e.target.value) })
                }
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">
                {t('Escalate after (minutes, optional)')}
              </Label>
              <Input
                type="number"
                min={0}
                className="w-60"
                value={draft.escalationMinutes ?? ''}
                placeholder={t('No escalation')}
                disabled={disabled}
                onChange={(e) =>
                  onChange({
                    ...draft,
                    escalationMinutes:
                      e.target.value === ''
                        ? undefined
                        : Number(e.target.value),
                  })
                }
              />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label className="text-xs text-muted-foreground">
              {t('Escalation targets')}
            </Label>
            {members.length === 0 ? (
              <span className="text-sm text-muted-foreground">
                {t('Add project members to select escalation targets.')}
              </span>
            ) : (
              <div className="grid grid-cols-2 gap-1">
                {members.map((member) => (
                  <label
                    key={member.userId}
                    className="flex items-center gap-2 text-sm cursor-pointer"
                  >
                    <Checkbox
                      checked={draft.escalationTargetUserIds.includes(
                        member.userId,
                      )}
                      disabled={disabled}
                      onCheckedChange={() =>
                        toggleTarget(draft, member.userId, onChange)
                      }
                    />
                    {member.label}
                  </label>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

function toggleTarget(
  draft: RuleDraft,
  userId: string,
  onChange: (next: RuleDraft) => void,
) {
  const current = draft.escalationTargetUserIds;
  onChange({
    ...draft,
    escalationTargetUserIds: current.includes(userId)
      ? current.filter((id) => id !== userId)
      : [...current, userId],
  });
}
