import { defineConfig, configDefaults } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

// Node >= 25 enables the native Web Storage API by default: `localStorage` /
// `sessionStorage` become getters on globalThis that return undefined unless
// `--localstorage-file` is set. Vitest's jsdom environment does not overwrite
// those existing globals, so tests see Node's broken storage instead of
// jsdom's (Node 26: 123 failures, "Cannot read properties of undefined
// (reading 'getItem')"). Disabling Node's implementation in the test workers
// lets jsdom's storage through, matching Node 20/22 behaviour.
// Why execArgv and not re-binding jsdom storage in setup.ts: the flag removes
// the native getters before any module evaluates, so no test file or
// dependency can capture the broken object first. Gated on
// allowedNodeEnvironmentFlags because Node 20/22 reject `--no-webstorage`
// (there the API is off by default and nothing needs disabling).
const nodeWebStorageArgv = process.allowedNodeEnvironmentFlags.has('--webstorage')
    ? ['--no-webstorage']
    : []

export default defineConfig({
    plugins: [vue()],
    test: {
        globals: true,
        environment: 'jsdom',
        exclude: [...configDefaults.exclude, 'tests/e2e/**'],
        setupFiles: ['./tests/setup.ts'],
        alias: {
            '@': resolve(__dirname, './src')
        },
        execArgv: nodeWebStorageArgv,
        retry: 1,
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            thresholds: {
                perFile: true,
                lines: 90,
                functions: 80,
                branches: 70,
                statements: 80
            }
        }
    },
    resolve: {
        alias: {
            '@': resolve(__dirname, './src')
        }
    }
})
