import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

// Backend started by web_service_unified.py listens on 8001 by default.
const DEFAULT_DEV_PROXY_TARGET = 'http://127.0.0.1:8001'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // loadEnv with '' prefix so VITE_DEV_PROXY_TARGET can live in .env.local,
  // not only in the shell environment. Shell env wins over .env files.
  const env = loadEnv(mode, process.cwd(), '')
  const proxyTarget = process.env.VITE_DEV_PROXY_TARGET || env.VITE_DEV_PROXY_TARGET || DEFAULT_DEV_PROXY_TARGET

  return {
    base: './',
    plugins: [vue()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src')
      }
    },
    server: {
      // The app calls same-origin /ocr and /health in dev (src/config.ts);
      // forward them to the local backend instead of a hosted service.
      // Regex keys (leading ^) so only exact path segments match, e.g.
      // /ocr and /ocr/... but not a source module like /ocr-utils.ts.
      proxy: {
        '^/(api|ocr|health)(/|$)': {
          target: proxyTarget,
          changeOrigin: true
        }
      }
    },
    optimizeDeps: {
      include: ['pdfjs-dist']
    },
    define: {
      global: 'globalThis'
    },
    worker: {
      format: 'es' as const
    }
  }
})
