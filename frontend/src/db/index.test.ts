import 'dexie'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { db, type DBPage, type DBFile } from './index'
import { createPinia, setActivePinia } from 'pinia'

// Mock isWebkit to true globally for this test file
vi.mock('@/utils/browser', () => ({
    isWebkit: () => true
}))

// Helper to clean object for Dexie (remove id if it's an auto-increment key)
function cleanForAdd<T extends { id?: string | number }>(obj: T): T {
    const newObj: Record<string, unknown> = { ...obj }
    delete newObj.id
    return newObj as T
}

const createTestPage = (id: string, order: number = 0): DBPage => ({
    id,
    fileName: 'test.pdf',
    fileSize: 100,
    fileType: 'application/pdf',
    origin: 'upload',
    status: 'ready',
    progress: 100,
    order,
    outputs: [],
    logs: [],
    createdAt: new Date(),
    updatedAt: new Date()
})

// Mock storage estimate
const mockEstimate = vi.fn()
if (typeof window !== 'undefined') {
    if (!window.navigator.storage) {
        Object.defineProperty(window.navigator, 'storage', {
            value: { estimate: mockEstimate },
            writable: true,
            configurable: true
        })
    } else {
        vi.spyOn(window.navigator.storage, 'estimate').mockImplementation(mockEstimate)
    }
}

describe('Scan2DocDB', () => {
    // Global setup for all DB tests
    beforeEach(() => {
        setActivePinia(createPinia())

        // Mock isWebkit to true to force ArrayBuffer storage path for consistent testing
        // Note: vi.mock is hoisted, but we can also use spyOn if we wanted dynamic behavior.
        // Since we import isWebkit, we rely on the hoisted mock which we will duplicate/move here if needed, 
        // or just assume the mock below works. 
        // Actually, let's look at the structure. 
    })

    // Polyfill Blob.prototype.arrayBuffer if missing (common in some jsdom ver)
    if (!Blob.prototype.arrayBuffer) {
        Blob.prototype.arrayBuffer = function () {
            return new Promise((resolve, reject) => {
                const reader = new FileReader()
                reader.onload = () => resolve(reader.result as ArrayBuffer)
                reader.onerror = () => reject(reader.error)
                reader.readAsArrayBuffer(this)
            })
        }
    }

    beforeEach(async () => {
        // Thoroughly clear ALL tables before each test
        await db.pages.clear()
        await db.files.clear()
        await db.pageImages.clear()
        await db.counters.clear()

        // Clear new tables
        await db.pageOCRs.clear()
        await db.pageMarkdowns.clear()
        await db.pagePDFs.clear()
        await db.pageDOCXs.clear()
        await db.pageExtractedImages.clear()

        mockEstimate.mockReset()
        vi.clearAllMocks()
    })

    // Skip: These tests have issues with fake-indexeddb's strict add() validation
    // They work in real browser environments but fail in vitest/jsdom
    describe('File Methods', () => {
        it('should save and get a file', async () => {
            const file = {
                name: 'test.pdf',
                content: new Blob(['test']),
                size: 4,
                type: 'application/pdf',
                createdAt: new Date()
            } as DBFile

            const id = await db.saveFile(cleanForAdd(file))
            expect(id).toBeDefined()

            const retrieved = await db.getFile(id)
            expect(retrieved?.name).toBe('test.pdf')
        })

        it('should update an existing file if it has an id', async () => {
            const file = {
                name: 'test.pdf',
                content: new Blob(['test']),
                size: 4,
                type: 'application/pdf',
                createdAt: new Date()
            } as DBFile

            const id = await db.saveFile(cleanForAdd(file))
            const retrievedBefore = await db.getFile(id)

            const updatedFile = { ...retrievedBefore!, name: 'updated.pdf' }
            await db.saveFile(updatedFile)

            const retrievedAfter = await db.getFile(id)
            expect(retrievedAfter?.name).toBe('updated.pdf')
        })
    })

    describe('Page Image Methods', () => {
        it('should save and get a page image', async () => {
            const pageId = 'page1'
            const blob = new Blob(['image data'], { type: 'image/jpeg' })

            await db.savePageImage(pageId, blob)
            const retrieved = await db.getPageImage(pageId)
            expect(retrieved).toBeDefined()
        })

        it('should return undefined for non-existent page image', async () => {
            const retrieved = await db.getPageImage('nonexistent')
            expect(retrieved).toBeUndefined()
        })
    })

    describe('Page Methods', () => {
        it('should save and get a page', async () => {
            const page = createTestPage('page1')
            await db.savePage(page)

            const retrieved = await db.getPage('page1')
            expect(retrieved?.fileName).toBe('test.pdf')
        })

        it('should add a page without id', async () => {
            const page = {
                fileName: 'test.pdf',
                fileSize: 100,
                fileType: 'application/pdf',
                origin: 'upload',
                status: 'ready',
                progress: 100,
                order: 0,
                outputs: [],
                logs: [],
                createdAt: new Date(),
                updatedAt: new Date()
            } as DBPage

            const id = await db.savePage(cleanForAdd(page))
            expect(id).toBeDefined()
            expect(await db.getPage(id)).toBeDefined()
        })

        it('should get all pages ordered by order', async () => {
            await db.savePage(createTestPage('p2', 2))
            await db.savePage(createTestPage('p1', 1))

            const pages = await db.getAllPages()
            expect(pages.length).toBe(2)
            expect(pages[0]!.id).toBe('p1')
            expect(pages[1]!.id).toBe('p2')
        })

        it('should get pages by status', async () => {
            const pa = createTestPage('pa')
            pa.status = 'ready'
            const pb = createTestPage('pb')
            pb.status = 'error'

            await db.savePage(pa)
            await db.savePage(pb)

            const readyPages = await db.getPagesByStatus('ready')
            expect(readyPages.length).toBe(1)
            expect(readyPages[0]!.id).toBe('pa')
        })

        it('should delete a page and its associated data', async () => {
            const pageId = 'p1'
            await db.savePage(createTestPage(pageId))
            await db.savePageImage(pageId, new Blob(['test']))

            await db.deletePage(pageId)

            expect(await db.getPage(pageId)).toBeUndefined()
            expect(await db.getPageImage(pageId)).toBeUndefined()
        })

        it('should save added page with defaults', async () => {
            const pageData = {
                fileName: 'test.pdf',
                fileSize: 100,
                fileType: 'application/pdf',
                origin: 'upload',
                status: 'ready',
                progress: 100,
                order: 0,
                outputs: [],
                logs: []
            }

            const id = await db.saveAddedPage(pageData as Omit<DBPage, 'id' | 'createdAt' | 'updatedAt' | 'order'>)
            const retrieved = await db.getPage(id)
            expect(retrieved?.createdAt).toBeDefined()
        })

        it('should get next order', async () => {
            // Check implicit order assignment (consumes 0)
            const id1 = await db.savePage(createTestPage('p1', -1))
            const p1 = await db.getPage(id1)
            expect(p1?.order).toBe(0)

            // Check explicit fetch (consumes 1)
            expect(await db.getNextOrder()).toBe(1)

            // Check next implicit assignment (consumes 2)
            const id2 = await db.savePage(createTestPage('p2', -1))
            const p2 = await db.getPage(id2)
            expect(p2?.order).toBe(2)
        })

        it('should correctly save batch with atomic orders', async () => {
            await db.savePagesBatch([
                createTestPage('b1', -1),
                createTestPage('b2', -1)
            ] as DBPage[])

            const pages = await db.getAllPages()
            expect(pages.length).toBe(2)
            expect(pages[0]!.order).toBe(0)
            expect(pages[1]!.order).toBe(1)
        })
    })


    describe('Utility Methods', () => {
        it('should clear all data', async () => {
            await db.savePage(createTestPage('p1'))
            await db.clearAllData()
            expect(await db.pages.count()).toBe(0)
        })

        it('should get storage size', async () => {
            mockEstimate.mockResolvedValue({ usage: 1024 })
            const size = await db.getStorageSize()
            expect(size).toBe(1024)
        })
    })



    describe('New Schema Tables (Phase 1)', () => {



        afterEach(async () => {
            await db.pageOCRs.clear()
            await db.pageMarkdowns.clear()
            await db.pagePDFs.clear()
            await db.pageDOCXs.clear()
            await db.pageExtractedImages.clear()
            vi.clearAllMocks()
        })

        it('should support CRUD on pageOCRs', async () => {
            const pageId = 'page_ocr_test'
            const data: import('./index').PageOCR = {
                pageId,
                data: {
                    success: true,
                    text: 'test text',
                    raw_text: 'raw text',
                    boxes: [],
                    image_dims: { w: 100, h: 100 },
                    prompt_type: 'text'
                },
                createdAt: new Date()
            }

            await db.savePageOCR(data)
            const stored = await db.getPageOCR(pageId)
            expect(stored).toBeDefined()
            expect(stored?.data.text).toBe('test text')
            // confidence check removed as per user request
        })

        it('summarizes v5 warnings and tolerates legacy records without them', async () => {
            const base = { success: true, text: 't', raw_text: 'r', boxes: [], image_dims: { w: 1, h: 1 }, prompt_type: 'document' }
            await db.savePageOCR({
                pageId: 'v5-page',
                data: { ...base, ok: false, finish_reason: 'length', warnings: [{ code: 'truncated', message: 'cut' }] },
                createdAt: new Date()
            })
            await db.savePageOCR({ pageId: 'v4-page', data: base, createdAt: new Date() })

            expect(await db.getPageOCRSummary('v5-page')).toEqual({
                warnings: [{ code: 'truncated', message: 'cut' }], finishReason: 'length', ok: false
            })
            expect(await db.getPageOCRSummary('v4-page')).toEqual({ warnings: [], finishReason: null, ok: null })
            expect(await db.getPageOCRSummary('missing')).toBeUndefined()
        })

        it('should support CRUD on pageMarkdowns', async () => {
            const pageId = 'page_md_test'
            const data: import('./index').PageMarkdown = {
                pageId,
                content: '# Heading'
            }

            await db.savePageMarkdown(data)
            const stored = await db.getPageMarkdown(pageId)
            expect(stored).toBeDefined()
            expect(stored?.content).toBe('# Heading')
        })



        it('should support CRUD on pagePDFs', async () => {
            const pageId = 'page_pdf_test'
            const blob = new Blob(['pdf content'], { type: 'application/pdf' })

            await db.savePagePDF(pageId, blob)
            const storedBlob = await db.getPagePDF(pageId)
            expect(storedBlob).toBeDefined()

            // Should be returned as Blob due to repo logic
            expect(storedBlob instanceof Blob).toBe(true)
            expect(storedBlob?.size).toBe(blob.size)
            expect(storedBlob?.type).toBe(blob.type)
        })

        it('should support CRUD on pageDOCXs', async () => {
            const pageId = 'page_docx_test'
            const blob = new Blob(['docx content'], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })

            await db.savePageDOCX(pageId, blob)
            const storedBlob = await db.getPageDOCX(pageId)
            expect(storedBlob).toBeDefined()
            expect(storedBlob instanceof Blob).toBe(true)
            expect(storedBlob?.size).toBe(blob.size)
            expect(storedBlob?.type).toBe(blob.type)
        })

        it('should support CRUD on pageExtractedImages', async () => {
            const id = 'img_1'
            const pageId = 'page_img_test'
            const data: import('./index').PageExtractedImage = {
                id,
                pageId,
                blob: new Blob(['image content'], { type: 'image/png' }),
                box: [0, 0, 100, 100]
            }

            await db.savePageExtractedImage(data)
            const stored = await db.getPageExtractedImage(id)
            expect(stored).toBeDefined()
            expect(stored?.box).toEqual([0, 0, 100, 100])
            expect(stored?.blob).toBeDefined()

            // The repo method returns PageExtractedImage where blob is normalized to Blob
            const storedBlob = stored?.blob
            expect(storedBlob instanceof Blob).toBe(true)
            if (storedBlob instanceof Blob) {
                expect(storedBlob.size).toBe((data.blob as Blob).size)
                expect(storedBlob.type).toBe('image/png')
            }
        })
    })

    describe('Phase 2: Cascading Deletion and Batch Operations', () => {
        it('deletePage should remove related records in all tables', async () => {
            const pageId = 'page_cascade_test'

            // 1. Create records in all tables
            await db.savePage(createTestPage(pageId))
            await db.savePageImage(pageId, new Blob(['img']))
            await db.savePageOCR({
                pageId,
                data: { success: true, text: 't', raw_text: 't', boxes: [], image_dims: { w: 1, h: 1 }, prompt_type: 'text' },
                createdAt: new Date()
            })
            await db.savePageMarkdown({ pageId, content: 'md' })
            await db.savePagePDF(pageId, new Blob(['pdf']))
            await db.savePageDOCX(pageId, new Blob(['docx']))
            await db.savePageExtractedImage({ id: 'ex_img_1', pageId, blob: new Blob(['ex']), box: [0, 0, 0, 0] })

            // 2. Perform deletion
            await db.deletePage(pageId)

            // 3. Verify everything is gone
            expect(await db.getPage(pageId)).toBeUndefined()
            expect(await db.getPageImage(pageId)).toBeUndefined()
            expect(await db.getPageOCR(pageId)).toBeUndefined()
            expect(await db.getPageMarkdown(pageId)).toBeUndefined()
            expect(await db.getPagePDF(pageId)).toBeUndefined()
            expect(await db.getPageDOCX(pageId)).toBeUndefined()
            expect(await db.pageExtractedImages.where('pageId').equals(pageId).count()).toBe(0)
        })

        it('deletePagesBatch should remove multiple pages and their related records', async () => {
            const p1 = 'p_batch_1'
            const p2 = 'p_batch_2'
            const ids = [p1, p2]

            // 1. Create records for both pages
            for (const id of ids) {
                await db.savePage(createTestPage(id))
                await db.savePageImage(id, new Blob(['img']))
                await db.savePageOCR({
                    pageId: id,
                    data: { success: true, text: 't', raw_text: 't', boxes: [], image_dims: { w: 1, h: 1 }, prompt_type: 'text' },
                    createdAt: new Date()
                })
            }

            // 2. Perform batch deletion
            await db.deletePagesBatch(ids)

            // 3. Verify
            for (const id of ids) {
                expect(await db.getPage(id)).toBeUndefined()
                expect(await db.getPageImage(id)).toBeUndefined()
                expect(await db.getPageOCR(id)).toBeUndefined()
            }
        })
    })

})

describe('Full Coverage Scenarios', () => {
    it('should delete all pages and associated data', async () => {
        const pageId = 'p_del_all'
        await db.savePage(createTestPage(pageId))
        await db.savePageImage(pageId, new Blob(['test']))

        await db.deleteAllPages()

        expect(await db.pages.count()).toBe(0)
        expect(await db.pageImages.count()).toBe(0)
    })

    it('should update pages order', async () => {
        const p1Id = await db.savePage(createTestPage('p1', 0))
        const p2Id = await db.savePage(createTestPage('p2', 1))

        await db.updatePagesOrder([{ id: p1Id, order: 5 }, { id: p2Id, order: 0 }])

        const p1 = await db.getPage(p1Id)
        const p2 = await db.getPage(p2Id)

        expect(p1?.order).toBe(5)
        expect(p2?.order).toBe(0)
    })

    it('should update page partials', async () => {
        const p1Id = await db.savePage(createTestPage('p1'))
        await db.updatePage(p1Id, { status: 'ocr_success' })

        const p1 = await db.getPage(p1Id)
        expect(p1?.status).toBe('ocr_success')
    })

    it('should fallback storage size if navigator.storage undefined', async () => {
        // Mock navigator.storage undefined
        const originalStorage = navigator.storage
        // @ts-expect-error - readonly prop
        delete navigator.storage

        const size = await db.getStorageSize()
        expect(size).toBe(0)

        // Restore
        Object.defineProperty(navigator, 'storage', { value: originalStorage })
    })

    it('should handle savePagesBatch with no IDs', async () => {
        const pages = [
            {
                fileName: 'no_id.pdf',
                fileSize: 10,
                fileType: 'pdf',
                origin: 'upload',
                status: 'ready',
                outputs: [],
                logs: [],
                progress: 0,
                createdAt: new Date(),
                updatedAt: new Date()
            },
        ] as Omit<DBPage, 'id' | 'order'>[]

        const ids = await db.savePagesBatch(pages)
        expect(ids.length).toBe(1)
        expect(ids[0]).toBeDefined()
        expect(ids[0]).toMatch(/^page_/)
    })

    it('should get all pages for display', async () => {
        // Just alias
        const pages = await db.getAllPagesForDisplay()
        expect(pages).toBeInstanceOf(Array)
    })
})
