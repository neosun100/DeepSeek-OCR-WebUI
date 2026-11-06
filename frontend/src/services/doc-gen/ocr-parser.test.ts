import { describe, it, expect } from 'vitest'
import { findMatchingBoxIndex, normalizeBox, parseRawText, tokenizeRawText, type ImageDims, type OCRBox } from './ocr-parser'

describe('ocr-parser', () => {
    describe('findMatchingBoxIndex', () => {
        const imageDims: ImageDims = { w: 1000, h: 1000 }
        const boxes: OCRBox[] = [
            { label: 'box1', box: [100, 100, 200, 200] },
            { label: 'box2', box: [300, 300, 400, 400] }
        ]

        it('should find matching box with perfect match', () => {
            // rawCoords are 0-1000 normalized. Image is 1000x1000.
            const rawCoords = [100, 100, 200, 200]
            const index = findMatchingBoxIndex(rawCoords, boxes, imageDims)
            expect(index).toBe(0)
        })

        it('should find matching box within tolerance', () => {
            // Tolerance is 5% (50px).
            // 110 is within 100 + 50
            const rawCoords = [110, 110, 210, 210]
            const index = findMatchingBoxIndex(rawCoords, boxes, imageDims)
            expect(index).toBe(0)
        })

        it('should not match if outside tolerance', () => {
            const rawCoords = [0, 0, 50, 50]
            const index = findMatchingBoxIndex(rawCoords, boxes, imageDims)
            expect(index).toBe(-1)
        })

        it('should skip already used boxes', () => {
            const used = new Set<number>([0])
            const rawCoords = [100, 100, 200, 200]
            const index = findMatchingBoxIndex(rawCoords, boxes, imageDims, used)
            expect(index).toBe(-1)
        })

        it('should return -1 if imageDims is missing', () => {
            const index = findMatchingBoxIndex([100, 100, 200, 200], boxes, undefined)
            expect(index).toBe(-1)
        })
    })

    describe('normalizeBox', () => {
        it('should normalize coordinates when image > 1000px', () => {
            const dims = { w: 2000, h: 2000 }
            const coords = [500, 500, 1000, 1000] // 50%, 50%, 100%, 100%
            const result = normalizeBox(coords, dims)
            expect(result).toEqual([1000, 1000, 2000, 2000])
        })

        it('should not normalize if coords are already large (likely pixels)', () => {
            const dims = { w: 2000, h: 2000 }
            const coords = [1500, 1500, 1600, 1600] // > 1000
            const result = normalizeBox(coords, dims)
            expect(result).toEqual(coords)
        })

        it('should return 0s if dims missing', () => {
            expect(normalizeBox([1, 2, 3, 4], undefined)).toEqual([0, 0, 0, 0])
        })
    })

    describe('parseRawText', () => {
        it('should use accurate box from boxes array if matches', () => {
            const rawText = '<|ref|>text<|/ref|><|det|>[[100, 100, 200, 200]]<|/det|>Content'
            const dims = { w: 1000, h: 1000 }
            // Accurate box is slightly different
            const accurateBox: OCRBox = { label: 'text', box: [105, 105, 205, 205] }

            const result = parseRawText(rawText, dims, [accurateBox])

            expect(result[0]!.box).toEqual([105, 105, 205, 205])
        })

        it('should fallback to normalized coords if no match', () => {
            const rawText = '<|ref|>text<|/ref|><|det|>[[0, 0, 10, 10]]<|/det|>Content'
            const dims = { w: 2000, h: 2000 }
            // 0,0,10,10 normalized (assuming 1000 scale) -> 0, 0, 20, 20

            const result = parseRawText(rawText, dims, [])
            expect(result).toHaveLength(1)
            expect(result[0]!.box).toEqual([0, 0, 20, 20])
        })

        it('should keep multi-box blocks and use the union box (issue #49)', () => {
            const rawText = '<|ref|>text<|/ref|><|det|>[[10,10,50,20], [10,20,60,40]]<|/det|>\nTwo lines'
            const result = parseRawText(rawText, { w: 100, h: 100 }, [])
            expect(result).toHaveLength(1)
            expect(result[0]!.content).toBe('Two lines')
            expect(result[0]!.box).toEqual([10, 10, 60, 40])
        })

        it('should keep content when coordinates are unparseable', () => {
            const result = parseRawText('<|ref|>text<|/ref|><|det|>[[oops]]<|/det|>Kept', { w: 100, h: 100 }, [])
            expect(result).toEqual([{ type: 'text', content: 'Kept', box: [0, 0, 100, 100] }])
        })

        it('should keep ocr-mode labels as content', () => {
            const result = parseRawText('<|ref|>Hello 42<|/ref|><|det|>[[1,2,3,4]]<|/det|>', { w: 100, h: 100 }, [])
            expect(result[0]!.content).toBe('Hello 42')
        })
    })

    describe('tokenizeRawText', () => {
        it('should keep free text around blocks and strip orphan tags', () => {
            const segs = tokenizeRawText('lead <|det|> <|ref|>title<|/ref|> <|det|>[[1,2,3,4]]<|/det|># T\ntail')
            expect(segs.map(s => s.content)).toEqual(['lead', '# T\ntail'])
            expect(segs[1]!.boxes).toEqual([[1, 2, 3, 4]])
        })
    })
})
