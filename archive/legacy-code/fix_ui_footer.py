#!/usr/bin/env python3
"""将 GPU 说明移到页面底部"""

import re

# 读取文件
with open('ocr_ui_modern.html', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. 删除原来的 GPU 横幅（在标题后面的）
gpu_banner_pattern = r'<div class="gpu-info-banner"[^>]*>.*?</div>\s*</div>'
content = re.sub(gpu_banner_pattern, '', content, flags=re.DOTALL)

# 2. 在页面底部（</body> 前）添加 GPU 说明
footer_gpu_info = '''
    <!-- GPU 管理说明 - 页面底部 -->
    <div style="max-width: 1400px; margin: 30px auto 20px; padding: 0 20px;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px 30px; border-radius: 16px; box-shadow: 0 8px 30px rgba(102, 126, 234, 0.3);">
            <div style="display: flex; align-items: center; gap: 20px; flex-wrap: wrap; margin-bottom: 15px;">
                <div style="flex: 1; min-width: 250px;">
                    <div style="font-size: 1em; opacity: 0.9; margin-bottom: 5px;">⚡ GPU 智能管理</div>
                    <div style="font-size: 1.3em; font-weight: 700;">懒加载 + 即用即卸</div>
                </div>
                <div style="display: flex; gap: 25px; flex-wrap: wrap;">
                    <div style="text-align: center; padding: 10px 20px; background: rgba(255,255,255,0.15); border-radius: 10px;">
                        <div style="font-size: 0.9em; opacity: 0.85; margin-bottom: 3px;">首次识别</div>
                        <div style="font-size: 1.4em; font-weight: 700;">20-30s</div>
                    </div>
                    <div style="text-align: center; padding: 10px 20px; background: rgba(255,255,255,0.15); border-radius: 10px;">
                        <div style="font-size: 0.9em; opacity: 0.85; margin-bottom: 3px;">后续识别</div>
                        <div style="font-size: 1.4em; font-weight: 700;">2-5s</div>
                    </div>
                    <div style="text-align: center; padding: 10px 20px; background: rgba(255,255,255,0.15); border-radius: 10px;">
                        <div style="font-size: 0.9em; opacity: 0.85; margin-bottom: 3px;">显存节省</div>
                        <div style="font-size: 1.4em; font-weight: 700;">~85%</div>
                    </div>
                </div>
            </div>
            <div style="padding: 12px 20px; background: rgba(255,255,255,0.1); border-radius: 10px; font-size: 0.95em; line-height: 1.6;">
                <div style="margin-bottom: 8px;">💡 <strong>工作原理：</strong></div>
                <div style="opacity: 0.95;">
                    • 首次使用时从磁盘加载模型到 GPU（约 20-30 秒）<br>
                    • 识别完成后自动卸载到 CPU，释放显存（约 2 秒）<br>
                    • 后续识别从 CPU 快速恢复到 GPU（约 2-5 秒），大幅节省显存
                </div>
            </div>
        </div>
    </div>

</body>'''

content = content.replace('</body>', footer_gpu_info)

# 写入文件
with open('ocr_ui_modern.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("✅ GPU 说明已移到页面底部！")
