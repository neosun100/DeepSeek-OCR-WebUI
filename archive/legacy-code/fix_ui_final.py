#!/usr/bin/env python3
"""优化底部 GPU 说明样式，使其更协调"""

import re

# 读取文件
with open('ocr_ui_modern.html', 'r', encoding='utf-8') as f:
    content = f.read()

# 删除旧的底部 GPU 说明
old_footer_pattern = r'<!-- GPU 管理说明 - 页面底部 -->.*?</body>'
content = re.sub(old_footer_pattern, '</body>', content, flags=re.DOTALL)

# 添加优化后的底部说明
new_footer = '''
    <!-- GPU 管理说明 - 页面底部 -->
    <div style="max-width: 1400px; margin: 40px auto 30px; padding: 0 20px;">
        <div style="background: white; padding: 30px 40px; border-radius: 20px; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.08); border: 1px solid rgba(102, 126, 234, 0.1);">
            <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 25px; padding-bottom: 20px; border-bottom: 2px solid #f0f0f0;">
                <div style="width: 50px; height: 50px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 24px;">⚡</div>
                <div>
                    <div style="font-size: 1.4em; font-weight: 700; color: #1f2937; margin-bottom: 3px;">GPU 智能管理</div>
                    <div style="font-size: 0.95em; color: #6b7280;">懒加载 + 即用即卸 · 节省显存 85%</div>
                </div>
            </div>
            
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 25px;">
                <div style="text-align: center; padding: 20px; background: linear-gradient(135deg, #f0f4ff 0%, #e0e7ff 100%); border-radius: 12px; border: 1px solid #c7d2fe;">
                    <div style="font-size: 0.9em; color: #6366f1; font-weight: 600; margin-bottom: 8px;">首次识别</div>
                    <div style="font-size: 2em; font-weight: 700; color: #4f46e5;">20-30s</div>
                    <div style="font-size: 0.85em; color: #6b7280; margin-top: 5px;">从磁盘加载模型</div>
                </div>
                <div style="text-align: center; padding: 20px; background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border-radius: 12px; border: 1px solid #bbf7d0;">
                    <div style="font-size: 0.9em; color: #10b981; font-weight: 600; margin-bottom: 8px;">后续识别</div>
                    <div style="font-size: 2em; font-weight: 700; color: #059669;">2-5s</div>
                    <div style="font-size: 0.85em; color: #6b7280; margin-top: 5px;">从 CPU 快速恢复</div>
                </div>
                <div style="text-align: center; padding: 20px; background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border-radius: 12px; border: 1px solid #fcd34d;">
                    <div style="font-size: 0.9em; color: #f59e0b; font-weight: 600; margin-bottom: 8px;">显存节省</div>
                    <div style="font-size: 2em; font-weight: 700; color: #d97706;">~85%</div>
                    <div style="font-size: 0.85em; color: #6b7280; margin-top: 5px;">空闲时释放显存</div>
                </div>
            </div>
            
            <div style="background: #f9fafb; padding: 20px 25px; border-radius: 12px; border-left: 4px solid #6366f1;">
                <div style="font-size: 1em; font-weight: 600; color: #1f2937; margin-bottom: 12px;">💡 工作原理</div>
                <div style="color: #4b5563; line-height: 1.8; font-size: 0.95em;">
                    <div style="margin-bottom: 8px;">• <strong>首次使用：</strong>从磁盘加载模型到 GPU（约 20-30 秒）</div>
                    <div style="margin-bottom: 8px;">• <strong>识别完成：</strong>自动卸载到 CPU，释放显存（约 2 秒）</div>
                    <div>• <strong>后续识别：</strong>从 CPU 快速恢复到 GPU（约 2-5 秒），大幅节省显存</div>
                </div>
            </div>
        </div>
    </div>

</body>'''

content = content.replace('</body>', new_footer)

# 写入文件
with open('ocr_ui_modern.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("✅ GPU 说明样式已优化！")
print("   - 使用白色卡片背景，与页面主体一致")
print("   - 优化了字体大小和颜色")
print("   - 添加了渐变色卡片和图标")
print("   - 改进了排版和间距")
