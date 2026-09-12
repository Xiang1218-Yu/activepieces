import {
  GetTriggerCalendarRequest,
  TriggerCalendarResponse,
} from '@activepieces/shared';
import { useQuery } from '@tanstack/react-query';

import { authenticationSession } from '@/lib/authentication-session';

import { triggerCalendarApi } from '../api/trigger-calendar-api';

export type TriggerCalendarFilters = Omit<
  GetTriggerCalendarRequest,
  'projectId'
>;

export const triggerCalendarHooks = {
  useCalendar: (filters: TriggerCalendarFilters) => {
    const projectId = authenticationSession.getProjectId();
    return useQuery<TriggerCalendarResponse>({
      queryKey: ['trigger-calendar', projectId, filters],
      queryFn: () => triggerCalendarApi.get(filters),
      enabled: !projectId ? false : undefined,
      refetchInterval: 5 * 60 * 1000,
    });
  },
};
