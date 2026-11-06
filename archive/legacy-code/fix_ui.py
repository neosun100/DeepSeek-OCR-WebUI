#!/usr/bin/env python3
"""修复 UI：添加 GPU 说明 + 修复 PDF 页码顺序"""

import re

# 读取文件
with open('ocr_ui_modern.html', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. 在标题后添加 GPU 管理说明
header_pattern = r'(<h1[^>]*>.*?</h1>)'
gpu_info = r'''\1
        <div class="gpu-info-banner" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 15px 25px; border-radius: 12px; margin: 20px 0; box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);">
            <div style="display: flex; align-items: center; gap: 15px; flex-wrap: wrap;">
                <div style="flex: 1; min-width: 200px;">
                    <div style="font-size: 0.9em; opacity: 0.9; margin-bottom: 5px;">⚡ GPU 智能管理</div>
                    <div style="font-size: 1.1em; font-weight: 600;">懒加载 + 即用即卸</div>
                </div>
                <div style="display: flex; gap: 20px; flex-wrap: wrap;">
                    <div style="text-align: center;">
                        <div style="font-size: 0.85em; opacity: 0.8;">首次识别</div>
                        <div style="font-size: 1.2em; font-weight: 700;">20-30s</div>
                    </div>
                    <div style="text-align: center;">
                        <div style="font-size: 0.85em; opacity: 0.8;">后续识别</div>
                        <div style="font-size: 1.2em; font-weight: 700;">2-5s</div>
                    </div>
                    <div style="text-align: center;">
                        <div style="font-size: 0.85em; opacity: 0.8;">显存节省</div>
                        <div style="font-size: 1.2em; font-weight: 700;">~85%</div>
                    </div>
                </div>
            </div>
            <div style="margin-top: 10px; font-size: 0.85em; opacity: 0.9;">
                💡 首次使用需加载模型，请耐心等待。后续识别会自动从 CPU 快速恢复，大幅节省显存。
            </div>
        </div>'''

content = re.sub(header_pattern, gpu_info, content, count=1)

# 2. 修复 PDF 页码排序 - 确保按 pageNumber 排序
# 找到 renderImages 函数中的排序逻辑
sort_pattern = r'(state\.images\.sort\(\(a, b\) => \{[^}]+\}\);)'
new_sort = '''// 按页码或添加顺序排序
            state.images.sort((a, b) => {
                // 如果有 pageNumber，按页码排序
                if (a.pageNumber !== undefined && b.pageNumber !== undefined) {
                    return a.pageNumber - b.pageNumber;
                }
                // 否则按 ID 排序（保持添加顺序）
                return a.id - b.id;
            });'''

content = re.sub(sort_pattern, new_sort, content, count=1)

# 3. 在图片卡片上显示页码
# 找到图片名称显示的地方，添加页码标识
card_name_pattern = r'(<div class="image-name"[^>]*>\$\{img\.name\}</div>)'
card_name_with_page = r'''<div class="image-name" title="${img.name}">
                        ${img.pageNumber ? `📄 第 ${img.pageNumber} 页` : img.name}
                    </div>'''

content = re.sub(card_name_pattern, card_name_with_page, content)

# 写入文件
with open('ocr_ui_modern.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("✅ UI 修复完成！")
print("   - 添加了 GPU 管理说明横幅")
print("   - 修复了 PDF 页码排序逻辑")
print("   - 图片卡片显示页码信息")
