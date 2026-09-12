import {
  CheckPieceCompatibilityRequest,
  PieceCompatibilityReport,
} from '@activepieces/shared';

import { api } from '@/lib/api';

export const pieceCompatibilityApi = {
  check(
    request: CheckPieceCompatibilityRequest,
  ): Promise<PieceCompatibilityReport> {
    return api.post<PieceCompatibilityReport>(
      '/v1/piece-compatibility/check',
      request,
    );
  },
};
