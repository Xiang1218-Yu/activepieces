import { t } from 'i18next';
import { Check, Zap } from 'lucide-react';
import { motion } from 'motion/react';

import { Button } from '@/components/ui/button';
import { PieceIconWithPieceName } from '@/features/pieces/components/piece-icon-from-name';

import { ActionPlanData, normalizePieceName } from '../lib/message-parsers';

import { InteractiveCardShell } from './interactive-card-shell';

function AppRow({ app }: { app: { piece: string; displayName: string } }) {
  return (
    <div className="flex items-center gap-2.5">
      <PieceIconWithPieceName
        pieceName={normalizePieceName(app.piece)}
        size="sm"
        border={false}
        showTooltip={false}
      />
      <span className="text-sm font-medium truncate">{app.displayName}</span>
    </div>
  );
}

function ConfirmedState({ plan }: { plan: ActionPlanData }) {
  return (
    <motion.div
      className="rounded-xl border bg-background overflow-hidden my-2"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2 }}
    >
      <div className="p-4 flex items-start gap-3">
        <div className="bg-green-500 rounded-full p-1 mt-0.5 shrink-0">
          <Check className="h-3 w-3 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold">{t('Plan confirmed')}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {plan.summary}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export function ActionPlanCard({
  plan,
  onConfirm,
  onDismiss,
  isInteractive = true,
}: ActionPlanCardProps) {
  const apps = plan.apps ?? [];
  const sideEffects = plan.sideEffects ?? [];

  if (!isInteractive) {
    return <ConfirmedState plan={plan} />;
  }

  return (
    <InteractiveCardShell
      onDismiss={() => onDismiss?.()}
      title={t("Here's what I'll do")}
    >
      <p className="text-sm text-foreground pb-3">{plan.summary}</p>

      {apps.length > 0 && (
        <div className="pb-3">
          <div className="text-xs font-medium text-muted-foreground pb-2">
            {t('Apps involved')}
          </div>
          <div className="flex flex-col gap-2.5">
            {apps.map((app) => (
              <AppRow key={`${app.piece}-${app.displayName}`} app={app} />
            ))}
          </div>
        </div>
      )}

      {sideEffects.length > 0 && (
        <div className="pb-1">
          <div className="text-xs font-medium text-muted-foreground pb-2">
            {t('What will change')}
          </div>
          <div className="flex flex-col gap-1.5">
            {sideEffects.map((effect, i) => (
              <div key={i} className="flex items-start gap-2">
                <Zap className="h-3.5 w-3.5 shrink-0 mt-0.5 text-muted-foreground" />
                <span className="text-sm text-foreground">{effect}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-end pt-3 border-t mt-3">
        <Button size="sm" className="gap-1.5" onClick={onConfirm}>
          <Check className="h-3.5 w-3.5" />
          {t('Confirm & connect')}
        </Button>
      </div>
    </InteractiveCardShell>
  );
}

type ActionPlanCardProps = {
  plan: ActionPlanData;
  onConfirm?: () => void;
  onDismiss?: () => void;
  isInteractive?: boolean;
};
