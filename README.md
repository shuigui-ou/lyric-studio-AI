# lyric-studio

本地零依赖写歌词工作台。一句话定位：**离线优先的歌词创作 + AI 续写/整首生成 + 实时榜单灵感池**。

## 特性

- **零依赖**：纯 Node.js 内置模块（`http`/`fs`/`path`），`node server.js` 即起，无需 `npm install`。
- **多通道 AI**：火山方舟（Ark `ark-code-latest`，推理模型）+ 本地 Ollama 双通道，按可用性与配置自动选择。
- **榜单灵感池（采/切解耦）**：定时采集实时榜单歌词原文（纯 I/O，便宜）→ 按需切片 + 金句提取 + AI 归纳主题（烧 token，仅检测到新素材才触发）。
- **写词三维度**：语种 / 曲风 / 写词人，注入到 AI 提示词约束。
- **规则单一真源**：`data/rules.json` 编译成提示词约束块（`RULES.md` 为人读版）。
- **词人风格蒸馏**：24 位词人 craft profile 优先，prose 兜底。
- **辅助工具**：词库弹窗、近韵/宽韵提示、节奏/呼吸标记、多版本并排、锁定金句续写、实时内联提示、情绪→韵脚推荐、版权存证（Web Crypto SHA-256，纯前端离线）。

## 运行

```bash
cd lyric-studio
node server.js
# 浏览器打开 http://localhost:3100
```

默认端口 3100。可在 `server.js` 顶部 `PORT` 常量修改。

## 配置 AI（二选一）

1. **配置文件**：复制 `data/ark-config.example.json` 为 `data/ark-config.json`，填入你的火山方舟 `arkApiKey`。
2. **环境变量**：`ARK_API_KEY=ark-xxxx node server.js`（优先级高于配置文件）。

本地 Ollama 无需密钥，只要本机 `11434` 端口有模型即可自动启用 fallback。

API Key 仅保存在本机服务（`data/ark-config.json`），**不上传、不出现在浏览器里**。

## 目录结构

```
server.js              零依赖 HTTP 服务 + /api 代理 + 榜单采集/切分/蒸馏
public/                前端（app.js / index.html / style.css / pinyin.js / data/）
data/rules.json        硬性创作规则（机器真源）
data/lyricists.json    词人列表
data/lyricist-craft.json  词人 craft profile（蒸馏自作品风格）
data/singers.json      歌手列表
data/lexicon.json      词库（同义族/意象/修辞）
data/ark-config.json   你的密钥（不入库，见 .gitignore）
RULES.md               创作规则人读版
```

## 灵感池数据源说明

实时榜走聚合接口 `api.injahow.cn`（Meting），采集失败时降级到本地静态池 `public/data/hot-themes.json`，面板不会空。
