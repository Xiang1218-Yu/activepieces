import {
  GetTriggerCalendarRequest,
  TriggerCalendarResponse,
} from '@activepieces/shared';

import { api } from '@/lib/api';
import { authenticationSession } from '@/lib/authentication-session';

export const triggerCalendarApi = {
  get(
    request: Omit<GetTriggerCalendarRequest, 'projectId'>,
  ): Promise<TriggerCalendarResponse> {
    return api.get<TriggerCalendarResponse>('/v1/trigger-calendar/calendar', {
      projectId: authenticationSession.getProjectId()!,
      ...request,
    });
  },
};
