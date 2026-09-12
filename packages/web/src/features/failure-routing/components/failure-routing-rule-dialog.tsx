import {
  FailureCategory,
  FailureRoutingRule,
  FailureRoutingRuleTarget,
  FailureRoutingTargetType,
} from '@activepieces/shared';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { authenticationSession } from '@/lib/authentication-session';

import { failureRoutingMutations } from '../hooks/failure-routing-hooks';

type FormValues = {
  displayName: string;
  priority: number;
  enabled: boolean;
  stopOnMatch: boolean;
  flowIdsCsv: string;
  categories: FailureCategory[];
  minRetryCount: string;
  maxRetryCount: string;
  targetType: FailureRoutingTargetType;
  url: string;
  emailsCsv: string;
};

const EMPTY_VALUES: FormValues = {
  displayName: '',
  priority: 100,
  enabled: true,
  stopOnMatch: false,
  flowIdsCsv: '',
  categories: [],
  minRetryCount: '',
  maxRetryCount: '',
  targetType: FailureRoutingTargetType.EMAIL,
  url: '',
  emailsCsv: '',
};

const CATEGORY_OPTIONS: { value: FailureCategory; label: string }[] = [
  { value: FailureCategory.FAILED, label: 'Failed' },
  { value: FailureCategory.TIMEOUT, label: 'Timeout' },
  { value: FailureCategory.INTERNAL_ERROR, label: 'Internal error' },
  {
    value: FailureCategory.MEMORY_LIMIT_EXCEEDED,
    label: 'Memory limit exceeded',
  },
  {
    value: FailureCategory.LOG_SIZE_EXCEEDED,
    label: 'Log size exceeded',
  },
  { value: FailureCategory.QUOTA_EXCEEDED, label: 'Quota exceeded' },
];

type FailureRoutingRuleDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rule?: FailureRoutingRule;
};

const splitCsv = (value: string) =>
  value
    .split(/[\s,;]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

export const FailureRoutingRuleDialog = ({
  open,
  onOpenChange,
  rule,
}: FailureRoutingRuleDialogProps) => {
  const projectId = authenticationSession.getProjectId()!;
  const { mutate: createRule, isPending: creating } =
    failureRoutingMutations.useCreateRule();
  const { mutate: updateRule, isPending: updating } =
    failureRoutingMutations.useUpdateRule();
  const [values, setValues] = useState<FormValues>(EMPTY_VALUES);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    if (rule) {
      setValues({
        displayName: rule.displayName,
        priority: rule.priority,
        enabled: rule.enabled,
        stopOnMatch: rule.stopOnMatch,
        flowIdsCsv: rule.filter.flowIds?.join(', ') ?? '',
        categories: rule.filter.categories ?? [],
        minRetryCount: rule.filter.minRetryCount?.toString() ?? '',
        maxRetryCount: rule.filter.maxRetryCount?.toString() ?? '',
        targetType: rule.target.type,
        url:
          rule.target.type === FailureRoutingTargetType.EVENT_DESTINATION
            ? rule.target.url
            : '',
        emailsCsv:
          rule.target.type === FailureRoutingTargetType.EMAIL
            ? rule.target.emails.join(', ')
            : '',
      });
    } else {
      setValues(EMPTY_VALUES);
    }
    setError(null);
  }, [open, rule]);

  const toggleCategory = (category: FailureCategory) => {
    setValues((current) => ({
      ...current,
      categories: current.categories.includes(category)
        ? current.categories.filter((entry) => entry !== category)
        : [...current.categories, category],
    }));
  };

  const buildTarget = (): FailureRoutingRuleTarget | null => {
    if (values.targetType === FailureRoutingTargetType.EMAIL) {
      const emails = splitCsv(values.emailsCsv);
      if (emails.length === 0) {
        setError('At least one email address is required.');
        return null;
      }
      return { type: FailureRoutingTargetType.EMAIL, emails };
    }
    try {
      // eslint-disable-next-line no-new
      new URL(values.url);
    } catch {
      setError('A valid destination URL is required.');
      return null;
    }
    return {
      type: FailureRoutingTargetType.EVENT_DESTINATION,
      url: values.url,
    };
  };

  const handleSubmit = () => {
    setError(null);
    if (values.displayName.trim().length === 0) {
      setError('Rule name is required.');
      return;
    }
    const target = buildTarget();
    if (target === null) {
      return;
    }
    const minRetryCount =
      values.minRetryCount === '' ? undefined : Number(values.minRetryCount);
    const maxRetryCount =
      values.maxRetryCount === '' ? undefined : Number(values.maxRetryCount);
    if (
      (minRetryCount !== undefined && Number.isNaN(minRetryCount)) ||
      (maxRetryCount !== undefined && Number.isNaN(maxRetryCount)) ||
      (minRetryCount !== undefined &&
        maxRetryCount !== undefined &&
        minRetryCount > maxRetryCount)
    ) {
      setError('Retry range is invalid.');
      return;
    }
    const flowIds = splitCsv(values.flowIdsCsv);
    const filter = {
      ...(flowIds.length > 0 ? { flowIds } : {}),
      ...(values.categories.length > 0 ? { categories: values.categories } : {}),
      ...(minRetryCount !== undefined ? { minRetryCount } : {}),
      ...(maxRetryCount !== undefined ? { maxRetryCount } : {}),
    };

    if (rule) {
      updateRule(
        {
          ruleId: rule.id,
          request: {
            displayName: values.displayName.trim(),
            priority: values.priority,
            enabled: values.enabled,
            stopOnMatch: values.stopOnMatch,
            filter,
            target,
          },
        },
        { onSuccess: () => onOpenChange(false) },
      );
      return;
    }
    createRule(
      {
        projectId,
        displayName: values.displayName.trim(),
        priority: values.priority,
        enabled: values.enabled,
        stopOnMatch: values.stopOnMatch,
        filter,
        target,
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{rule ? 'Edit routing rule' : 'New routing rule'}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-[1fr,120px] gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Name</Label>
              <Input
                value={values.displayName}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    displayName: event.target.value,
                  }))
                }
                placeholder="On-call: payments failures"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Priority</Label>
              <Input
                type="number"
                value={values.priority}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    priority: Number(event.target.value),
                  }))
                }
              />
            </div>
          </div>

          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={values.enabled}
                onCheckedChange={(enabled) =>
                  setValues((current) => ({ ...current, enabled }))
                }
              />
              Enabled
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={values.stopOnMatch}
                onCheckedChange={(stopOnMatch) =>
                  setValues((current) => ({ ...current, stopOnMatch }))
                }
              />
              Stop evaluating lower-priority rules on match
            </label>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Flow IDs (optional, comma-separated; empty = any flow)</Label>
            <Textarea
              rows={2}
              value={values.flowIdsCsv}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  flowIdsCsv: event.target.value,
                }))
              }
              placeholder="0SHf... , 2x9a..."
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Error categories (empty = any failure)</Label>
            <div className="flex flex-wrap gap-2">
              {CATEGORY_OPTIONS.map((option) => {
                const selected = values.categories.includes(option.value);
                return (
                  <button
                    type="button"
                    key={option.value}
                    onClick={() => toggleCategory(option.value)}
                    className={`rounded-full border px-3 py-1 text-xs ${
                      selected
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'text-muted-foreground'
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Min retry count</Label>
              <Input
                type="number"
                min={0}
                value={values.minRetryCount}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    minRetryCount: event.target.value,
                  }))
                }
                placeholder="0"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Max retry count</Label>
              <Input
                type="number"
                min={0}
                value={values.maxRetryCount}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    maxRetryCount: event.target.value,
                  }))
                }
                placeholder="Any"
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Notify via</Label>
            <Select
              value={values.targetType}
              onValueChange={(targetType) =>
                setValues((current) => ({
                  ...current,
                  targetType: targetType as FailureRoutingTargetType,
                }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={FailureRoutingTargetType.EMAIL}>
                  Email
                </SelectItem>
                <SelectItem value={FailureRoutingTargetType.EVENT_DESTINATION}>
                  Event destination (webhook)
                </SelectItem>
              </SelectContent>
            </Select>
            {values.targetType === FailureRoutingTargetType.EMAIL ? (
              <Input
                value={values.emailsCsv}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    emailsCsv: event.target.value,
                  }))
                }
                placeholder="oncall-payments@company.com, backup@company.com"
              />
            ) : (
              <Input
                value={values.url}
                onChange={(event) =>
                  setValues((current) => ({ ...current, url: event.target.value }))
                }
                placeholder="https://hooks.example.com/failures"
              />
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            loading={creating || updating}
          >
            {rule ? 'Save changes' : 'Create rule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
