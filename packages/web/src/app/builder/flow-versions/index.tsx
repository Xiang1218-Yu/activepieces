import { t } from 'i18next';
import { GitCompareArrows } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { useBuilderStateContext } from '@/app/builder/builder-hooks';
import { RightSideBarType } from '@/app/builder/types';
import { CardList, CardListItemSkeleton } from '@/components/custom/card-list';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { buildFlowVersionCompareUrl, flowHooks } from '@/features/flows';

import { SidebarHeader } from '../sidebar-header';

import { FlowVersionDetailsCard } from './flow-versions-card';

const FlowVersionsList = () => {
  const [flow, setRightSidebar, selectedFlowVersion] = useBuilderStateContext(
    (state) => [state.flow, state.setRightSidebar, state.flowVersion],
  );
  const navigate = useNavigate();

  const {
    data: flowVersionPage,
    isLoading,
    isError,
  } = flowHooks.useListFlowVersions(flow.id);

  const openComparePage = () => {
    navigate(buildFlowVersionCompareUrl({ flowId: flow.id }));
  };

  return (
    <>
      <SidebarHeader
        onClose={() => setRightSidebar(RightSideBarType.NONE)}
        actions={
          <Button
            variant="ghost"
            size="sm"
            className="gap-1 px-2 text-xs"
            onClick={openComparePage}
          >
            <GitCompareArrows className="size-4" />
            {t('Compare')}
          </Button>
        }
      >
        {t('Version History')}
      </SidebarHeader>
      <CardList>
        {isLoading && <CardListItemSkeleton numberOfCards={10} />}
        {isError && <div>{t('Error, please try again.')}</div>}
        {flowVersionPage && flowVersionPage.data && (
          <ScrollArea className="w-full h-full">
            {flowVersionPage.data.map((flowVersion, index) => (
              <FlowVersionDetailsCard
                selected={flowVersion.id === selectedFlowVersion?.id}
                publishedVersionId={flow.publishedVersionId}
                flowVersion={flowVersion}
                flowVersionNumber={flowVersionPage.data.length - index}
                key={flowVersion.id}
              />
            ))}
          </ScrollArea>
        )}
      </CardList>
    </>
  );
};

FlowVersionsList.displayName = 'FlowVersionsList';

export { FlowVersionsList };
