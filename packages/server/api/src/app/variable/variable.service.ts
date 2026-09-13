import { ActivepiecesError, ApId, apId, Cursor, ErrorCode, isNil, Metadata, PlatformId, ProjectId, SeekPage, spreadIfDefined, UserId } from '@activepieces/core-utils'
import { AppConnectionOwners, Variable, VariableListItem, VariableType, VariableValue, VariableWithoutSensitiveData } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { Between, Equal, FindOperator, ILike, In, LessThanOrEqual, MoreThanOrEqual, QueryFailedError } from 'typeorm'
import { repoFactory } from '../core/db/repo-factory'
import { flowVersionRepo } from '../flows/flow-version/flow-version.service'
import { encryptUtils } from '../helper/encryption'
import { buildPaginator } from '../helper/pagination/build-paginator'
import { paginationHelper } from '../helper/pagination/pagination-utils'
import { mapToUserWithMetaInformation } from '../user/user-service'
import { VariableEntity, VariableSchema } from './variable.entity'

export const variableRepo = repoFactory(VariableEntity)

export const variableService = (log: FastifyBaseLogger) => ({
    async create(params: CreateParams): Promise<VariableWithoutSensitiveData> {
        const { projectId, platformId, name, type, value, ownerId, metadata } = params
        const id = apId()
        try {
            await variableRepo().insert({
                id,
                projectId,
                platformId,
                name,
                type: type ?? VariableType.SECRET,
                ownerId: ownerId ?? null,
                value: await encryptUtils.encryptObject({ secret_text: value }),
                ...spreadIfDefined('metadata', metadata),
            })
        }
        catch (error) {
            if (isUniqueViolation(error)) {
                throw new ActivepiecesError({
                    code: ErrorCode.VALIDATION,
                    params: { message: 'Variable name already used' },
                })
            }
            throw error
        }
        log.info({ id, project: { id: projectId }, name }, 'Variable created')
        return getOneOrThrowWithoutValue({ id, projectId, platformId })
    },

    async update(params: UpdateParams): Promise<VariableWithoutSensitiveData> {
        const { id, projectId, platformId, type, value, metadata } = params
        await getOneOrThrowWithoutValue({ id, projectId, platformId })
        await variableRepo().update({ id, projectId, platformId }, {
            ...(isNil(value) ? {} : { value: await encryptUtils.encryptObject({ secret_text: value }) }),
            ...spreadIfDefined('type', type),
            ...spreadIfDefined('metadata', metadata),
        })
        log.info({ id, project: { id: projectId } }, 'Variable updated')
        return getOneOrThrowWithoutValue({ id, projectId, platformId })
    },

    async list(params: ListParams): Promise<SeekPage<VariableListItem>> {
        const { projectId, platformId, cursor, limit, name, types, updatedAfter, updatedBefore, usedInFlows, includeValues } = params
        const usedNames = await getUsedVariableNames({ projectId })
        const wantsUsed = usedInFlows?.includes(true) ?? false
        const wantsUnused = usedInFlows?.includes(false) ?? false
        const filterByUsage = wantsUsed !== wantsUnused
        if (filterByUsage && wantsUsed && usedNames.size === 0) {
            return paginationHelper.createPage<VariableListItem>([], null)
        }

        const decodedCursor = paginationHelper.decodeCursor(cursor ?? null)
        const paginator = buildPaginator({
            entity: VariableEntity,
            query: {
                limit: limit ?? 10,
                order: 'ASC',
                afterCursor: decodedCursor.nextCursor,
                beforeCursor: decodedCursor.previousCursor,
            },
        })

        const queryBuilder = variableRepo()
            .createQueryBuilder('variable')
            .leftJoinAndSelect('variable.owner', 'owner')
            .leftJoinAndSelect('owner.identity', 'owner_identity')
            .where({
                projectId: Equal(projectId),
                platformId: Equal(platformId),
                ...(isNil(name) ? {} : { name: ILike(`%${name}%`) }),
                ...(isNil(types) || types.length === 0 ? {} : { type: In(types) }),
                ...buildUpdatedCondition({ updatedAfter, updatedBefore }),
            })
        if (filterByUsage && usedNames.size > 0) {
            queryBuilder.andWhere(
                wantsUsed ? 'variable.name IN (:...usedNames)' : 'variable.name NOT IN (:...usedNames)',
                { usedNames: [...usedNames] },
            )
        }

        const { data, cursor: nextCursor } = await paginator.paginate(queryBuilder)
        const items = await Promise.all(data.map(async (row) => ({
            ...(await toResponse(row, { includeValue: includeValues === true })),
            usedInFlows: usedNames.has(row.name),
        })))
        return paginationHelper.createPage<VariableListItem>(items, nextCursor)
    },

    async getOwners(params: { projectId: ProjectId, platformId: PlatformId }): Promise<AppConnectionOwners[]> {
        const { projectId, platformId } = params
        return variableRepo()
            .createQueryBuilder('variable')
            .innerJoin('variable.owner', 'owner')
            .innerJoin('owner.identity', 'owner_identity')
            .select('owner_identity.firstName', 'firstName')
            .addSelect('owner_identity.lastName', 'lastName')
            .addSelect('owner_identity.email', 'email')
            .where('variable.projectId = :projectId', { projectId })
            .andWhere('variable.platformId = :platformId', { platformId })
            .distinct(true)
            .limit(MAX_VARIABLE_OWNERS)
            .getRawMany<AppConnectionOwners>()
    },

    async getOneOrThrowWithoutValue(params: GetOneParams): Promise<VariableWithoutSensitiveData> {
        return getOneOrThrowWithoutValue(params)
    },

    async getDecryptedValue(params: GetOneParams): Promise<string> {
        const { id, projectId, platformId } = params
        const row = await variableRepo().findOneBy({ id, projectId, platformId })
        if (isNil(row)) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: {
                    entityId: id,
                    entityType: 'Variable',
                },
            })
        }
        const decrypted = await encryptUtils.decryptObject<VariableValue>(row.value)
        return decrypted.secret_text
    },

    async getDecryptedValueForWorker(params: GetForWorkerParams): Promise<string> {
        const { projectId, name } = params
        const row = await variableRepo().findOneBy({ projectId, name })
        if (isNil(row)) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: {
                    entityId: `name=${name}`,
                    entityType: 'Variable',
                },
            })
        }
        const decrypted = await encryptUtils.decryptObject<VariableValue>(row.value)
        return decrypted.secret_text
    },

    async delete(params: GetOneParams): Promise<VariableWithoutSensitiveData> {
        const target = await getOneOrThrowWithoutValue(params)
        await variableRepo().delete({ id: params.id, projectId: params.projectId, platformId: params.platformId })
        log.info({ id: params.id, project: { id: params.projectId } }, 'Variable deleted')
        return target
    },
})

async function getOneOrThrowWithoutValue(params: GetOneParams): Promise<VariableWithoutSensitiveData> {
    const { id, projectId, platformId } = params
    const row = await variableRepo()
        .createQueryBuilder('variable')
        .leftJoinAndSelect('variable.owner', 'owner')
        .leftJoinAndSelect('owner.identity', 'owner_identity')
        .where({ id, projectId, platformId })
        .getOne()
    if (isNil(row)) {
        throw new ActivepiecesError({
            code: ErrorCode.ENTITY_NOT_FOUND,
            params: {
                entityId: id,
                entityType: 'Variable',
            },
        })
    }
    return toResponse(row)
}

async function getUsedVariableNames({ projectId }: { projectId: ProjectId }): Promise<Set<string>> {
    const latestVersionSubquery = flowVersionRepo()
        .createQueryBuilder('fv_latest')
        .select('fv_latest.id')
        .where('fv_latest."flowId" = flow.id')
        .orderBy('fv_latest.created', 'DESC')
        .limit(1)

    const rows = await flowVersionRepo()
        .createQueryBuilder('flow_version')
        .innerJoin('flow_version.flow', 'flow')
        .select('(regexp_matches(flow_version.trigger::text, :mentionPattern, \'g\'))[1]', 'name')
        .distinct(true)
        .where('flow."projectId" = :projectId', { projectId })
        .andWhere(`(flow_version.id = flow."publishedVersionId" OR flow_version.id = (${latestVersionSubquery.getQuery()}))`)
        .setParameter('mentionPattern', VARIABLE_MENTION_PATTERN)
        .getRawMany<{ name: string }>()

    return new Set(rows.map((row) => row.name).filter((name) => !isNil(name)))
}

function buildUpdatedCondition({ updatedAfter, updatedBefore }: BuildUpdatedConditionParams): Record<string, FindOperator<Date>> {
    const after = parseDateParam(updatedAfter)
    const before = parseDateParam(updatedBefore)
    if (!isNil(after) && !isNil(before)) {
        return { updated: Between(after, before) }
    }
    if (!isNil(after)) {
        return { updated: MoreThanOrEqual(after) }
    }
    if (!isNil(before)) {
        return { updated: LessThanOrEqual(before) }
    }
    return {}
}

function parseDateParam(value: string | undefined): Date | undefined {
    if (isNil(value)) {
        return undefined
    }
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? undefined : date
}

const POSTGRES_UNIQUE_VIOLATION = '23505'

function isUniqueViolation(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) {
        return false
    }
    const driverError: unknown = error.driverError
    return (
        typeof driverError === 'object' &&
        driverError !== null &&
        'code' in driverError &&
        driverError.code === POSTGRES_UNIQUE_VIOLATION
    )
}

async function toResponse(row: VariableSchema, options?: { includeValue: boolean }): Promise<VariableWithoutSensitiveData> {
    const includeValue = options?.includeValue ?? true
    const base: VariableWithoutSensitiveData = {
        id: row.id,
        created: row.created,
        updated: row.updated,
        name: row.name,
        type: row.type,
        projectId: row.projectId,
        platformId: row.platformId,
        ownerId: row.ownerId,
        owner: mapToUserWithMetaInformation(row.owner ?? null),
        metadata: row.metadata,
    }
    if (includeValue && row.type === VariableType.TEXT) {
        const decrypted = await encryptUtils.decryptObject<VariableValue>(row.value)
        return { ...base, value: decrypted.secret_text }
    }
    return base
}

const MAX_VARIABLE_OWNERS = 200

const VARIABLE_MENTION_PATTERN = 'variables\\[\'([a-zA-Z0-9_]+)\'\\]'

type CreateParams = {
    projectId: string
    platformId: string
    name: string
    type: VariableType | undefined
    value: string
    ownerId: UserId | null
    metadata: Metadata | undefined
}

type UpdateParams = {
    id: ApId
    projectId: string
    platformId: string
    type: VariableType | undefined
    value: string | undefined
    metadata: Metadata | undefined
}

type GetOneParams = {
    id: ApId
    projectId: string
    platformId: string
}

type GetForWorkerParams = {
    projectId: string
    name: string
}

type ListParams = {
    projectId: string
    platformId: string
    cursor: Cursor | undefined
    limit: number | undefined
    name: string | undefined
    types: VariableType[] | undefined
    updatedAfter: string | undefined
    updatedBefore: string | undefined
    usedInFlows: boolean[] | undefined
    includeValues: boolean | undefined
}

type BuildUpdatedConditionParams = {
    updatedAfter: string | undefined
    updatedBefore: string | undefined
}

export type { Variable }
