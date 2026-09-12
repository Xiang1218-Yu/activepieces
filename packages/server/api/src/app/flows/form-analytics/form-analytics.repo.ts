import { FlowRun } from '@activepieces/shared'
import { repoFactory } from '../../core/db/repo-factory'
import { FlowRunEntity } from '../flow-run/flow-run-entity'
import { FormFieldInteractionEntity } from './form-field-interaction-entity'
import { FormSessionEntity } from './form-analytics-session-entity'

export const formSessionRepo = repoFactory(FormSessionEntity)
export const formFieldInteractionRepo = repoFactory(FormFieldInteractionEntity)
export const formAnalyticsRunRepo = repoFactory<FlowRun>(FlowRunEntity)
