import { z } from 'zod'
import { FieldType } from './field'

const isEmptyCellValue = (value: string): boolean => value.trim().length === 0

const validateCellValue = ({ fieldType, value, options }: ValidateCellValueParams): TableCellValidationErrorCode | null => {
    if (isEmptyCellValue(value)) {
        return null
    }
    switch (fieldType) {
        case FieldType.NUMBER: {
            return Number.isFinite(Number(value.trim())) ? null : 'INVALID_NUMBER'
        }
        case FieldType.DATE:
        case FieldType.DATETIME: {
            return Number.isNaN(Date.parse(value.trim())) ? 'INVALID_DATE' : null
        }
        case FieldType.STATIC_DROPDOWN: {
            return options?.includes(value) ? null : 'INVALID_DROPDOWN_OPTION'
        }
        case FieldType.TEXT: {
            return null
        }
    }
}

export const tableCellValidation = {
    validate: validateCellValue,
}

export const TableCellValidationErrorCode = z.enum(['INVALID_NUMBER', 'INVALID_DATE', 'INVALID_DROPDOWN_OPTION'])
export type TableCellValidationErrorCode = z.infer<typeof TableCellValidationErrorCode>

type ValidateCellValueParams = {
    fieldType: FieldType
    value: string
    options?: string[]
}
