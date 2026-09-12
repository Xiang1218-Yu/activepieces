import { authenticationSession } from '@/lib/authentication-session';

export const FLOW_VERSION_COMPARE_FROM_PARAM = 'fromVersionId';
export const FLOW_VERSION_COMPARE_TO_PARAM = 'toVersionId';

export const buildFlowVersionCompareUrl = ({
  flowId,
  fromVersionId,
  toVersionId,
}: {
  flowId: string;
  fromVersionId?: string;
  toVersionId?: string;
}): string => {
  const params = new URLSearchParams();
  if (fromVersionId) {
    params.set(FLOW_VERSION_COMPARE_FROM_PARAM, fromVersionId);
  }
  if (toVersionId) {
    params.set(FLOW_VERSION_COMPARE_TO_PARAM, toVersionId);
  }
  const query = params.toString();
  return authenticationSession.appendProjectRoutePrefix(
    `/flows/${flowId}/versions/compare${query ? `?${query}` : ''}`,
  );
};
