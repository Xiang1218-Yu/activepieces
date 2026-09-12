import { repoFactory } from '../../core/db/repo-factory'
import { FlowVersionEntity } from './flow-version-entity'

export const flowVersionRepo = repoFactory(FlowVersionEntity)
