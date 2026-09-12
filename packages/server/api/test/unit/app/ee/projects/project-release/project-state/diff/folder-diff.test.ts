import { FolderOperationType } from '@activepieces/shared'
import { folderDiffService } from '../../../../../../../../src/app/ee/projects/project-release/project-state/diff/folder-diff.service'

describe('Folder Diff Service', () => {
    const folder = (externalId: string, displayName: string, displayOrder: number): { id: string, externalId: string, displayName: string, displayOrder: number } => ({
        id: `id-${externalId}`,
        externalId,
        displayName,
        displayOrder,
    })

    it('should return folders to create, update and delete', () => {
        const operations = folderDiffService.diff({
            newState: {
                flows: [],
                folders: [
                    folder('new-folder', 'New', 1),
                    folder('updated-folder', 'Renamed', 2),
                ],
            },
            currentState: {
                flows: [],
                folders: [
                    folder('updated-folder', 'Old Name', 2),
                    folder('deleted-folder', 'Deleted', 3),
                ],
            },
        })

        expect(operations).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: FolderOperationType.CREATE_FOLDER }),
            expect.objectContaining({ type: FolderOperationType.UPDATE_FOLDER }),
            expect.objectContaining({ type: FolderOperationType.DELETE_FOLDER }),
        ]))
        expect(operations).toHaveLength(3)
    })

    it('should return no operations when folders are identical except id', () => {
        const operations = folderDiffService.diff({
            newState: {
                flows: [],
                folders: [folder('same-external', 'Same', 1)],
            },
            currentState: {
                flows: [],
                folders: [folder('same-external', 'Same', 1)],
            },
        })

        expect(operations).toHaveLength(0)
    })

    it('should handle states without folders', () => {
        const operations = folderDiffService.diff({
            newState: { flows: [] },
            currentState: { flows: [] },
        })

        expect(operations).toHaveLength(0)
    })
})
