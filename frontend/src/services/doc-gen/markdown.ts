import type { OCRResult, OCRBox } from '@/services/ocr'
import { normalizeBox } from '@/services/ocr/parser'
import { tokenizeRawText, unionBox, type RawSegment } from './ocr-parser'

interface Block {
    type: string
    content: string
    box: number[] // [x1, y1, x2, y2]
    imageId?: string
    isImage: boolean
    /** No reliable coordinates: rendered standalone in reading order, never merged into layout rows */
    anchored?: boolean
}


interface Column {
    blocks: Block[]
    left: number
    right: number
    centerX: number
}

interface VisualRow {
    columns: Column[]
    top: number
    bottom: number
}

export class MarkdownAssembler {
    private figureCount = 1

    /**
     * Assemble OCR result and extracted images into a Markdown string.
     * Reconstructs layout using HTML tables for side-by-side elements.
     * 
     * @param ocrResult The original OCR result containing text and boxes
     * @param imageMap A map of box index to extracted image ID
     * @returns The generated Markdown string
     */
    assemble(ocrResult: OCRResult, imageMap: Map<string, string>): string {
        if (!ocrResult.raw_text) {
            throw new Error('OCR result missing raw_text')
        }

        this.figureCount = 1

        // 1. Parse into blocks (tokenization + initial cleaning)
        const blocks = this.parseBlocks(ocrResult, imageMap)

        if (blocks.length === 0) {
            // Fallback for empty or non-matching raw_text (though unlikely)
            return ocrResult.raw_text
        }

        // 2. Layout Analysis: Analyze layout using column-based algorithm
        const visualRows = this.analyzeLayout(blocks)

        // 3. Render visual rows
        // We need image width to calculate table percentages. 
        // Default to a reasonable width if missing (e.g. 1000)
        const pageW = ocrResult.image_dims?.w || 1000

        let markdown = this.renderVisualRows(visualRows, pageW)

        // 4. Handle remaining/unmatched images (Legacy fallback support)
        // Check which images were used
        const usedImageIds = new Set<string>()
        blocks.forEach(b => { if (b.imageId) usedImageIds.add(b.imageId) })

        const allIndices = Array.from(imageMap.keys()).sort((a, b) => parseInt(a) - parseInt(b))
        const remainingImages: string[] = []

        for (const indexStr of allIndices) {
            const id = imageMap.get(indexStr)
            if (id && !usedImageIds.has(id)) {
                const caption = `Figure ${this.figureCount++}`
                remainingImages.push(`![${caption}](scan2doc-img:${id})`)
            }
        }

        if (remainingImages.length > 0) {
            markdown += '\n\n## Figures\n'
            markdown += remainingImages.join('\n')
        }

        return markdown.trim()
    }

    /**
     * Tokenize raw_text into layout blocks. Never drops text (issue #49):
     * - multi-box `<|det|>[[..],[..]]` blocks use the union box
     * - blocks with unparseable coordinates and free text keep their content and are
     *   "anchored" right after the previous block in reading order (no reliable position)
     */
    private parseBlocks(ocrResult: OCRResult, imageMap: Map<string, string>): Block[] {
        const blocks: Block[] = []
        const pageW = ocrResult.image_dims?.w || 1000
        let prevBottom = 0

        for (const seg of tokenizeRawText(ocrResult.raw_text)) {
            if (seg.boxes.length === 0) {
                if (!seg.content) continue
                const y = prevBottom
                blocks.push({
                    type: seg.type,
                    content: this.cleanContent(seg.content),
                    box: [0, y, pageW, y],
                    isImage: false,
                    anchored: true
                })
                continue
            }

            const block = this.processSegment(seg, ocrResult, imageMap)
            blocks.push(block)
            prevBottom = Math.max(prevBottom, block.box[3] || 0)
        }

        return blocks
    }

    private processSegment(seg: RawSegment, ocrResult: OCRResult, imageMap: Map<string, string>): Block {
        const type = seg.type

        // Map each box of the block to the boxes array; the first box backed by a
        // sliced image turns the block into an image block
        let imageId: string | undefined
        const absBoxes: number[][] = []
        for (const coords of seg.boxes) {
            const matchedIndex = this.findMatchingBoxIndex(coords, ocrResult.boxes, ocrResult.image_dims)
            if (!imageId && matchedIndex !== -1) imageId = imageMap.get(matchedIndex.toString())
            // Prefer accurate pixel coordinates from the boxes array; else normalize raw coords
            const matched = matchedIndex !== -1 ? ocrResult.boxes[matchedIndex] : undefined
            absBoxes.push(matched ? [...matched.box] : normalizeBox(coords, ocrResult.image_dims!))
        }

        let isImage = (type === 'image' || type === 'figure')
        let content = this.cleanContent(seg.content)

        if (imageId) {
            isImage = true
            const link = `![Figure ${this.figureCount++}](scan2doc-img:${imageId})`
            // Keep any recognized text inside an image block instead of replacing it
            content = content ? `${link}<br/>${content}` : link
        }

        return { type, content, box: unionBox(absBoxes), imageId, isImage }
    }

    private cleanContent(text: string): string {

        // Normalize LaTeX delimiters
        // \( -> $
        // \) -> $
        // \[ -> $$
        // \] -> $$
        const cleaned = text
            .replace(/\\\(/g, '$')
            .replace(/\\\)/g, '$')
            .replace(/\\\[/g, '$$$$')
            .replace(/\\\]/g, '$$$$')

        return cleaned
    }

    /**
     * Bind image blocks with their adjacent captions.
     * Merges content of caption into image block and marks caption as consumed.
     */
    private bindImageCaptions(blocks: Block[]): Block[] {
        const result: Block[] = []
        const consumedIndices = new Set<number>()

        // Sort by Y position for proper adjacency detection
        const sorted = [...blocks].sort((a, b) => (a.box[1] || 0) - (b.box[1] || 0))

        for (let i = 0; i < sorted.length; i++) {
            if (consumedIndices.has(i)) continue

            const block = sorted[i]!

            // Check if this is an image block
            if (block.isImage || block.type === 'image' || block.type === 'figure') {
                const captionIndex = this.findAdjacentCaptionIndex(block, sorted, i + 1, consumedIndices)
                if (captionIndex !== -1) {
                    const candidate = sorted[captionIndex]!
                    block.content = block.content + '<br/>' + candidate.content
                    block.box[3] = Math.max(block.box[3] || 0, candidate.box[3] || 0)
                    consumedIndices.add(captionIndex)
                }
            }

            result.push(block)
        }

        return result
    }
    private findAdjacentCaptionIndex(imageBlock: Block, sortedBlocks: Block[], startIndex: number, consumedIndices: Set<number>): number {
        for (let j = startIndex; j < sortedBlocks.length; j++) {
            if (consumedIndices.has(j)) continue
            if (this.isAdjacentCaption(imageBlock, sortedBlocks[j]!)) {
                return j
            }
        }
        return -1
    }

    private isAdjacentCaption(imageBlock: Block, candidate: Block): boolean {
        // Check if it's a caption type or text that looks like a caption
        const isCaption = ['image_caption', 'caption', 'figure_caption'].includes(candidate.type)
        if (!isCaption) return false

        return this.isVerticallyAdjacent(imageBlock, candidate) &&
            this.isHorizontallyAligned(imageBlock, candidate)
    }

    private isVerticallyAdjacent(imageBlock: Block, candidate: Block): boolean {
        const imageBottom = imageBlock.box[3] || 0
        const candidateTop = candidate.box[1] || 0
        const verticalGap = candidateTop - imageBottom
        return verticalGap >= -10 && verticalGap <= 100
    }

    private isHorizontallyAligned(imageBlock: Block, candidate: Block): boolean {
        const imageLeft = imageBlock.box[0] || 0
        const imageRight = imageBlock.box[2] || 0
        const candidateLeft = candidate.box[0] || 0
        const candidateRight = candidate.box[2] || 0
        const candidateCenterX = (candidateLeft + candidateRight) / 2
        return candidateCenterX >= imageLeft - 50 && candidateCenterX <= imageRight + 50
    }

    /**
     * Check if a block is a heading/title type (should not be in layout tables)
     */
    private isHeadingType(block: Block): boolean {
        const type = block.type.toLowerCase()
        return type === 'sub_title' || type === 'title'
    }

    /**
     * Blocks rendered as their own row: headings, and anchored blocks without coordinates.
     */
    private isStandalone(block: Block): boolean {
        return this.isHeadingType(block) || block.anchored === true
    }

    /**
     * Analyze layout and identify visual rows from columns.
     * A visual row contains blocks from different columns that have Y-axis overlap.
     * 
     * Strategy: For each potential visual row, find all blocks that overlap in Y,
     * then cluster those blocks into columns based on X-axis separation.
     * 
     * Note: Heading blocks are always rendered as single-column rows and do not
     * participate in multi-column layout detection.
     */
    private analyzeLayout(blocks: Block[]): VisualRow[] {
        // First bind images with their captions
        const boundBlocks = this.bindImageCaptions(blocks)

        // Filter out empty blocks
        const validBlocks = boundBlocks.filter(b => b.content || b.isImage)

        if (validBlocks.length === 0) return []

        // Sort all blocks by top Y
        const sortedByY = [...validBlocks].sort((a, b) => (a.box[1] || 0) - (b.box[1] || 0))

        const visualRows: VisualRow[] = []
        const assignedBlocks = new Set<Block>()

        for (const seedBlock of sortedByY) {
            if (assignedBlocks.has(seedBlock)) continue

            // Headings are always rendered as single-column rows
            // They do not participate in multi-column layout
            if (this.isStandalone(seedBlock)) {
                assignedBlocks.add(seedBlock)
                visualRows.push(this.createHeadingVisualRow(seedBlock))
                continue
            }

            // Create a multi-column visual row starting with this block
            const rowBlocks = this.collectOverlappingBlocks(seedBlock, sortedByY, assignedBlocks)
            const rowTop = Math.min(...rowBlocks.map(b => b.box[1] || 0))
            const rowBottom = Math.max(...rowBlocks.map(b => b.box[3] || 0))

            // Now we have all blocks in this visual row
            // Cluster them into columns based on X-axis separation
            const rowColumns = this.clusterBlocksIntoColumns(rowBlocks)

            if (rowColumns.length > 0) {
                visualRows.push({
                    columns: rowColumns,
                    top: rowTop,
                    bottom: rowBottom
                })
            }
        }

        // Sort visual rows by top Y
        visualRows.sort((a, b) => a.top - b.top)

        return visualRows
    }

    private createHeadingVisualRow(block: Block): VisualRow {
        return {
            columns: [{
                blocks: [block],
                left: block.box[0] || 0,
                right: block.box[2] || 0,
                centerX: ((block.box[0] || 0) + (block.box[2] || 0)) / 2
            }],
            top: block.box[1] || 0,
            bottom: block.box[3] || 0
        }
    }

    private collectOverlappingBlocks(seedBlock: Block, allBlocks: Block[], assignedBlocks: Set<Block>): Block[] {
        let rowTop = seedBlock.box[1] || 0
        let rowBottom = seedBlock.box[3] || 0
        const rowBlocks: Block[] = [seedBlock]
        assignedBlocks.add(seedBlock)

        // A row must not swallow blocks that start below the next heading/anchored block,
        // otherwise their content is rendered above that heading (cross-heading merge)
        const seedTop = seedBlock.box[1] || 0
        const boundary = allBlocks.reduce((min, b) => {
            const top = b.box[1] || 0
            return this.isStandalone(b) && top > seedTop ? Math.min(min, top) : min
        }, Infinity)

        while (true) {
            const overlapping = allBlocks.find(block => {
                if (assignedBlocks.has(block) || this.isStandalone(block)) return false
                const blockTop = block.box[1] || 0
                const blockBottom = block.box[3] || 0
                return blockTop < boundary && blockTop < rowBottom && blockBottom > rowTop
            })

            if (!overlapping) break

            rowBlocks.push(overlapping)
            assignedBlocks.add(overlapping)
            rowTop = Math.min(rowTop, overlapping.box[1] || 0)
            rowBottom = Math.max(rowBottom, overlapping.box[3] || 0)
        }
        return rowBlocks
    }

    /**
     * Cluster a set of blocks (already known to be in the same Y range) into columns.
     * Blocks that don't overlap in X are placed in different columns.
     */
    private clusterBlocksIntoColumns(blocks: Block[]): Column[] {
        if (blocks.length === 0) return []

        // Sort by X center
        const sorted = [...blocks].sort((a, b) => {
            const aCenterX = ((a.box[0] || 0) + (a.box[2] || 0)) / 2
            const bCenterX = ((b.box[0] || 0) + (b.box[2] || 0)) / 2
            return aCenterX - bCenterX
        })

        const columns: Column[] = []

        for (const block of sorted) {
            const blockLeft = block.box[0] || 0
            const blockRight = block.box[2] || 0
            const blockCenterX = (blockLeft + blockRight) / 2
            const blockWidth = blockRight - blockLeft

            // Try to find an existing column this block belongs to
            let bestColumn: Column | null = null
            let bestOverlap = 0

            for (const column of columns) {
                // Calculate horizontal overlap
                const overlapLeft = Math.max(column.left, blockLeft)
                const overlapRight = Math.min(column.right, blockRight)
                const overlap = Math.max(0, overlapRight - overlapLeft)

                // Check if significant overlap exists (> 30% of smaller width)
                const colWidth = column.right - column.left
                const minWidth = Math.min(colWidth, blockWidth)

                if (overlap > minWidth * 0.3 && overlap > bestOverlap) {
                    bestColumn = column
                    bestOverlap = overlap
                }
            }

            if (bestColumn) {
                // Add to existing column
                bestColumn.blocks.push(block)
                bestColumn.left = Math.min(bestColumn.left, blockLeft)
                bestColumn.right = Math.max(bestColumn.right, blockRight)
                bestColumn.centerX = (bestColumn.left + bestColumn.right) / 2
            } else {
                // Create new column
                columns.push({
                    blocks: [block],
                    left: blockLeft,
                    right: blockRight,
                    centerX: blockCenterX
                })
            }
        }

        // Sort blocks within each column by Y position
        for (const column of columns) {
            column.blocks.sort((a, b) => (a.box[1] || 0) - (b.box[1] || 0))
        }

        // Sort columns by X position
        columns.sort((a, b) => a.left - b.left)

        return columns
    }

    /**
     * Render visual rows into HTML/Markdown output.
     */
    private renderVisualRows(visualRows: VisualRow[], pageW: number): string {
        let output = ''

        for (const row of visualRows) {
            if (row.columns.length === 0) continue

            if (row.columns.length === 1 && row.columns[0]!.blocks.length === 1) {
                // Single block row - render as paragraph
                const block = row.columns[0]!.blocks[0]!
                output += block.content + '\n\n'
            } else {
                // Multi-column or multi-block row - render as table
                const cells = row.columns.map(column => {
                    // Calculate column width
                    const w = Math.max(1, column.right - column.left)
                    const pct = Math.round((w / pageW) * 100)

                    // Merge all blocks in this column with <br/><br/>
                    let content = column.blocks.map(b => b.content).join('<br/><br/>')

                    // Convert Markdown images to HTML for table cells
                    content = content.replace(
                        /!\[([^\]]*)\]\(scan2doc-img:([^)]+)\)/g,
                        '<img src="scan2doc-img:$2" alt="$1" />'
                    )

                    return { content, width: pct }
                })

                // Normalize widths to sum to 100%
                const totalPct = cells.reduce((sum, c) => sum + c.width, 0)
                if (totalPct > 0) {
                    cells.forEach(c => c.width = Math.round(c.width / totalPct * 100))
                }

                // Use 'layout-table' class to distinguish from OCR data tables, and inline styles for safety
                output += '<table class="layout-table" border="0" cellspacing="0" cellpadding="0" style="border-collapse: collapse; border: none;"><tr>'
                cells.forEach(c => {
                    output += `<td width="${c.width}%" style="border: none; vertical-align: top;">${c.content}</td>`
                })
                output += '</tr></table>\n\n'
            }
        }

        return output
    }


    // eslint-disable-next-line complexity
    private findMatchingBoxIndex(
        targetCoords: number[],
        boxes: OCRBox[],
        imageDims: { w: number, h: number }
    ): number {
        // Reuse logic but we need to supply 'imageDims' to normalize inputs for comparison if needed
        // My 'normalizeBox' is consistent with this.
        // To be safe, we check both raw and normalized match (IoU or Delta)

        if (boxes.length === 0) return -1

        // We try both as-is and 1000-scaled versions of targetCoords just in case
        // Logic from previous implementation:
        const candidates = [
            targetCoords,
            [
                (targetCoords[0]! / 1000) * imageDims.w,
                (targetCoords[1]! / 1000) * imageDims.h,
                (targetCoords[2]! / 1000) * imageDims.w,
                (targetCoords[3]! / 1000) * imageDims.h,
            ]
        ]

        const DELTA = 20 // increased tolerance slightly

        for (const coords of candidates) {
            for (let i = 0; i < boxes.length; i++) {
                const box = boxes[i]!.box
                if (
                    Math.abs(box[0] - (coords[0] || 0)) <= DELTA &&
                    Math.abs(box[1] - (coords[1] || 0)) <= DELTA &&
                    Math.abs(box[2] - (coords[2] || 0)) <= DELTA &&
                    Math.abs(box[3] - (coords[3] || 0)) <= DELTA
                ) {
                    return i
                }
            }
        }

        return -1
    }
}

export const markdownAssembler = new MarkdownAssembler()
