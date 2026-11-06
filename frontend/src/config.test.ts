import { describe, it, expect } from 'vitest'
import { config, resolveApiBaseUrl } from './config'

describe('resolveApiBaseUrl', () => {
    it('defaults to same origin when VITE_API_BASE_URL is unset', () => {
        expect(resolveApiBaseUrl({})).toBe('')
    })

    it('treats an empty VITE_API_BASE_URL as unset', () => {
        expect(resolveApiBaseUrl({ VITE_API_BASE_URL: '' })).toBe('')
    })

    it('uses VITE_API_BASE_URL when provided', () => {
        expect(resolveApiBaseUrl({ VITE_API_BASE_URL: 'https://ocr.example.internal' })).toBe('https://ocr.example.internal')
    })
})

describe('config', () => {
    it('never points at a hosted third-party API by default', () => {
        // Vitest runs in DEV mode: this is exactly the `npm run dev` code path.
        expect(import.meta.env.DEV).toBe(true)
        expect(config.apiBaseUrl).toBe(import.meta.env.VITE_API_BASE_URL || '')
        expect(config.apiBaseUrl).not.toContain('cloudmantools')
    })
})
