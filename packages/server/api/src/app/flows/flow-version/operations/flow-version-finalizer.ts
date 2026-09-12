import { sanitizeObjectForPostgresql, UserId } from '@activepieces/core-utils'
import { flowStructureUtil, FlowVersion } from '@activepieces/shared'
import dayjs from 'dayjs'
import { EntityManager } from 'typeorm'
import { flowVersionRepo } from '../flow-version.repo'

export type FinalizeAndSaveParams = {
    userId: UserId | null
    entityManager?: EntityManager
    flowVersion: FlowVersion
}

/**
 * Maintains version-level derived fields after every operation batch and
 * persists the version exactly once. Keeping this out of applyOperation
 * separates "apply operations to a draft in memory" from "touch timestamps,
 * re-extract references and write a row".
 */
export async function finalizeAndSaveVersion({
    userId,
    entityManager,
    flowVersion,
}: FinalizeAndSaveParams): Promise<FlowVersion> {
    flowVersion.updated = dayjs().toISOString()
    if (userId) {
        flowVersion.updatedBy = userId
    }
    flowVersion.connectionIds =
    flowStructureUtil.extractConnectionIds(flowVersion)
    flowVersion.agentIds = flowStructureUtil.extractAgentIds(flowVersion)
    return flowVersionRepo(entityManager).save(
        sanitizeObjectForPostgresql(flowVersion),
    )
}
