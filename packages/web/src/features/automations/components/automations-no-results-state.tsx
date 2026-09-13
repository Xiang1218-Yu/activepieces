import { t } from 'i18next';
import { SearchX } from 'lucide-react';

import { Button } from '@/components/ui/button';

type AutomationsNoResultsStateProps = {
  onClearFilters: () => void;
  variant?: 'no-match' | 'conflict' | 'empty-project';
};

export const AutomationsNoResultsState = ({
  onClearFilters,
  variant = 'no-match',
}: AutomationsNoResultsStateProps) => {
  const content = NO_RESULTS_CONTENT[variant];

  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
        <SearchX className="h-6 w-6 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold mb-2">{t(content.title)}</h3>
      <p className="text-sm text-muted-foreground text-center max-w-md mb-4">
        {t(content.description)}
      </p>
      <Button variant="outline" onClick={onClearFilters}>
        {t('Clear filters')}
      </Button>
    </div>
  );
};

const NO_RESULTS_CONTENT = {
  'no-match': {
    title: 'No results found',
    description:
      "We couldn't find any automations matching your search or filters. Try adjusting your criteria.",
  },
  conflict: {
    title: 'These filters cannot be combined',
    description:
      'Run status and run-time filters only apply to flows, but your current type filter shows tables only. Remove one of the conflicting filters.',
  },
  'empty-project': {
    title: 'Nothing in this project yet',
    description:
      'There are no automations in this project that match these filters, and the project has no flows or tables yet. Clear the filters or create your first automation.',
  },
} as const;
