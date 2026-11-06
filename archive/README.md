# archive/ — v4.x 及更早的历史文件（只读）

v5.0 翻新时（2026-11-07）按维护者决定整体移入此处，**保留 git 历史，不删除**。

- 不参与构建、测试、lint、Docker 镜像，也**不是**任何现行文档的权威来源。
- 现行代码：`server/`（后端）· `frontend/`（前端）。现行文档：根目录 `README*.md`、`docs/`。
- 想看某个旧文件的演进：`git log --follow archive/<path>`。

| 目录 | 内容 |
|---|---|
| `legacy-code/` | 4 个旧 `web_service*.py`、`backends/`、旧 HTML UI、7 个 Dockerfile 变体、旧 compose/systemd/脚本、vendored 的 DeepSeek-OCR v1 上游代码、旧 MCP server |
| `legacy-docs/` | v2–v4 的 SUMMARY / GUIDE / 测试报告 / 手写 API.md、论文 PDF |
| `legacy-assets/` | 旧问题截图 |
| `legacy-ci/` | 旧 GitHub Pages 部署工作流（v5 不再做常驻在线演示） |
