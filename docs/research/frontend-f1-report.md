# Frontend F1 Report: Infrastructure & Security

Branch: `worktree-agent-a9d1f1ab5a35030ce`, base `625b01c`. Environment: macOS, Node v26.0.0.
All commands run from `frontend/`.

## Commits

| Commit | Scope |
|---|---|
| `9999f94` fix(test) | Node 26 vitest localStorage |
| `e13ff48` fix(deps) | npm audit critical/high -> 0 |
| `8a369ba` fix(security) | DOMPurify sanitization for the Markdown preview |
| `4f8f787` fix(config) | Dev API default changed to same origin + Vite proxy + `.env.example` |
| `b2e3073` test(e2e) | Root-cause fix for the mode-selector flaky test |

Each commit message includes the six red-team questions.

## 1. Node 26 unit tests

- Change: `vitest.config.ts` adds `execArgv: ['--no-webstorage']`. It is gated on `process.allowedNodeEnvironmentFlags.has('--webstorage')`: Node 20/22 do not recognise this flag, and Node's own Web Storage is off by default on those versions anyway.
- Why execArgv instead of rebinding jsdom storage in setup.ts: the flag removes Node's native getter before any module is evaluated, so no dependency can grab the broken object ahead of setup.
- Verification: `npx vitest run`
  - Before: 9 files failed, **123 failed / 493 passed (616)**. The failing files crashed, so the total test count was low.
  - After: 45 files, **672/672 passed**.
- engines `^20.19.0 || ^22.13.0 || >=24` is unchanged and still holds, because of the version gate.
- Mutation check: setting execArgv to `[]` reproduces the 123 failures (same as the baseline run).

## 2. npm audit --omit=dev

| | critical | high | moderate | total |
|---|---|---|---|---|
| Before | 2 | 10 | 12 | 24 |
| After | **0** | **0** | 2 | 2 |

- `npm audit fix` (non-breaking): markdown-it, linkify-it, vue, postcss, nanoid, lodash(-es), ws, source-map-js. vitest moved to 4.1.12 (within `^4`).
- `vue-i18n ^10.0.7 -> ^11.4.18` (major): audit fix moved 10.0.7 to 10.0.8, and 10.0.8 is exactly the version affected by GHSA-83rm-6c8r-g728 (high). The 10.x line has no fixed version.
- `overrides: { "get-dom": { "jsdom": "^27.3.0" } }`: removes the chain jsdom@9 -> request (critical SSRF) -> form-data 2.x (critical) / qs / tough-cookie / uuid. Why this is safe: `omml2mathml` is a declared dependency of docx-math-converter, but its dist never imports it. get-dom ships a separate `browser.js` for bundling. Its Node entry point (`jsdom.jsdom()`) is unreachable.
- Regression checks: vitest 672/672, `vue-tsc -b` exit 0, `npm run build` exit 0.
- The 2 remaining moderate findings: katex (via @iktakahiro/markdown-it-katex). The fix requires katex 0.19 (major) and was not done in this round.
- Full audit (including dev): 13 (0 critical, 2 high, 11 moderate). The dev-dependency highs are outside this task's acceptance criteria.

## 3. XSS (Preview v-html)

- New `src/utils/sanitize-html.ts` (it holds the single definition of the policy and has its own tests, so it is outside the F1 file list). DOMPurify 3.4.17 with its default allowlist, plus:
  - `blob:` (Preview turns `scan2doc-img:<id>` into object URLs) and `scan2doc-img:` (an unresolved placeholder the browser cannot load). `javascript:`, `vbscript:` and `data:text/html` links are still rejected.
  - `ADD_TAGS: ['semantics','annotation']` + `encoding`. DOMPurify drops these by default, which leaks the raw TeX from KaTeX's MathML as stray text. `annotation-xml` stays banned (it is the mXSS vector), and a test pins this.
- `Preview.vue`: both render paths (stored markdown, ocrText fallback) go through `renderMarkdownSafe()`.
- `docx.ts`: assessed and left unchanged. html_block is regex-parsed into docx Table/TextRun objects and never enters the DOM.
- Tests: Preview.test.ts +11 (5 payloads `<img onerror>` / `<script>` / `javascript:` link / `<svg onload>` / inline img, the fallback path, table colspan/rowspan, KaTeX html + MathML + annotation, data: images). sanitize-html.test.ts +12.
- **Mutation check**: removing `sanitizeRenderedHtml(...)` from `renderMarkdownSafe` -> `npx vitest run src/components/preview` gives **6 failed / 32 passed (38)**. All 5 payloads and the fallback path fail. Restoring it brings all tests back to green.

## 4. Dev-mode API address

- `src/config.ts`: the default is now `''` (same origin) in every mode. `VITE_API_BASE_URL` still overrides it. `resolveApiBaseUrl()` was extracted so it can be tested.
- `vite.config.ts`: `server.proxy['^/(api|ocr|health)(/|$)']` -> `process.env.VITE_DEV_PROXY_TARGET || .env* || http://127.0.0.1:8001` (8001 is the default port of web_service_unified.py). The regex key avoids accidentally matching paths like `/ocr-utils.ts`.
- New `frontend/.env.example` (not matched by .gitignore).
- Verification: stub server on 127.0.0.1:18001 + `vite --port 5199`. `/health`, `/ocr` and `/api/x` reached the stub; `/healthz`, `/ocr-utils.ts` and `/` were served by Vite.
- Tests: new `src/config.test.ts` (4 cases). There were no existing config tests: providers/health tests all mock config. Mutation check: restoring the third-party default -> 3 failed / 4.

## 5. Flaky E2E

- **Root cause**: the test continued straight after `waitForOCRSuccess`, while document generation was still running. The selector is disabled during generation, but page status is **non-monotonic**: `doc:gen:start 'all'` falls back to `'completed'`, and docx success maps to `'completed'` while PDF is not done yet. A click in one of these short "completed" windows is swallowed when Vue re-renders the button as disabled, so the menu never opens and `waitForSelector('.n-dropdown-menu')` times out (PageViewerPage.ts:142). A run started inside such a window also gets its status overwritten by the previous pipeline: in debugging, `recognizing` never appeared after the click. Under full-suite load generation is slow, which makes the window easier to hit. Secondary issue: the OCR mock was registered after the first selectOCRMode, but selecting a mode starts OCR immediately, so that request went to the real network.
- Fix (test only):
  - OCRPage: `getGenerationDoneCount` / `waitForGenerationDone`, which wait on the store's per-run "Generated all successfully" log.
  - selectOCRMode: replaced `waitForTimeout(500/300)` with `toBeEnabled` + `toBeHidden`.
  - Spec: register the mock first; each step waits for `recognizing` and then for that run's generation to finish.
- Evidence (this test, `--repeat-each=16 --workers=16`):
  - Old code: **4 failed / 12 passed**, all `page.waitForSelector: Timeout 10000ms` at PageViewerPage.ts:142.
  - New code: **16/16 passed**.
- Full chromium suite, 3 consecutive runs: **116 passed, 2 skipped, 0 failed** (58.3s / 59.6s / 59.8s).
- E2E isolation: during the runs I used an untracked temporary config (port 5273, `reuseExistingServer:false`) so I would not reuse dev servers from other worktrees on port 5173. It has been deleted. The commands are equivalent to `npx playwright test --project=chromium --reporter=line`.

## 6. Final acceptance (Node 26)

| Command | Result |
|---|---|
| `npx vitest run` | 47 files, **695/695 passed** |
| `npx vue-tsc -b` | exit 0 |
| `npx eslint .` | exit 0 (0 errors, 1 warning: an unused disable directive at `tests/e2e/fixtures/base-test.ts:117`, which already existed) |
| `npm run build` | exit 0, built in 6.76s |
| `npm audit --omit=dev` | 2 moderate, 0 high, 0 critical |
| playwright chromium full suite x3 | 116 passed / 2 skipped / 0 failed, all 3 runs |

## Unresolved / follow-ups

1. **Store status is non-monotonic (product bug)**: in `src/stores/pages.ts`, `doc:gen:start` type `'all'` falls back to `'completed'`, and docx success also maps to `'completed'`. Users can click OCR during these windows, and a new run's status gets overwritten by the old pipeline. The right fix is in the store (outside F1 scope). Once it is fixed, the E2E test could wait on status instead of the log text.
2. **Some E2E tests send unmocked `/ocr` requests**: each full run logs 6-7 proxy `ECONNREFUSED 127.0.0.1:8001`. Before this change those requests went to `ocr.cloudmantools.top`, a real third-party server. They now go to localhost and fail, and the console filter tolerates it. The specific specs that don't mock `/ocr` are not cleaned up yet.
3. `frontend/dist/` is tracked by git, so `npm run build` dirties the working tree. I restored it after each build and did not commit build output. Consider stopping tracking it.
4. katex moderate: needs `katex@0.19` / `markdown-it-katex` major upgrades.
5. Developer-workflow change: anyone who relied on the hosted service during development must now set `VITE_API_BASE_URL` or `VITE_DEV_PROXY_TARGET`.
6. vue-i18n 11 deprecates the Legacy API. The project uses `legacy:false` and the tests show no deprecation warnings. Worth a manual check alongside the i18n agent's changes.
