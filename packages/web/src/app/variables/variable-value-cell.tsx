import { Permission } from '@activepieces/core-utils';
import { VariableListItem, VariableType } from '@activepieces/shared';
import { useMutation } from '@tanstack/react-query';
import { t } from 'i18next';
import { Copy, Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { TextWithTooltip } from '@/components/custom/text-with-tooltip';
import { Button } from '@/components/ui/button';
import { internalErrorToast } from '@/components/ui/sonner';
import { variablesApi } from '@/features/variables/api/variables';
import { useAuthorization } from '@/hooks/authorization-hooks';

export function VariableValueCell({
  variable,
}: {
  variable: VariableListItem;
}) {
  const { checkAccess } = useAuthorization();
  const canWrite = checkAccess(Permission.WRITE_VARIABLE);
  const [revealedValue, setRevealedValue] = useState<string | null>(null);

  const { mutate: reveal, isPending } = useMutation({
    mutationFn: () => variablesApi.reveal(variable.id),
    onSuccess: (response) => {
      setRevealedValue(response.value);
    },
    onError: () => {
      internalErrorToast();
    },
  });

  if (variable.type === VariableType.TEXT) {
    return <VisibleValue value={variable.value ?? ''} />;
  }

  if (revealedValue !== null) {
    return (
      <VisibleValue
        value={revealedValue}
        onHide={() => setRevealedValue(null)}
      />
    );
  }

  return (
    <div className="flex items-center gap-1">
      <span className="font-mono text-sm text-muted-foreground select-none">
        ••••••••
      </span>
      {canWrite && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          loading={isPending}
          onClick={() => reveal()}
          aria-label={t('Reveal value')}
        >
          <Eye className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

function VisibleValue({
  value,
  onHide,
}: {
  value: string;
  onHide?: () => void;
}) {
  return (
    <div className="flex items-center gap-1 min-w-0">
      <TextWithTooltip tooltipMessage={value}>
        <p className="font-mono text-sm truncate">{value}</p>
      </TextWithTooltip>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        onClick={() => void copyValueToClipboard(value)}
        aria-label={t('Copy value')}
      >
        <Copy className="h-4 w-4" />
      </Button>
      {onHide && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={onHide}
          aria-label={t('Hide value')}
        >
          <EyeOff className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

const copyValueToClipboard = async (value: string) => {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(t('Value copied to clipboard'));
  } catch {
    toast.error(t('Could not copy value'));
  }
};
