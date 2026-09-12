import { useMemo } from 'react';
import { useParams } from 'react-router-dom';

import { WebhookRequestDetail } from '@/features/webhook-requests';
import { flowHooks } from '@/features/flows/hooks/flow-hooks';
import { webhookRequestHooks } from '@/features/webhook-requests/hooks/webhook-request-hooks';
import { authenticationSession } from '@/lib/authentication-session';

const WebhookRequestDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const projectId = authenticationSession.getProjectId();
  const { data: capture } = webhookRequestHooks.useCapture(id, projectId);
  const { data: flowsData } = flowHooks.useFlows({
    limit: 1000,
    cursor: undefined,
  });
  const flowName = useMemo(() => {
    if (!capture || !flowsData) {
      return undefined;
    }
    return flowsData.data.find((flow) => flow.id === capture.flowId)?.version
      .displayName;
  }, [capture, flowsData]);
  return <WebhookRequestDetail captureId={id!} flowName={flowName} />;
};

export { WebhookRequestDetailPage as default };
