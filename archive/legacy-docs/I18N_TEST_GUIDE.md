# 🌐 多语言功能测试指南

## 🧪 测试步骤

### 基础测试

**步骤 1: 访问界面**
```
打开: http://10.68.2.212:8001
默认语言: 🇨🇳 简体中文
```

**步骤 2: 切换到繁體中文**
```
1. 点击右上角语言选择器
2. 选择 "🇹🇼 繁體中文"
3. 观察界面变化

验证:
✓ Header 副标题: "智能圖像識別 · 批量處理 · 多模式支援"
✓ 模式名称: "文檔轉Markdown", "通用OCR" 等
✓ GitHub 横幅: "喜歡這個項目？給我們一個 Star！"
✓ 按钮文本: "開始識別", "繼續添加" 等
```

**步骤 3: 切换到 English**
```
1. 选择 "🇺🇸 English"
2. 观察界面变化

验证:
✓ Header: "Intelligent Image Recognition · Batch Processing"
✓ Modes: "Doc to Markdown", "General OCR" 等
✓ GitHub: "Like this project? Give us a Star!"
✓ Buttons: "Start Recognition", "Add More" 等
```

**步骤 4: 切换到日本語**
```
1. 选择 "🇯🇵 日本語"
2. 观察界面变化

验证:
✓ Header: "インテリジェント画像認識 · バッチ処理"
✓ Modes: "ドキュメントをMarkdownへ", "汎用OCR" 等
✓ GitHub: "このプロジェクトが気に入りましたか？"
✓ Buttons: "認識開始", "さらに追加" 等
```

**步骤 5: 持久化测试**
```
1. 选择任意语言（如 English）
2. 刷新页面（F5）
3. 验证语言是否保持

验证:
✓ 语言选择器显示当前语言
✓ 界面文本保持切换后的语言
✓ LocalStorage 中保存了设置
```

---

## 📋 详细检查清单

### Header 区域

- [ ] 页面标题: "🔍 DeepSeek OCR"
- [ ] 副标题翻译正确
- [ ] GitHub 链接文字翻译
- [ ] 语言选择器显示当前语言

### 模式选择器

- [ ] 模式选择标题翻译
- [ ] 7个模式名称都翻译：
  - [ ] 文档转Markdown
  - [ ] 通用OCR
  - [ ] 纯文本提取
  - [ ] 图表解析
  - [ ] 图像描述
  - [ ] 查找定位
  - [ ] 自定义提示

### Find 模式（选择后）

左侧面板:
- [ ] 面板标题翻译
- [ ] 上传区域文字翻译
- [ ] 上传提示翻译
- [ ] 输入框标签翻译
- [ ] 输入框占位符翻译
- [ ] 输入提示翻译
- [ ] 三个按钮文字翻译

右侧面板:
- [ ] 结果标题翻译
- [ ] 空状态文字翻译
- [ ] 匹配项标题翻译

### 批量模式

- [ ] Freeform 标签翻译
- [ ] Freeform 占位符翻译
- [ ] Freeform 提示翻译
- [ ] "已上传图片"标题翻译
- [ ] 拖动提示翻译
- [ ] 所有按钮翻译（5个）
- [ ] 进度标题翻译
- [ ] 结果标题翻译
- [ ] 日志标题翻译

### Footer 区域

- [ ] Star 横幅标题翻译
- [ ] Star 横幅描述翻译
- [ ] Star 按钮文字翻译
- [ ] 4个快捷链接翻译
- [ ] "Made with ❤️ by" 翻译
- [ ] "Powered by" 翻译

---

## 🔍 调试方法

### 打开浏览器控制台 (F12)

查看控制台输出:
```javascript
🌐 切换语言到: en-US
✅ 语言切换完成
```

### 检查 LocalStorage

在控制台运行:
```javascript
// 查看当前语言设置
localStorage.getItem('ocr_language')

// 手动设置语言
localStorage.setItem('ocr_language', 'ja-JP')
location.reload()
```

### 测试翻译函数

在控制台运行:
```javascript
// 测试翻译
t('headerSubtitle')
t('modes.document')
t('findMode.title')
t('github.bannerTitle')

// 切换语言
currentLang = 'en-US'
updateUILanguage()
```

---

## ⚠️ 常见问题

### Q1: 切换语言后部分文字没变化

**可能原因**:
- 元素没有被 updateUILanguage 函数覆盖
- 选择器写错
- 翻译字典缺少对应key

**解决方法**:
1. 打开浏览器控制台查看是否有错误
2. 检查 translations 对象是否包含该 key
3. 检查选择器是否正确

### Q2: 刷新后语言恢复默认

**可能原因**:
- LocalStorage 未正确保存
- 浏览器隐私模式
- LocalStorage 被清除

**解决方法**:
1. 检查浏览器是否允许 LocalStorage
2. 退出隐私模式
3. 清除浏览器缓存后重试

### Q3: 某些语言显示乱码

**可能原因**:
- 字符编码问题
- 字体不支持该语言

**解决方法**:
1. 确认 HTML 使用 UTF-8 编码
2. 使用支持多语言的字体

---

## 📊 翻译覆盖率

### 当前状态

| 区域 | 简中 | 繁中 | 英语 | 日语 |
|------|------|------|------|------|
| Header | ✅ | ✅ | ✅ | ✅ |
| 模式选择 | ✅ | ✅ | ✅ | ✅ |
| Find 模式 | ✅ | ✅ | ✅ | ✅ |
| 批量模式 | ✅ | ✅ | ✅ | ✅ |
| GitHub 链接 | ✅ | ✅ | ✅ | ✅ |
| Footer | ✅ | ✅ | ✅ | ✅ |
| 按钮 | ✅ | ✅ | ✅ | ✅ |
| 提示文本 | ✅ | ✅ | ✅ | ✅ |

**总体完成度: 100%** ✅

---

## 🎯 测试用例

### 用例 1: 完整语言切换流程

```
初始状态: 简体中文

操作:
1. 切换到繁體中文
   → 验证: 所有"识别"变成"識別"
   → 验证: "已上传"变成"已上傳"

2. 切换到 English
   → 验证: "开始识别"变成"Start Recognition"
   → 验证: "操作日志"变成"Operation Log"

3. 切换到日本語
   → 验证: "开始识别"变成"認識開始"
   → 验证: "操作日志"变成"操作ログ"

4. 刷新页面
   → 验证: 保持日本語

5. 切换回简体中文
   → 验证: 所有文字恢复中文
```

### 用例 2: Find 模式多语言

```
操作:
1. 选择 English
2. 进入 Find 模式

验证:
✓ Left panel title: "Find & Locate"
✓ Upload text: "Click or drag to upload image"
✓ Input label: "Enter search term"
✓ Button: "Start Search"
✓ Right panel title: "Recognition Result"
✓ Empty state: "Waiting"
```

### 用例 3: GitHub 链接多语言

```
操作:
1. 切换到日本語

验证:
✓ Header link: "⭐ Star on GitHub"
✓ Footer banner: "このプロジェクトが気に入りましたか？"
✓ Footer button: "GitHubでStarをつける"
✓ Link 1: "ホーム"
✓ Link 2: "問題報告"
✓ Link 3: "ドキュメント"
✓ Link 4: "更新履歴"
```

---

## ✅ 验证成功标准

### 视觉检查

每种语言下：
- ✅ 没有显示翻译key（如 "modes.document"）
- ✅ 没有显示 undefined
- ✅ 所有文字都是目标语言
- ✅ 排版没有错乱
- ✅ 文字没有溢出容器

### 功能检查

每种语言下：
- ✅ 所有按钮可点击
- ✅ 输入框占位符正确
- ✅ 提示文字显示正确
- ✅ 链接都能打开
- ✅ 模式切换正常

### 持久化检查

- ✅ 选择语言后刷新页面，语言保持
- ✅ LocalStorage 中有 `ocr_language` 键
- ✅ 关闭浏览器再打开，语言保持

---

## 🔧 开发者调试

### 查看翻译字典

在控制台运行:
```javascript
// 查看所有语言
console.table(Object.keys(translations))

// 查看某个语言的所有翻译
console.log(translations['zh-CN'])
console.log(translations['en-US'])

// 查看某个具体翻译
console.log(t('modes.document'))
console.log(t('findMode.btnProcess'))
```

### 手动触发更新

在控制台运行:
```javascript
// 切换到英语
currentLang = 'en-US'
updateUILanguage()

// 切换到日语
currentLang = 'ja-JP'
updateUILanguage()
```

### 检查元素更新

在控制台运行:
```javascript
// 查看某个元素的当前文本
document.querySelector('.mode-title').textContent

// 查看所有模式名称
document.querySelectorAll('.mode-name').forEach((el, i) => {
    console.log(i, el.textContent)
})
```

---

## 📝 已知问题和限制

### 当前版本 (v3.1)

1. **动态生成的内容**
   - 日志消息部分是动态生成的
   - 暂时不支持翻译
   - 计划在 v3.2 中完善

2. **Toast 提示**
   - 部分 toast 消息是硬编码的
   - 需要逐步迁移到使用 t() 函数

3. **错误消息**
   - API 返回的错误消息是英文
   - 暂不翻译（保持技术准确性）

---

## 🚀 现在可以测试了！

**访问地址**: http://10.68.2.212:8001

**快速测试**:
```
1. 打开页面 → 默认简体中文 ✓
2. 切换到 English → 界面立即变化 ✓
3. 点击 Find 模式 → 所有文字都是英文 ✓
4. 切换到日本語 → 所有文字变日文 ✓
5. 刷新页面 → 保持日文 ✓
```

**预期效果**: 所有界面元素都应该正确翻译！

---

<div align="center">

**🎊 多语言功能已完整实现！🎊**

支持 4 种语言 · 完整 UI 翻译 · 设置持久化

[返回主页](./README.md) | [更新日志](./CHANGELOG.md) | [问题反馈](https://github.com/neosun100/DeepSeek-OCR-WebUI/issues)

</div>
