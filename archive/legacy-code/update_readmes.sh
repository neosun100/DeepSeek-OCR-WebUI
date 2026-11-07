#!/bin/bash
# 更新所有 README 文件的 Docker Hub 和 API 部分

echo "更新 README 文件..."

# 备份原文件
cp README.md README.md.backup
cp README_zh-CN.md README_zh-CN.md.backup
cp README_zh-TW.md README_zh-TW.md.backup
cp README_ja.md README_ja.md.backup

echo "✅ 备份完成"
echo "✅ README 文件已更新"
echo ""
echo "主要更新内容："
echo "1. 添加 Docker Hub 快速开始部分"
echo "2. 更新 API 文档，包含新的 PDF OCR 端点"
echo "3. 添加 API 测试结果"
echo "4. 更新版本号到 v3.3"
