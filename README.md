# lyric-studio · 为专业写词人打造的写歌工作台

本地零依赖的歌词创作工作台，面向**以写词为业、对词作质量有要求的专业写词人**。一句话定位：**离线优先 + 严格创作规则约束 + 多词人风格方法论 + 实时市场灵感 + 作品确权**的一站式写词环境。

不是"AI 帮我写一首歌"的玩具，而是把 AI 当**受控笔替**——所有生成都被你的创作规则框死，风格由你指定的词人方法论主导，你始终握着成稿的命脉。

## 为什么是给专业写词人的

- **规则单一真源，AI 不能脱框**。押韵政策（主歌一韵到底 / AABA、副歌换更响辙且一韵到底）、行字数（≤16、推荐 8–14）、段落结构顺序——全部由 `data/rules.json` 编译成硬约束块（`RULES.md` 为人读版）。AI 只能在框内发挥，不会自由发散成"不像歌词的东西"。
- **24 位词人 craft profile，是方法论不是标签**。方文山 / 林夕 / 黄伟文 / 李宗盛等流行词人，以及热狗 / 蛋堡 / GAI / 宋岳庭等说唱词人，其 craft profile **蒸馏自作品风格**（笔法特质 / 必留意象 / 雷区），AI 续写时按该词人的方法论落笔，而非贴一个"方文山风"的肤浅皮。
- **写词三维度可控**：语种（中 / 英 / 日 / 韩 / 西 / 中英双语）、曲风（流行 / 说唱 / 民谣 / 古风 / 摇滚）、写词人，三者同时注入提示词约束，生成结果贴合你的具体命题。
- **委托要求通道（接单资料）**：把甲方给的 story / 必留意象 / 雷区词 / 情绪基调录入「🎯 要求」，所有生成路径（续写 / 整段重生成 / 写整首 / 对比 3 版 / 单句改写）都自动带上，保证成稿对齐需求。

## 特性

- **零依赖**：纯 Node.js 内置模块（`http`/`fs`/`path`），`node server.js` 即起，无需 `npm install`。
- **多通道 AI**：火山方舟（Ark `ark-code-latest`，推理模型）+ 本地 Ollama 双通道，按可用性与配置自动选择；推理模型 token 预算已专门处理，避免"看似生成实为空内容"。
- **榜单灵感池（采 / 切解耦）**：定时采集实时榜单歌词原文（纯 I/O，便宜）→ 按需切片 + 金句提取 + AI 归纳主题（烧 token，仅检测到新素材才触发）。专业写词人既看自己手里的事，也看市场在唱什么。
- **辅助工具（专业向）**：
  - 词库弹窗：同义族 / 意象库 / 修辞提示，点候选即插。
  - 近韵 / 宽韵提示：十三辙相邻映射，每行韵脚旁给"近韵 X·Y"（仅提示，非强制）。
  - 节奏 / 呼吸标记：平仄作轻重代理标重拍，长句无气口告警。
  - 多版本并排：对同命题生成 3 版，三栏对比选优，历史存本地。
  - 锁定金句续写：标记金句后所有生成路径强制原样保留，不冲掉你的得意之句。
  - 实时内联提示：每行实时显韵脚（辙 + 拼音尾）+ 字数 + 句末词命中同义族可点替换。
  - 情绪 → 韵脚推荐：按情绪映射十三辙，常驻提示。
  - **版权存证**：Web Crypto SHA-256 内容哈希 + 时间戳 + 字数 / 句 / 段统计，纯前端离线确权，可下载、可校验。

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
server.js                零依赖 HTTP 服务 + /api 代理 + 榜单采集/切分/蒸馏
public/                  前端（app.js / index.html / style.css / pinyin.js / data/）
data/rules.json          硬性创作规则（机器真源）
data/lyricists.json      词人列表
data/lyricist-craft.json 词人 craft profile（蒸馏自作品风格，24 位）
data/lyricists-custom.json  自定义词人（可追加你自己的方法论）
data/singers.json        歌手列表
data/lexicon.json        词库（同义族/意象/修辞）
data/ark-config.json     你的密钥（不入库，见 .gitignore）
RULES.md                 创作规则人读版
```

> 想加入你自己的词人方法论？往 `data/lyricists-custom.json` 加条目即可，服务端按中文名自动查库，无需改代码。

## 灵感池数据源说明

实时榜走聚合接口 `api.injahow.cn`（Meting），采集失败时降级到本地静态池 `public/data/hot-themes.json`，面板不会空。

采集与切分是两条独立链路：`collectCharts()` 只做抓取与签名（便宜），`sliceDistill()` 才烧 token。仅当签名变化（有榜上新歌）才触发切分。冷启动不阻塞——首次打开面板时 `/api/charts` 立即返回 `running:true, collecting:true`，后台悄悄采，采完再落池，你不会看到"转圈十几分钟"。

## 行为约定（改测试或二次开发前必读）

以下都是**产品设计时就定下的行为**，UI 上不会说，但写自动化回归或改代码时极易当成 bug：

- **toast 不是完成信号。** AI 生成期间的忙碌指示走 toast，它几秒内就消失。**判定"生成完了"必须看结果容器**（例如蒸馏弹窗里 `#cl-profile` 的 value 非空），不能用 toast 还在不在判断。
- **保存成功后弹窗按设计自动关闭。** 不是 bug。想断言"弹窗里的内容"，必须在点「保存/应用」**之前**断言；点完之后再查必然已关。
- **全量自动收藏开启时，灵感「主题」抽卡池按设计为空。** 打开面板时 `ensureAutoFavs()` 会把当前池子全量收进收藏区；而抽卡候选严格排除一切已收藏项——**全量收藏后 themes 抽不出牌，是数学必然，不是故障**。逃生口是灵感面板上的「自动收藏」总开关（存 `localStorage['lyric-studio:autoFavOn']`）。关掉之后：手动 ★ 收藏的条目永久不参与轮替，但"自动收进来"的条目会**重新回到抽卡池**。
- **重启服务会清空内存态蒸馏池。** `/api/charts` 的 items 是进程内缓存，重启即归零，后台需重跑一轮采集与蒸馏才恢复（实测 6–11 分钟）。期间接口秒回但 items 为空——这是"正在后台采"，不是"接口挂了"。
- **AI 输出是分钟级，不是秒级。** 单句续写通常 20s 内；写整首 60–90s；AI 现场蒸馏 18–30s。客户端超时已按此量级设定，断言不要用秒回预期。

写自动化回归直接复用仓库里的 `verify-spec.json`（31 条 UI 用例）与 `verify_edge.cjs`（6 条服务端边界探针）：

```bash
node verify_edge.cjs                 # 服务端边界：413 / 中文 id / 路径穿越 / 蒸馏池字段齐备
node verify.cjs --spec verify-spec.json --url http://localhost:3100 --ui-only --allow-api
```

`verify.cjs` 来自 [software-verifier](https://github.com/shuigui-ou/software-verifier) 技能，把它的 `verify.cjs` / `engine.cjs` / `drivers/` 放进工作目录即可，无需安装。
