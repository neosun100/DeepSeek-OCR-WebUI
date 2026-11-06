#!/usr/bin/env python3
"""优化 UI - 移除冗余信息，添加 API/MCP 说明"""
import re

# 读取文件
with open('ocr_ui_modern.html', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. 更新副标题 - 添加 API & MCP
content = re.sub(
    r"headerSubtitle: '智能图像识别 · 批量处理 · 多模式支持 · 支持 Apple Silicon'",
    "headerSubtitle: '智能 OCR 系统 · API & MCP 支持 · 多模式 · 批量处理 · <a href=\"https://github.com/neosun100/DeepSeek-OCR-WebUI\" target=\"_blank\" style=\"color: inherit; text-decoration: underline;\">查看文档</a>'",
    content
)

content = re.sub(
    r"headerSubtitle: '智能圖像識別 · 批量處理 · 多模式支援 · 支援 Apple Silicon'",
    "headerSubtitle: '智能 OCR 系統 · API & MCP 支援 · 多模式 · 批量處理 · <a href=\"https://github.com/neosun100/DeepSeek-OCR-WebUI\" target=\"_blank\" style=\"color: inherit; text-decoration: underline;\">查看文檔</a>'",
    content
)

content = re.sub(
    r"headerSubtitle: 'Intelligent Image Recognition · Batch Processing · Multi-Mode Support · Apple Silicon Ready'",
    "headerSubtitle: 'Intelligent OCR · API & MCP Support · Multi-Mode · Batch Processing · <a href=\"https://github.com/neosun100/DeepSeek-OCR-WebUI\" target=\"_blank\" style=\"color: inherit; text-decoration: underline;\">View Docs</a>'",
    content
)

content = re.sub(
    r"headerSubtitle: 'インテリジェント画像認識 · バッチ処理 · マルチモードサポート · Apple Silicon 対応'",
    "headerSubtitle: 'インテリジェント OCR · API & MCP サポート · マルチモード · バッチ処理 · <a href=\"https://github.com/neosun100/DeepSeek-OCR-WebUI\" target=\"_blank\" style=\"color: inherit; text-decoration: underline;\">ドキュメント</a>'",
    content
)

# 2. 移除底部的性能指标重复部分（保留在 footer）
# 查找并移除 header 中的性能指标
pattern = r'<div style="display: flex; gap: 20px; flex-wrap: wrap;">.*?首次识别.*?后续识别.*?显存节省.*?</div>\s*</div>\s*<div style="margin-top: 10px;.*?💡 首次使用需加载模型.*?</div>'
content = re.sub(pattern, '', content, flags=re.DOTALL)

# 3. 优化容器宽度 - 改为固定最大宽度而非全屏
content = re.sub(
    r'max-width: 1400px;',
    'max-width: 1200px;',
    content
)

# 4. 添加 padding 避免全屏
content = re.sub(
    r'body \{([^}]*)\}',
    lambda m: m.group(0).replace('padding: 20px;', 'padding: 40px 20px;'),
    content,
    count=1
)

# 保存
with open('ocr_ui_modern.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("✅ UI 优化完成")
print("主要更改:")
print("1. 移除 header 中的性能指标（首次识别、后续识别等）")
print("2. 更新副标题，添加 API & MCP 说明和文档链接")
print("3. 优化容器宽度：1400px -> 1200px")
print("4. 增加页面 padding，避免全屏显示")
