// lyric-studio —— 零依赖本地写词服务
// Node 内置 http 模块，无需 npm install。
// 功能：静态托管 + 歌词存档接口 + AI 续写（代理本机 Ollama）
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3100;
const PUBLIC = path.join(__dirname, 'public');
const DATA = path.join(__dirname, 'data');
const OLLAMA_BASE = process.env.OLLAMA_BASE || 'http://127.0.0.1:11434';
const ARK_BASE_DEFAULT = 'https://ark.cn-beijing.volces.com/api/coding/v3'; // 火山方舟 Coding Plan 专用端点
const ARK_CONFIG_FILE = path.join(DATA, 'ark-config.json');
const ARK_MODEL_DEFAULT = process.env.ARK_MODEL || 'ark-code-latest'; // Coding Plan Auto 调度模型
// 系统提示随「语种」切换：中文用华语创作助手，其他语种用对应语言的专业作詞家系统提示。
// 注意：ark-code-latest 是推理模型，系统提示语言只作引导，真正的创作语言由 buildPrompt 的【创作语种】指令决定。
function arkSysFor(language) {
  const L = (language || 'zh');
  if (L === 'en') return 'You are a professional song lyricist. Output only the lyrics themselves (one line per sentence, may span multiple lines). No explanation, no quotes, no "Here are the lyrics". You must strictly follow the 【硬性创作规则】 in the user message regarding rhyme scheme, line length and structure order; stay within those rules, do not freestyle outside them.';
  if (L === 'ja') return 'あなたはプロの作詞家です。歌詞本文のみを出力してください（1行に1文、複数行可）。解説・引用符・「歌詞です」のような前置きは不要。ユーザー文の【硬性创作规则】の韻律・行数・構成を厳守し、枠外の自由発想は禁止。';
  if (L === 'ko') return '당신은 전문 작사가입니다. 가사 본문만 출력하세요(1행 1문장, 여러 행 가능). 설명·따옴표·"가사입니다" 같은 머리말 금지. 사용자 메시지의 【硬性创作规则】 운율·행 수·구성 순서를 엄격히 따르고, 규칙 밖 자유분방 금지.';
  if (L === 'es') return 'Eres un letrista profesional. Solo escribe la letra misma (una línea por frase, pueden ser varias líneas). Sin explicaciones, sin comillas, sin "Aquí está la letra". Debes seguir estrictamente las 【硬性创作规则】 del mensaje del usuario sobre esquema de rima, longitud de línea y orden de estructura; quédate dentro de esas reglas, no improvises fuera de ellas.';
  // zh / bilingual 默认华语
  return '你是一位专业的华语流行歌歌词创作助手。只输出歌词内容本身（可含若干行），不要解释、不要加引号、不要写“以下是”。你必须严格遵守用户消息里【硬性创作规则】列出的押韵政策、行数字数与结构顺序，在规则内发挥，禁止脱框自由发挥。';
}

// 风格蒸馏语料库：词人风格指纹 + 歌手作品气质，按中文名索引。仅落盘本机，不回传浏览器。
function loadJSON(p, def) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return def; } }
const LYRICISTS_FILE = path.join(DATA, 'lyricists.json');
const LYRICISTS_CUSTOM_FILE = path.join(DATA, 'lyricists-custom.json');
// 合并内置库与用户自定义库（自定义同名覆盖内置），自定义库独立文件便于管理
let LYRICISTS = Object.assign({}, loadJSON(LYRICISTS_FILE, {}), loadJSON(LYRICISTS_CUSTOM_FILE, {}));
// 词人创作手法蒸馏库（可执行 craft profile）：取代旧版"风格标签"式 prose，让模型照真实笔法走
const LYRICIST_CRAFT_FILE = path.join(DATA, 'lyricist-craft.json');
const LYRICIST_CRAFT = loadJSON(LYRICIST_CRAFT_FILE, {});
const SINGER_PROFILES = loadJSON(path.join(DATA, 'singers.json'), {});
// 写歌硬性规则：机器可读单一真源，AI 提示词直接读它，禁止脱框自由发挥
const RULES_FILE = path.join(DATA, 'rules.json');
let RULES = loadJSON(RULES_FILE, {});

// 配置优先级：环境变量 > data/ark-config.json。Key 仅落盘在本机，不回传给浏览器。
function loadArkConfig() {
  let file = {};
  try { file = JSON.parse(fs.readFileSync(ARK_CONFIG_FILE, 'utf8')); } catch {}
  // 迁移：旧默认（普通端点 + seed pro 模型）在 Coding Plan 下会报“未激活模型”，自动切到 Coding 端点与 Auto 模型
  const LEGACY_BASE = 'https://ark.cn-beijing.volces.com/api/v3';
  const LEGACY_MODEL = 'doubao-seed-2-1-pro-260628';
  let migrated = false;
  if (!process.env.ARK_BASE && file.arkBase === LEGACY_BASE) { file.arkBase = ARK_BASE_DEFAULT; migrated = true; }
  if (!process.env.ARK_MODEL && file.arkModel === LEGACY_MODEL) { file.arkModel = ARK_MODEL_DEFAULT; migrated = true; }
  if (migrated && file.arkApiKey) {
    try { fs.writeFileSync(ARK_CONFIG_FILE, JSON.stringify(file, null, 2)); console.log('已自动迁移火山方舟配置到 Coding Plan 端点'); } catch {}
  }
  const arkApiKey = process.env.ARK_API_KEY || file.arkApiKey || '';
  return {
    provider: file.provider || 'ark',
    arkApiKey,
    arkModel: file.arkModel || ARK_MODEL_DEFAULT,
    arkBase: file.arkBase || process.env.ARK_BASE || ARK_BASE_DEFAULT,
    ollamaBase: file.ollamaBase || OLLAMA_BASE,
  };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req, res) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      // 超限必须先把 413 真正写出去：早先用 req.destroy() 硬掐连接，客户端只拿到
      // "fetch failed" 的 network error，无法区分「请求体过大」与「服务已崩溃」。
      if (size > 5 * 1024 * 1024) {
        req.removeAllListeners('data');
        if (res && !res.headersSent) {
          try { res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: false, message: '请求体过大（>5MB）' })); }
          catch { /* 写失败也不阻塞 reject */ }
        }
        reject(Object.assign(new Error('body too large'), { statusCode: 413 }));
        return;
      }
      data += c;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// 简单安全化文件名，避免路径穿越
function safeId(id) {
  return String(id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || 'song';
}

// 短缓存（10s）：高频续写/状态探测时不必每次都打 /api/tags（1.5s 超时），减少无谓探测。
let OLLAMA_AVAIL_CACHE = { base: '', at: 0, val: null };
async function ollamaAvailable(base) {
  const u = base || OLLAMA_BASE;
  const now = Date.now();
  if (OLLAMA_AVAIL_CACHE.base === u && OLLAMA_AVAIL_CACHE.val && now - OLLAMA_AVAIL_CACHE.at < 10000) {
    return OLLAMA_AVAIL_CACHE.val;
  }
  let val;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const r = await fetch(`${u}/api/tags`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) { val = { ok: false, base: u, models: [] }; }
    else {
      const j = await r.json();
      val = { ok: true, base: u, models: (j.models || []).map((m) => m.name) };
    }
  } catch {
    val = { ok: false, base: u, models: [] };
  }
  OLLAMA_AVAIL_CACHE = { base: u, at: now, val };
  return val;
}

// 火山方舟（Volcengine Ark）：OpenAI 兼容的 /chat/completions
// 注意：ark-code-latest 是「推理模型」，会把 token 预算主要花在 reasoning_content（思维链，常含英文思考），
// 而非正文 content。实测 max_tokens=1500 时 reasoning 吃掉 ~1500-2700 token，正文预算为 0，
// finish_reason="length" → content 为空 → 前端不写歌词。因此必须把 max_tokens 提到足够大（8192），
// 给推理 + 正文留出余量；并相应放宽超时（180s）。正文一律只读 content，绝不用推理链当歌词。
// 注意：Node 内置 fetch 走 undici，其默认 bodyTimeout/headersTimeout 是 300_000ms。
// 当这里设的超时也接近 300s 时，undici 会抢在 AbortController 之前掐断连接，
// 抛出的异常是含糊的 TypeError: fetch failed，而不是 AbortError——
// 于是「超时重试」与「超时友好文案」两个分支都进不去，用户看到一句看不懂的报错。
// 约束：单次调用上限压到 285s，让我们的 abort 永远先于 undici 生效。
const ARK_TIMEOUT_CEILING = 285000;

async function arkCallOnce(prompt, model, cfg, sys, timeoutMs) {
  const TIMEOUT = Math.min(timeoutMs || 180000, ARK_TIMEOUT_CEILING);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  const _t0 = Date.now();
  const _sz = 'promptLen=' + String(prompt || '').length + ' sysLen=' + String(sys || '').length + ' timeout=' + TIMEOUT;
  let r;
  try {
    r = await fetch(`${cfg.arkBase}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.arkApiKey },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: sys || arkSysFor('zh') }, { role: 'user', content: prompt }],
        temperature: 0.9,
        max_tokens: 8192,
      }),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    // 日志只记规模与耗时，绝不打印 prompt 内容与 API Key
    console.log('[ark] 失败 ' + model + ' ' + _sz + ' ms=' + (Date.now() - _t0) + ' ' + e.name);
    // 超时（AbortError）与真网络错误要分开文案：前者是「生成较慢」，用户看得懂才知道下一步做什么，
    // 直接把 "This operation was aborted" 抛给用户毫无意义。
    const timedOut = e.name === 'AbortError' || /abort/i.test(e.message || '');
    if (timedOut) {
      return { ok: false, code: 'ark_timeout',
        message: 'AI 生成较慢，超出了 ' + Math.round(TIMEOUT / 1000) + ' 秒的限制，本次未出结果。请再试一次；若反复失败，可点右上角「⚙ 设置」切换到 Ollama 本地模型。' };
    }
    // "fetch failed" 多半是 undici 在 300s 处掐断（见 ARK_TIMEOUT_CEILING），这里给能看懂的说法
    const isFetchFail = /fetch failed/i.test(e.message || '');
    return { ok: false, code: 'ark_network',
      message: isFetchFail ? '与火山方舟的连接中断（可能耗时过长）。请再试一次；若反复失败，可点右上角「⚙ 设置」切换到 Ollama 本地模型。'
                           : '调用火山方舟失败：' + e.message };
  }
  clearTimeout(timer);
  console.log('[ark] 返回 ' + model + ' ' + _sz + ' ms=' + (Date.now() - _t0));
  if (!r.ok) {
    let detail = `火山方舟返回 ${r.status}`;
    try { const ej = await r.json(); if (ej && ej.error && ej.error.message) detail = ej.error.message; } catch {}
    const code = r.status === 401 ? 'ark_auth' : (r.status === 404 || r.status === 400) ? 'ark_model' : 'ark_error';
    return { ok: false, code, message: detail };
  }
  const j = await r.json();
  const msg = (j.choices && j.choices[0] && j.choices[0].message) || {};
  // 只用最终答案 content；ark-code-latest 是推理模型，其 reasoning_content 是思维链（常含英文思考），
  // 绝不是歌词，绝不可当作歌词兜底。content 为空即判 ark_empty，交由 arkSuggest 重试。
  const text = (msg.content || '').trim();
  if (!text) return { ok: false, code: 'ark_empty', message: '火山方舟返回内容为空，请重试' };
  return { ok: true, model, text, provider: 'ark' };
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// 偶发空内容自动重试（最多 3 次，指数退避 0.7s / 1.4s）。鉴权/模型/网络错误不重试，直接上抛。
async function arkSuggest(prompt, model, cfg, sys, timeoutMs) {
  const MAX_ATTEMPTS = 3;
  let last = null;
  // 超时与空内容是两种不同成因：空内容重试有意义（推理模型偶发吐不出正文）；
  // 超时则是 Ark 侧长尾慢响应，重试也能救回一部分（实测同样 prompt 有时 89s 出、有时超时）。
  // 但整轮只给一次重试机会，且第二次用「短预算」——若第一次已等满 300s，第二次再等满 300s
  // 意味着用户干等 10 分钟；短预算既能快速判死，也保留了"刚好赶上"的救援窗口。
  let retriedTimeout = false;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await arkCallOnce(prompt, model, cfg, sys, timeoutMs);
    if (res.ok) return res;
    if (res.code === 'ark_timeout' && !retriedTimeout) {
      retriedTimeout = true;
      const t2 = Math.min(60000, Math.max(30000, Math.round((timeoutMs || 180000) * 0.3)));
      console.log('[ark] 首次超时，短预算重试一次（' + t2 + 'ms）');
      const res2 = await arkCallOnce(prompt, model, cfg, sys, t2);
      if (res2.ok) return res2;
      // 第二次若是超时，直接把两次的结果一并告知用户，不落到空内容重试里空转
      if (res2.code === 'ark_timeout') {
        return { ok: false, code: 'ark_timeout',
          message: 'AI 生成较慢，两次尝试（' + Math.round((timeoutMs || 180000) / 1000) + 's + ' + Math.round(t2 / 1000) + 's）都没出结果。请再试一次；若反复失败，可点右上角「⚙ 设置」切换到 Ollama 本地模型。' };
      }
      if (res2.code !== 'ark_empty') return res2;
      last = res2;
      continue;
    }
    if (res.code !== 'ark_empty') return res; // 非"空内容"错误不重试
    last = res;
    if (attempt < MAX_ATTEMPTS) await sleep(700 * attempt);
  }
  return last || { ok: false, code: 'ark_empty', message: '火山方舟返回内容为空' };
}

async function handleAiSuggest(body) {
  const { context = '', instruction = '', model = '', style = null, singer = null, provider = '', sectionType = '', mode = '', pinned = [], genre = '', language = 'zh', bpm = '', key = '', meter = '', energy = '', brief = null } = body || {};
  const cfg = loadArkConfig();
  const useProvider = provider || cfg.provider || (cfg.arkApiKey ? 'ark' : 'ollama');
  const sys = arkSysFor(language);
  const songMeta = { bpm: bpm || '', key: key || '', meter: meter || '' };
  const prompt = buildPrompt(context, instruction, style, singer, sectionType, mode, pinned, genre, language, songMeta, brief, energy);

  if (useProvider === 'ark') {
    if (!cfg.arkApiKey) {
      return { ok: false, code: 'ark_no_key',
        message: '未配置火山方舟 API Key。请点右上角「⚙ 设置」填入（或在服务端设置环境变量 ARK_API_KEY）。' };
    }
    const useModel = model || cfg.arkModel || ARK_MODEL_DEFAULT;
    // 超时按 mode 区分：「写整首」要输出完整多段歌词，且推理模型的思维链本身很长，
    // 实测常在 150-200s 之间、越过默认的 180s 后 abort（表现：ok:false + "This operation was aborted"）。
    // 另两条耗时长的路径（蒸馏 / 命名）已经各自传了 300000，写词路径此前漏了。
    const arkTimeout = mode === 'song' ? 300000 : 180000;
    return await arkSuggest(prompt, useModel, cfg, sys, arkTimeout);
  }

  // Ollama
  const avail = await ollamaAvailable(cfg.ollamaBase);
  if (!avail.ok) {
    return { ok: false, code: 'ollama_unavailable',
      message: '未检测到本机 Ollama。可在「⚙ 设置」切换到「火山方舟」，或安装并启动 Ollama（ollama serve）后拉取模型（如 ollama pull qwen2.5:7b）。' };
  }
  const useModel = model || (avail.models[0] || 'qwen2.5:7b');
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 60000);
    const r = await fetch(`${avail.base}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: useModel, prompt, stream: false, options: { temperature: 0.9 } }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!r.ok) return { ok: false, code: 'ollama_error', message: `Ollama 返回 ${r.status}` };
    const j = await r.json();
    return { ok: true, model: useModel, text: (j.response || '').trim(), provider: 'ollama' };
  } catch (e) {
    return { ok: false, code: 'ollama_error', message: `调用 Ollama 失败：${e.message}` };
  }
}

// 解析 AI 现场蒸馏返回的 JSON（容错：去 ```json 标记、截取首个 { 到末 }）
function parseAILyricistJSON(text) {
  if (!text) return null;
  let t = String(text).trim();
  const m = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (m) t = m[1].trim();
  const s = t.indexOf('{');
  const e = t.lastIndexOf('}');
  if (s < 0 || e < 0 || e <= s) return null;
  try {
    const o = JSON.parse(t.slice(s, e + 1));
    if (!o || typeof o.profile !== 'string') return null;
    return o;
  } catch { return null; }
}

// 演唱匹配：把演唱者的声音条件注入提示，让歌词适配人声演唱
function singerBlock(singer) {
  if (!singer) return '';
  const parts = [];
  if (singer.name) parts.push(singer.name);
  if (singer.gender) parts.push(singer.gender);
  if (singer.register) parts.push(singer.register);
  const who = parts.join('·') || '歌手';
  let s = `\n\n【演唱匹配】这首歌由「${who}」演唱`;
  if (singer.timbre) s += `，音色/风格：${singer.timbre}`;
  const sp = (singer.name && SINGER_PROFILES[singer.name]) || null;
  if (sp) s += `\n该演唱者的作品气质：${sp}`;
  s += '。请让歌词在音节密度、母音开口度与音域难度上适配该演唱者，便于人声自然演唱' +
       '（例如低音声部避免过多高音区闭口音，高音声部可多用明亮开口母音；rap 可加密音节，抒情可留气口）。';
  return s;
}

// 各段落类型的写作要点，注入提示让 AI 区分主歌/副歌/桥段等，避免生成雷同
const SECTION_GUIDE = {
  主歌: '叙事与铺陈，展开意象、推进画面，情绪相对克制，押韵可稍自由但需自然',
  副歌: '情绪高潮与记忆点，重复性强、点题、押韵更齐整易唱，是整首最该被记住的句子',
  导歌: '铺垫与引入，简短、留白，把人带进氛围',
  桥段: '转折与升华，换角度或换情绪，打破前面的重复，制造惊喜',
  前奏: '一般无歌词，如需写词应极简短、有氛围感念白',
  间奏: '一般无歌词，如需写词应极简短、有氛围感念白',
  尾奏: '收束与余韵，简短、留白、呼应主题',
};

// 把 rules.json 编译成「硬性创作规则」约束块，注入提示词，让 AI 只能在规则内发挥。
// 按语种切换韵脚政策（中文=十三辙，其他语种=各自韵脚体系），按曲风（如说唱）放宽行字数并加专项要求。
function buildRulesBlock(language, genre, songMeta) {
  if (!RULES) return '';
  const lang = language || 'zh';
  const r = RULES;
  const out = ['【硬性创作规则（必须严格遵守，禁止脱框自由发挥）】'];
  // 一、押韵政策：中文/双语用十三辙，其他语种用 rules.json.languages 里的对应政策
  if (lang === 'zh' || lang === 'bilingual') {
    out.push('一、押韵政策（中文段按十三辙，同辙即同韵）：');
    ['主歌', '副歌', '桥段', '导歌', '前奏', '间奏', '尾奏'].forEach((k) => {
      if (r.rhyme[k]) out.push(`  · ${k}：${r.rhyme[k]}`);
    });
    if (lang === 'bilingual') out.push('  · 英文段：行末尾韵（end rhyme），推荐 AABB / ABAB，可与中文段韵脚呼应。');
  } else if (r.languages && r.languages[lang]) {
    out.push('一、押韵与节奏政策（按语种）：');
    out.push('  · ' + r.languages[lang]);
  }
  out.push('二、行数字数：');
  if (genre === 'rap') {
    out.push(`  · 说唱句可更长更密：中文每行推荐 ${r.line.recommendedChars}-24 字（上限 24），英文约 12-20 音节；允许断句与气口标点（逗号、斜杠表示停顿）。`);
  } else {
    out.push(`  · 每行字数 = 非标点字符数，推荐 ${r.line.recommendedChars} 字，严禁超过 ${r.line.maxChars} 字（否则难唱）。`);
  }
  out.push(`  · 整首模式每段 ${r.line.linesPerSection}；导出要求单行≤${r.line.suno.maxCharsPerLine}字、每段≤${r.line.suno.maxLinesPerSection}行、全曲约 ${r.line.suno.totalCharsRange[0]}-${r.line.suno.totalCharsRange[1]} 字。`);
  out.push('  · 段落行数必须为偶数、且主歌与副歌行数对称（同 4 行或同 8 行），严禁奇数行、严禁主 8/副 4 这类不对称组合——不对称会让 Suno/Udio 在段落过渡处错位、副歌歌词提前进入主歌。');
  // 气口与呼吸（可唱性硬约束）：从 rules.json.breath 注入，所有生成模式均生效
  if (r.breath) {
    out.push('三、气口与呼吸（可唱性硬约束，必须严格遵守）：');
    out.push('  · ' + r.breath.oneBreathBudget);
    out.push('  · ' + r.breath.placeAt);
    out.push('  · ' + r.breath.beforeHighNote);
    out.push('  · ' + r.breath.slowVsFast);
    out.push('  · ' + r.breath.markConvention + '（曲风气口预算：' + JSON.stringify(r.breath.genreBudget || {}) + '）');
  }
  out.push('四、结构：必须沿用所选模板的段落顺序与性质，禁止自创结构或随意换辙。');
  if (r.structure && r.structure.chorusRepeat) out.push('  · ' + r.structure.chorusRepeat);
  if (r.structure && r.structure.symmetry) out.push('  · ' + r.structure.symmetry);
  // 五、曲风专项要求（下方 push 实际编号：rap→「五、说唱专项要求」，其它→「五、曲风要求」）
  if (genre === 'rap' && r.genres && r.genres.rap) {
    const g = r.genres.rap;
    out.push('五、说唱专项要求：');
    (g.required || []).forEach((x) => out.push('  · 必须：' + x));
    (g.forbidden || []).forEach((x) => out.push('  · 禁止：' + x));
  } else if (r.genres && r.genres[genre] && typeof r.genres[genre] === 'string') {
    out.push('五、曲风要求：' + r.genres[genre]);
  }
  // 六、词作技巧（文学性提升，向经典教材蒸馏；与前述硬性规则同时落实）
  if (r.craft) {
    out.push('六、词作技巧（文学性提升，须与前述硬性规则同时落实）：');
    if (r.craft.summary) out.push('  · ' + r.craft.summary);
    ['imagery', 'focus', 'cliche', 'pov', 'rhymeDial', 'prosody', 'arc', 'space', 'groove'].forEach((k) => {
      if (r.craft[k]) out.push('  · ' + r.craft[k]);
    });
  }
  // 七、节奏网格（让歌词与节拍挂钩，可唱且有律动；按曲风分流）
  if (r.rhythm) {
    const g = (genre && typeof genre === 'string') ? genre : '';
    out.push('七、节奏网格（歌词须与节拍挂钩、有律动，但避免套用单一方块式假设）：');
    if (r.rhythm.summary) out.push('  · ' + r.rhythm.summary);
    const meter = (songMeta && songMeta.meter) || (r.rhythm && r.rhythm.meter) || '4/4';
    const bpm = (songMeta && songMeta.bpm) || '';
    out.push('  · 本曲拍号 ' + meter + (bpm ? '，速度 ' + bpm + ' BPM' : '') + '；每小节字预算 = 拍号分子 ÷ 字/拍（默认 1 字=1 拍）。');
    if (r.rhythm.charPerBeat) out.push('  · 字/拍（按曲风）：' + JSON.stringify(r.rhythm.charPerBeat) + '（说唱可 1 字=半拍更密）。');
    if (r.rhythm.strongBeat) out.push('  · ' + r.rhythm.strongBeat);
    if (r.rhythm.syncopation) out.push('  · ' + r.rhythm.syncopation);
    if (r.rhythm.barSuggest) out.push('  · ' + r.rhythm.barSuggest);
    if (r.rhythm.downbeatRest) out.push('  · ' + r.rhythm.downbeatRest);
    if (g === 'rap' || g === 'rock') {
      out.push('  · 本曲风(' + g + ')：以 flow / 切分 / 反拍重音为律动核心，句长随 BPM 密度放宽，不要求字字落正拍、不锁 1字1拍；重音落核心实词即可。');
    } else {
      out.push('  · 本曲风(' + (g || '流行') + ')：可在规整句长基础上做长短句错落；强拍落核心实词、允许 off-beat 点缀，避免念经感。');
    }
  }
  // 八、旋律约束（句尾音级 / 音域 / 动机【通用】；依字行腔【按曲风】）
  if (r.melody) {
    const g = (genre && typeof genre === 'string') ? genre : '';
    out.push('八、旋律约束（歌词须适配歌唱；句尾音级/音域/动机为通用约束，依字行腔按曲风分流）：');
    if (r.melody.summary) out.push('  · ' + r.melody.summary);
    if (r.melody.cadence) out.push('  · ' + r.melody.cadence);
    if (r.melody.range) out.push('  · ' + r.melody.range);
    if (r.melody.motif) out.push('  · ' + r.melody.motif);
    if (r.melody.yizi) out.push('  · ' + r.melody.yizi);
    if (songMeta && songMeta.key) out.push('  · 本曲调式 ' + songMeta.key + '：句尾音级据此取该调的主音/属音（稳定）与导音（不稳定）。');
    if (g === 'rap' || g === 'rock') {
      out.push('  · 本曲风(' + g + ')：依字行腔非必需，以 flow 与律动优先；去声字不必强行配下行，服从节奏与韵脚。');
    } else {
      out.push('  · 本曲风(' + (g || '流行') + ')：建议在句尾与重拍让字声调顺势、避免明显倒字（尤其古风/民谣/抒情）。');
    }
  }
  if (Array.isArray(r.forbidden) && r.forbidden.length) {
    out.push('九、通用禁止项（违反即不合格）：');
    r.forbidden.forEach((f) => out.push('  · ' + f));
  }
  return out.join('\n');
}

// 语种指令：决定创作语言与韵脚体系。中文段仍按十三辙；其他语种按各自韵脚（见 rules.json languages）
const LANGS_NOTE = {
  zh: '',
  en: '【创作语种】请用英语（English）写作歌词，自然地道，不要逐字翻译中文。',
  ja: '【创作语种】日本語で歌詞を書いてください。自然で詩的な表現を心がけて。',
  ko: '【创作语种】한국어로 가사를 써주세요. 자연스럽고 리듬감 있게.',
  es: '【创作语种】Escribe la letra en español, natural y con flow.',
  bilingual: '【创作语种】中英双语：主歌以中文为主，副歌可中英呼应或穿插英文 hook；中文段守十三辙，英文段守尾韵（end rhyme）。',
};
// 曲风指令：说唱 / 民谣 / 古风 / 摇滚
const GENRE_NOTE = {
  rap: '【曲风·说唱/Rap】这是说唱作品：节奏驱动、音节密度高；押韵密度显著高于普通流行（句句押或隔句押），鼓励多音节押韵、内部韵（同一句内前后押韵）与押头韵（alliteration）；要有清晰的 flow 与断句（可用逗号/斜杠表示气口停顿），并至少埋 1-2 处 punchline（巧妙双关/反转/态度）。',
  folk: '【曲风·民谣】口语化、叙事强，吉他扫弦般规整的短句；意象朴素真实，押韵自然不刻意。',
  ancient: '【曲风·古风】半文白词汇、古典意象，押韵考究、句式工整。',
  rock: '【曲风·摇滚】有力量与态度，短促有力句、呐喊式重复；押韵可更自由，重情绪爆发。',
};
// 能量 / 硬度定位：每首歌自己的选择，不是统一标准。
// 默认「标准」(空) 不注入任何提示，保持现有软基线行为（老歌零变化）；
// 只有用户显式选了 soft / energetic / hard 才注入对应指令，软歌能保持软、硬歌能拉硬。
const ENERGY_NOTE = {
  soft: '【能量定位·柔和】这首歌以温柔 / 叙述 / 抒情为底色：允许并善用留白、含蓄与意象铺陈，句长可舒缓，不必追求力量感与密度；软本身就是对的表达，不要强行加劲。',
  energetic: '【能量定位·有力】这首歌需要明确的能量推进：副歌 / 爆发段用短促重拍句、动词有力、适当重复强化记忆点与情绪推力，避免全程温吞；叙述段仍可保留呼吸感，不必句句炸。',
  hard: '【能量定位·炸裂】这首歌要强态度与冲击力：短句、重拍、呐喊式重复、强动词与态度表达，节奏密集，杜绝温吞与散文化长句；让能量从头到尾压住。',
};

function buildPrompt(context, instruction, style, singer, sectionType, mode, pinned, genre, language, songMeta, brief, energy) {
  const lines = [
    '你是一位专业的华语流行歌歌词创作助手。',
    '请根据已有歌词的语气、意象与押韵风格，续写或改写。',
    '只输出歌词内容本身（每行一句，可含若干行），不要解释、不要加引号、不要写“以下是”。',
  ];
  if (mode === 'song') {
    lines.push('请一次性输出一整首歌（多个段落）。每个段落用一行段落标题标明，格式为：【主歌】【副歌】【桥段】【导歌】【前奏】【间奏】【尾奏】（可带序号如【主歌1】），或英文 [Verse]/[Chorus]/[Bridge] 等，段落标题必须独占一行，标题正下方才是该段歌词，每行一句。不要输出标题以外的任何说明文字。');
  } else {
    lines.push('严禁把段落类型名（如“主歌”“副歌”“桥段”）或方括号/【】结构标记写进歌词正文。');
  }
  // 语种指令：决定创作语言（中文段仍按十三辙，其他语种按各自韵脚体系）
  const langNote = LANGS_NOTE[language] || '';
  if (langNote) lines.push(langNote);
  // 曲风指令：说唱 / 民谣 / 古风 / 摇滚
  const genreNote = GENRE_NOTE[genre] || '';
  if (genreNote) lines.push(genreNote);
  // 能量 / 硬度定位：每首歌自己的选择（默认「标准」空值不注入，保持现有软基线）
  const energyNote = ENERGY_NOTE[energy] || '';
  if (energyNote) lines.push(energyNote);
  // 段落类型语义：让主歌/副歌/桥段生成出不同性质的内容，而不是雷同
  if (sectionType) {
    const g = SECTION_GUIDE[sectionType] || '请按该段落在一首歌中的作用来写';
    lines.push('', `【段落类型】这是一首歌的「${sectionType}」段落。写作要点：${g}。请直接写这一段的歌词，不要把“${sectionType}”这类段落类型名写进歌词正文。`);
  }
  // 词人风格蒸馏：优先注入「可执行创作手法 craft profile」，让模型照真实笔法走；查不到才退回旧版 prose 风格标签
  if (style && style.name) {
    const C = (LYRICIST_CRAFT && LYRICIST_CRAFT[style.name]) || null;
    let blk = `\n\n【词人风格蒸馏·模仿著名作词人【${style.name}】】`;
    if (C && C.essence) {
      blk += `\n创作内核（一句话抓住此人不可替代的笔法本质）：${C.essence}`;
    }
    if (C && Array.isArray(C.craftMoves) && C.craftMoves.length) {
      blk += `\n——以下为「硬性创作手法」，请逐条照做（不是参考，是约束）：`;
      C.craftMoves.forEach((m, i) => {
        blk += `\n手法${i + 1}【${m.name}】触发：${m.trigger}；怎么做：${m.method}；范例：${m.workedExample}；效果：${m.effect}`;
      });
    }
    if (C && Array.isArray(C.forbidden) && C.forbidden.length) {
      blk += `\n——绝对避免（此人绝不会这么写）：${C.forbidden.join('；')}`;
    }
    if (C && C.structureSignature) {
      blk += `\n结构签名（句式/韵脚/节奏）：${C.structureSignature}`;
    }
    if (C && Array.isArray(C.realLyrics) && C.realLyrics.length) {
      blk += `\n该词人真实作品例句（仅作语感与句式参考，不要原文复现、不要照抄词句）：$\n` +
        C.realLyrics.map((e, i) => `真实${i + 1}：${e}`).join('\n');
    }
    // 兜底：craft 缺失时退回旧版 prose 风格标签（自定义词人等）
    if (!C) {
      const L = (LYRICISTS && LYRICISTS[style.name]) || null;
      blk += `\n请模仿著名作词人【${style.name}】的作词风格来创作。`;
      const src = (L && L.profile) ? L.profile : (style.desc || '');
      if (src) blk += `\n风格要点：${src}`;
      if (L && Array.isArray(L.lyrics) && L.lyrics.length) {
        blk += `\n该词人真实作品例句（仅作语感与句式参考，不要原文复现、不要照抄词句）：$\n` +
          L.lyrics.map((e, i) => `真实${i + 1}：${e}`).join('\n');
      } else if (L && Array.isArray(L.examples) && L.examples.length) {
        blk += `\n该词人风格笔法示例（仅供把握语感，不要照抄、不要原文复现）：$\n` +
          L.examples.map((e, i) => `示例${i + 1}：${e}`).join('\n');
      }
    }
    lines.push('', blk);
  }
  const sb = singerBlock(singer);
  if (sb) lines.push('', sb);
  const rb = buildRulesBlock(language, genre, songMeta);
  if (rb) lines.push('', rb);
  // 锁定金句：用户标记为「金句」的句子必须原样保留，AI 不得改写、不得删除
  if (Array.isArray(pinned) && pinned.length) {
    lines.push('', '【锁定金句（必须原样保留，一字不改，出现在输出对应位置）】' +
      pinned.map((p, i) => `\n  ${i + 1}. ${p}`).join(''));
  }
  // 委托要求（客户 / 委托方给的原始资料）：story 给素材，must 必须原样出现，avoid 坚决不写，tone 管口气
  if (brief && typeof brief === 'object') {
    const pick = (v) => String(v == null ? '' : v).trim();
    const briefLines = (v) => String(v == null ? '' : v).split(/\n/).map((s) => s.trim()).filter(Boolean);
    const story = pick(brief.story), must = pick(brief.must), avoid = pick(brief.avoid), tone = pick(brief.tone), traits = pick(brief.traits);
    // 必留词堆太多时，模型会把它们当成一串待办任务，退化成「挑几个词各写一句」——
    // 表现为整首只出这么几句。超过上限只取前几条并如实告知省略数，同时在约束里点明
    // 「分散到不同段落、写满全部段落」，把这个退化路径堵回去。
    const MUST_CAP = 6;
    let musts = must ? must.split(/[\n，,、;；]/).map((s) => s.trim()).filter(Boolean) : [];
    let mustDropped = 0;
    if (musts.length > MUST_CAP) { mustDropped = musts.length - MUST_CAP; musts = musts.slice(0, MUST_CAP); }
    const avoids = avoid ? avoid.split(/[\n，,、;；]/).map((s) => s.trim()).filter(Boolean) : [];
    const traitList = briefLines(traits);
    if (story || traitList.length || musts.length || avoids.length || tone) {
      let blk = '\n\n【委托要求（客户/委托方给的原始资料，必须全部满足）】';
      if (story) blk += `\n故事与主题要点：${story}`;
      if (traitList.length) blk += `\n必须用到的笔法特质（照此手法写，不是堆意象）：${traitList.join('；')}`;
      if (musts.length) {
        blk += `\n必须原样出现的词句（一条都不能少，放在自然的位置上）：${musts.join('；')}`;
        if (mustDropped) blk += `\n（另有 ${mustDropped} 条因过多已省略，本次不必强求）`;
        // 关键防退化：明确「分散 + 写满段落」，否则模型会挤成一两句把必留词交代完
        blk += '\n注意：上面这些词要分散到整首歌的不同段落里自然写出，不是每个词单独占一句、也不是只挑一两句交代完；输出必须写满前面给出的全部段落。';
      }
      if (avoids.length) blk += `\n坚决不写（客户明确排除的内容，出现即不合格）：${avoids.join('；')}`;
      if (tone) blk += `\n口气 / 人称 / 其他要求：${tone}`;
      blk += '\n以上为硬性约束，优先级高于你的创作习惯与词人风格；若与词人风格冲突，以本要求为准。';
      lines.push('', blk);
    }
  }
  lines.push('', '【已有歌词】', context || '（暂无）', '', '【要求】',
    instruction || '续写 2-4 行，保持原有情绪与韵脚走向。');
  return lines.join('\n');
}

// ===== 实时榜单灵感：采集 与 「切」解耦 =====
// 采集（collect）：定时拉榜单 + 抓歌词原文，纯 I/O、便宜，保持素材常新（用户要求「可以定时采集」）。
// 切（slice→金句→AI 归纳主题）：烧 token、跑 1-2 小时，仅在「用户请求 + 检测到新抓取内容」时触发
// （用户要求：按需触发，并且是检测到有新的抓取内容的时候再触发）。两者不再绑死、不再盲跑定时器。
// 可用环境变量临时覆盖（验证用）：CHART_REFRESH_MS（采集周期）/ CHART_MAX_TRACKS（采集首数）。
const CHART_REFRESH_MS = process.env.CHART_REFRESH_MS ? Number(process.env.CHART_REFRESH_MS) : 12 * 60 * 60 * 1000;
let CHART_RAW = null;   // { collectedAt, sig, tracks:[{name,artist,lrcText}] } 已采集的原始素材
let CHART_CACHE = { ts: 0, items: null, source: '', running: false, total: 0, done: 0 };  // 已「切」出的主题池
let CHART_LAST_CUT_SIG = '';   // 上一次「切」所基于的素材签名；与 CHART_RAW.sig 不同即表示有新内容
let CHART_COLLECT_TIMER = null; // 定时采集的定时器句柄

// （静态关键词分类子系统已移除：THEME_RULES / THEME_LINES / GENRE_HINTS / THEME_CRAFT /
//  inspireCraftForTheme / classifyTrack。它们是旧版「直连网易云 → 关键词分类」兜底路径的部件；
//  而该路径的 163 直连已证实多为死链，兜底现统一走本地静态池 hot-themes.json，故这些表不再被引用。）

// ===== 歌词蒸馏管道：榜单 → 抓歌词 → 主歌/副歌/变化段 → 金句 → 主题名从金句归纳 =====
// 与旧的「关键词 → 15 个固定主题」根本不同：主题名由模型读完金句后归纳，
// 同一首歌的不同角度会拆成不同条目，池子上限不再被固定 bucket 锁死。
// 金句本身只是分析素材（用于命名与提炼笔法），绝不能当卡面文案照抄。
const METING_PLAYLISTS = [
  { name: '网易云音乐热歌榜', id: '3778678', source: 'netease' },
  { name: '网易云音乐新歌榜', id: '3779629', source: 'netease' },
];
async function metingGet(url, timeout = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally { clearTimeout(t); }
}
async function metingPlaylist(p) {
  const j = await metingGet('https://api.injahow.cn/meting/?type=playlist&id=' + p.id + '&source=' + p.source);
  if (!Array.isArray(j)) return [];
  return j.filter((x) => x && x.name && x.lrc).map((x) => ({ name: x.name, artist: x.artist || '', lrc: x.lrc }));
}

// LRC 逐行解析：元数据行（作词/编曲…）会在中间插空行，若按「第 i 个时间戳 ↔ 第 i 段文本」
// 索引对应会整体错位（实测 58 个时间戳对 117 段文本）。必须逐行解析，每行取最后一个时间戳。
const LRC_META = /^(作词|作曲|编曲|制作人|出品|发行|吉他|贝斯|bass|鼓|键盘|混音|母带|录音|和声|op|sp|策划|统筹|词|曲|监制|制作|弦乐|艺术指导|制作团队|vocal|rap|混缩|guitar|piano)\s*[:：]/i;
function parseLRCLines(raw) {
  if (!raw) return [];
  const re = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  const out = [];
  for (const rl of raw.split(/\r?\n/)) {
    const stamps = [];
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(rl))) {
      stamps.push(parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + (m[3] ? parseFloat('0.' + m[3]) : 0));
    }
    if (!stamps.length) continue;
    const text = rl.replace(re, '').trim();
    if (!text || LRC_META.test(text) || /^\[[^\]]*\]$/.test(text)) continue;
    out.push({ t: stamps[stamps.length - 1], text });
  }
  return out;
}
// 按时间间隙断段 → 出现次数最多的段认作副歌（重复 <2 就承认识别不出，绝不拿任意一段顶替）。
// 副歌之后剩下的尾部段落里，后 30% 视为「变化段/bridge」。
function sliceLyricSections(lines) {
  const GAP = 2.2;
  const groups = [];
  let cur = [];
  let prevT = lines.length ? lines[0].t : 0;
  for (const l of lines) {
    if (l.t - prevT > GAP && cur.length) { groups.push(cur); cur = []; }
    cur.push(l);
    prevT = l.t;
  }
  if (cur.length) groups.push(cur);
  const n = groups.length;
  if (n < 3) return null;
  const keys = groups.map((g) => g.map((x) => x.text).join('|'));
  const count = new Map();
  keys.forEach((k) => count.set(k, (count.get(k) || 0) + 1));
  let chorusIdx = -1, best = 0;
  for (let i = 0; i < n; i++) { const c = count.get(keys[i]) || 0; if (c > best) { best = c; chorusIdx = i; } }
  const isChorus = (i) => best >= 2 && i === chorusIdx;
  const verse = groups.filter((g, i) => !isChorus(i) && i < Math.ceil(n * 0.7));
  const tail = groups.filter((g, i) => !isChorus(i) && i >= Math.ceil(n * 0.7));
  if (!verse.length || !tail.length) return null;
  return {
    verse: verse.flat().map((x) => x.text),
    chorus: (chorusIdx >= 0 ? groups[chorusIdx] : []).map((x) => x.text),
    tail: tail.flat().map((x) => x.text),
  };
}
// 金句候选打分：意象词 + 有人称 + 有标点 + 长度适中 − 口水词；每段取 top3，不设硬阈值
const LRC_IMAGERY = ['雨', '风', '雪', '海', '天', '夜', '月', '星', '光', '火', '花', '叶', '山', '河', '城', '街', '门', '窗', '茶', '烟', '酒', '梦', '影', '声', '路', '车', '云', '寒', '暖', '冷', '红', '白', '黑', '灰', '蓝', '旧', '空', '深', '远', '高', '长', '弯', '沙', '天', '手', '眼', '泪', '心'];
const LRC_SLANG = ['爱你', '想你', 'baby', 'darling', 'honey', 'yeah', 'oh my god', 'la la'];
function scoreLyricLine(s) {
  if (!s || s.length < 6) return 0;
  let sc = 0;
  for (const w of LRC_IMAGERY) if (s.includes(w)) sc += 1;
  if (/[我你他她它]/.test(s)) sc += 1;
  if (/[，,；;。！？?]/.test(s)) sc += 1;
  if (s.length >= 8 && s.length <= 20) sc += 1;
  for (const w of LRC_SLANG) if (s.toLowerCase().includes(w)) sc -= 1;
  return sc;
}
function goldLines(sections, per = 3) {
  const out = [];
  for (const [seg, arr] of [['verse', sections.verse], ['chorus', sections.chorus], ['tail', sections.tail]]) {
    arr.map((x) => ({ seg, x, sc: scoreLyricLine(x) }))
      .filter((o) => o.sc > 0)
      .sort((a, b) => b.sc - a.sc)
      .slice(0, per)
      .forEach((o) => out.push(o));
  }
  return out;
}

// 主题命名：让模型读完金句后「命名」主题，而不是做主题分类。
// 关键约束：主题名必须来自金句里的具体意象；不许用通用分类词；不许整句照抄原词。
const NAMING_SYS = `你是一位华语流行歌词分析师，擅长从一小段歌词里读出「这首歌到底在写什么」。
你的任务不是做主题分类，而是给每一批歌词**命名**——用歌词里真实出现的具体意象、动作、画面来命名。

硬性要求：
1. 主题名必须来自歌词里的具体意象（例如「茶杯上的云烟」「没说完的对不起」「凌晨三点的便利店」），
   绝不可用「失恋后的心碎」「青春成长感悟」这类通用分类词。
2. 同一批歌词若存在多个不同角度，必须拆成多条分别命名，不要合并成一条。
3. 每条 6-14 字，带画面感，能直接当灵感卡标题。
4. 主题名是该句的意思凝练，不要一字不差照抄超过 8 个字的连续原句。
5. mood 只能从这九个里选一个：豪迈、忧伤、温柔、思念、坚定、欢快、孤寂、热血、励志。
6. 只输出一个 JSON 对象，不要任何解释文字、不要 markdown 代码块。`;
const NAMING_FMT = `输出格式（严格）：
{"items":[{"song":"曲目全名","name":"主题名","mood":"忧伤","traits":["笔法特质1","笔法特质2"],"must":["必留意象1"],"avoid":["雷区1"]}]}
每条 limit 3 个以内 traits/must/avoid。must 必须是该批歌词里真实出现过的具体意象，不要凭空造。
song 字段必须逐字照抄上面某一首的【曲目】全名（含歌手），用来标明这条主题属于哪首歌——这是唯一可靠的归位依据。`;

function parseNamingJSON(text) {
  let t = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { return null; }
}
const MOODS = ['豪迈', '忧伤', '温柔', '思念', '坚定', '欢快', '孤寂', '热血', '励志'];
async function nameThemesBatch(batch) {
  const cfg = loadArkConfig();
  if (!cfg.arkApiKey) return [];
  const payload = batch.map((o) => `【曲目】${o.name} - ${o.artist}\n主歌：${o.sections.verse.join(' / ')}\n副歌：${o.sections.chorus.join(' / ')}\n结尾变化段：${o.sections.tail.join(' / ')}`).join('\n\n');
  const prompt = `下面是从 ${batch.length} 首华语歌曲里按「主歌 / 副歌 / 结尾变化段」切出的原文片段。\n\n${payload}\n\n为每一首歌归纳出 1-3 个不同的主题角度，并为每个主题给出创作提示。\n\n${NAMING_FMT}\n\n务必严格按上面给出的曲目顺序输出，每首 1-3 条，不要重排、不要遗漏。`;
  // 归纳一次要读完 6 首金句再输出结构化 JSON，推理模型常要 60-120s；并发多个请求打同一模型还会被限流拖慢，
  // 因此这里单独放宽到 300s，避免和其它写词请求抢同一个默认预算。
  const res = await arkCallOnce(prompt, cfg.arkModel || 'ark-code-latest', cfg, NAMING_SYS, 300000);
  if (!res.ok) { console.log('[naming] ' + (res.message || '失败')); return []; }
  const parsed = parseNamingJSON(res.text);
  if (!parsed || !Array.isArray(parsed.items)) { console.log('[naming] 输出解析失败：' + String(res.text).slice(0, 120).replace(/\n/g, ' ')); return []; }
  return parsed.items;
}

// 榜单合计 300 首（热歌 200 + 新歌 100）， lyrics 可下载率 100%，切分实测 94.3% 成功。
// 采集只取歌词原文（不分析、不调模型）；真正耗时的「切」在 sliceDistill 里按需触发。
// 可用环境变量 CHART_MAX_TRACKS 临时覆盖（验证用，例如只跑几首）。
const CHART_COLLECT_MAX = process.env.CHART_MAX_TRACKS ? Number(process.env.CHART_MAX_TRACKS) : 300;

// 采集：只拉榜单 + 抓歌词原文，纯 I/O、不调模型。返回 { collectedAt, sig, tracks }，失败返回 null。
// sig 用「歌名|歌手」集合生成，用于判断榜单内容是否真的发生变化（内容没变就不必重切烧 token）。
async function collectCharts(maxTracks = CHART_COLLECT_MAX) {
  let tracks = [];
  for (const pl of METING_PLAYLISTS) {
    const part = await metingPlaylist(pl);
    tracks = tracks.concat(part);
  }
  if (!tracks.length) return null;
  tracks = tracks.slice(0, maxTracks);
  console.log('[charts] 榜单共 ' + tracks.length + ' 首，开始采集歌词原文（不分析）');
  const CONC = 8;
  let idx = 0;
  const withLrc = [];
  // 注意：必须用 Promise.all 等所有 worker 真正跑完，不能让某个 worker 调用共享 resolve 提前结束
  // （CONC > 曲目数时，多余的 worker 会同步立即 resolve，导致 withLrc 还没填就被判空）。
  const workers = [];
  for (let k = 0; k < CONC; k++) {
    workers.push((async () => {
      while (idx < tracks.length) {
        const i = idx++;
        const tr = tracks[i];
        const txt = await getText(tr.lrc, 15000);
        if (txt && txt.length > 50) withLrc.push({ name: tr.name, artist: tr.artist, lrcText: txt });
      }
    })());
  }
  await Promise.all(workers);
  if (!withLrc.length) return null;
  const sig = withLrc.map((t) => t.name + '\u0000' + t.artist).sort().join('\u0001');
  return { collectedAt: Date.now(), sig, tracks: withLrc };
}

// 切：把已采集的歌词原文切成灵感（LRC 解析 → 主歌/副歌/变化段 → 金句 → AI 归纳主题）。
// onProgress 每批回调一次，让 /api/charts 能把已归纳的条目边跑边吐给前端（全量要跑近两小时）。
// 这一步才烧 token，故只在没有新素材时按需触发，绝不盲跑定时器。
async function sliceDistill(rawTracks, onProgress) {
  const CONC = 6;
  let idx = 0;
  const sliced = [];
  // 必须用 Promise.all 等所有 worker 真正跑完；否则（CONC > 曲目数时）多余的 worker 会同步立即
  // resolve，导致 sliced 还没填就被判空、整轮蒸馏归零。
  const workers = [];
  for (let k = 0; k < CONC; k++) {
    workers.push((async () => {
      while (idx < rawTracks.length) {
        const i = idx++;
        const tr = rawTracks[i];
        const lines = parseLRCLines(tr.lrcText);
        if (!lines.length) continue;
        const sections = sliceLyricSections(lines);
        if (!sections) continue;
        const golds = goldLines(sections);
        if (!golds.length) continue;
        sliced.push({ name: tr.name, artist: tr.artist, sections, golds });
      }
    })());
  }
  await Promise.all(workers);
  if (!sliced.length) return null;

  const cards = [];
  const BATCH = 6;
  for (let b = 0; b < sliced.length; b += BATCH) {
    const batch = sliced.slice(b, b + BATCH);
    const items = await nameThemesBatch(batch);
    if (!items.length) continue;
    const full = batch.map((o) => (o.name + (o.artist ? ' - ' + o.artist : '')));
    items.forEach((it) => {
      if (!it || !it.name) return;
      const mood = MOODS.includes(it.mood) ? it.mood : '温柔';
      let src = '';
      if (it.song) {
        const want = String(it.song).trim();
        src = full.find((f) => f === want)
          || full.find((f) => f.includes(want) || want.includes(f))
          || '';
      }
      if (!src) src = full[full.length - 1] || '';
      cards.push({
        source: src,
        theme: String(it.name).slice(0, 24),
        mood,
        genre: '',
        tags: ['实时榜单', '歌词蒸馏'],
        tip: '从热歌金句里归纳出的创作角度——原句只作分析用，卡面文案必须由你重写',
        traits: Array.isArray(it.traits) ? it.traits.filter(Boolean).slice(0, 3) : [],
        must: Array.isArray(it.must) ? it.must.filter(Boolean).slice(0, 3) : [],
        avoid: Array.isArray(it.avoid) ? it.avoid.filter(Boolean).slice(0, 3) : [],
      });
    });
    console.log('[charts] 已归纳 ' + cards.length + ' 条主题（' + Math.min(b + BATCH, sliced.length) + '/' + sliced.length + ' 首）');
    if (typeof onProgress === 'function') {
      try { onProgress(cards.slice(), cards.length); } catch (e) { console.log('[charts] onProgress 异常：' + e.message); }
    }
  }
  return cards.length ? cards : null;
}

// 抓单份歌词文本（供上面的管道取用）
async function getText(url, timeout = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', Accept: '*/*' },
      signal: ctrl.signal,
    });
    if (!r.ok) return '';
    return await r.text();
  } catch {
    return '';
  } finally { clearTimeout(t); }
}

// 进程内互斥：同一时刻只跑一次「切」，后续请求直接复用进度（不重复打模型）。
// 每批归纳完就立刻并入 CHART_CACHE，前端靠轮询拿到增量。
let CHART_CUT_PENDING = null;
function chartCutOnce() {
  if (CHART_CUT_PENDING) {
    console.log('[charts] 已有「切」在跑，本次请求复用进度');
    return CHART_CUT_PENDING;
  }
  if (!CHART_RAW) {
    console.log('[charts] 尚无采集素材，无法「切」');
    return Promise.resolve(null);
  }
  const cutSig = CHART_RAW.sig;                 // 快照：本次「切」基于的素材签名
  const tracks = CHART_RAW.tracks.slice();      // 快照：避免采集定时器途中改写 CHART_RAW 造成错位
  const blank = () => ({ ts: Date.now(), items: [], source: '实时榜单·歌词蒸馏', running: true, total: 0, done: 0 });
  if (!CHART_CACHE || !CHART_CACHE.items) CHART_CACHE = blank();
  else CHART_CACHE.running = true;
  console.log('[charts] 开始「切」：对 ' + tracks.length + ' 首歌词做切片+金句+AI 归纳，约 1-1.6 小时');
  CHART_CUT_PENDING = sliceDistill(tracks, (batchCards, total) => {
    const cur = CHART_CACHE && CHART_CACHE.items ? CHART_CACHE : blank();
    // 去重：同一来源 + 同主题名只留一条（模型偶尔会为不同歌产出同名角度）
    const seen = new Set(cur.items.map((c) => c.source + '::' + c.theme));
    const fresh = batchCards.filter((c) => !seen.has(c.source + '::' + c.theme));
    CHART_CACHE = {
      ts: Date.now(),
      source: '实时榜单·歌词蒸馏',
      running: true,
      total,
      done: cur.done + fresh.length,
      items: cur.items.concat(fresh),
    };
    console.log('[charts] 进度 ' + CHART_CACHE.items.length + ' 条 / ' + total + ' 首');
  })
    .then((cards) => {
      if (CHART_CACHE) CHART_CACHE.running = false;
      // 只有真产出主题，才把这条签名记为「已切」，否则下次请求仍会重试
      if (cards && cards.length) CHART_LAST_CUT_SIG = cutSig;
      return cards;
    })
    .catch((e) => {
      console.log('[charts] 切 异常：' + e.message);
      if (CHART_CACHE && !CHART_CACHE.items.length) CHART_CACHE = null;
      else if (CHART_CACHE) CHART_CACHE.running = false;
      return null;
    })
    .finally(() => { CHART_CUT_PENDING = null; });
  return CHART_CUT_PENDING;
}

// 后台采集：冷启动首次访问时在后台拉取榜单与歌词原文，不阻塞首屏请求。
// 复用与 chartCutOnce 一致的 pending 互斥：同一时刻只跑一次，后续请求直接复用进度，由前端轮询追增量。
// 失败冷却 5 分钟：避免 meting 挂掉时每个 30s 轮询请求都重打一次把它刷爆；冷却期内返回 null，
// 上层（handleCharts）会让前端落到本地静态池兜底。
let CHART_COLLECT_PENDING = null;
let CHART_COLLECT_LAST_FAIL = 0;
function collectOnce(force) {
  if (CHART_COLLECT_PENDING) return CHART_COLLECT_PENDING;
  if (!force && CHART_RAW) return Promise.resolve(CHART_RAW);
  if (Date.now() - CHART_COLLECT_LAST_FAIL < 5 * 60 * 1000) return Promise.resolve(null);
  console.log('[charts] 后台采集榜单与歌词原文（不阻塞首屏）');
  CHART_COLLECT_PENDING = collectCharts()
    .then((raw) => {
      if (raw && raw.tracks.length) { CHART_RAW = raw; CHART_COLLECT_LAST_FAIL = 0; console.log('[charts] 采集完成 ' + raw.tracks.length + ' 首'); }
      else { CHART_COLLECT_LAST_FAIL = Date.now(); console.log('[charts] 采集无有效结果'); }
      return CHART_RAW;
    })
    .catch((e) => { CHART_COLLECT_LAST_FAIL = Date.now(); console.log('[charts] 采集异常：' + e.message); return null; })
    .finally(() => { CHART_COLLECT_PENDING = null; });
  return CHART_COLLECT_PENDING;
}

// 定时采集：只刷新素材（榜单 + 歌词原文），不触发「切」。素材常新，「切」按需触发。
// 首次在 CHART_REFRESH_MS 后触发，之后每 CHART_REFRESH_MS 循环一次。
function scheduleCollect() {
  if (CHART_COLLECT_TIMER) clearTimeout(CHART_COLLECT_TIMER);
  CHART_COLLECT_TIMER = setTimeout(async () => {
    CHART_COLLECT_TIMER = null;
    try {
      console.log('[charts] 定时采集：拉取最新榜单与歌词原文');
      // 复用 collectOnce 的 pending 互斥 + 失败冷却（force=true 跳过「已有 CHART_RAW 直接返回」守卫，
      // 保证每 12h 仍会重采）；若恰与冷启动采集并发，直接复用其 pending，避免两条 collectCharts 各自落盘
      // 不同 sig、进而各自把 hasNew 翻真、触发两轮「切」烧双倍 token（低概率 × 高成本，必须消掉）。
      const prevSig = CHART_RAW ? CHART_RAW.sig : '';
      const raw = await collectOnce(true);
      if (raw && raw.tracks && raw.tracks.length) {
        const isNew = raw.sig !== prevSig;
        console.log('[charts] 采集完成 ' + raw.tracks.length + ' 首' + (isNew ? '（内容有变化，待下次打开面板时按需触发切）' : '（内容与上次一致）'));
      }
    } catch (e) { console.log('[charts] 定时采集异常：' + e.message); }
    scheduleCollect();
  }, CHART_REFRESH_MS);
}

async function handleCharts(res) {
  const shape = () => ({
    ok: true,
    source: (CHART_CACHE && CHART_CACHE.source) || (CHART_COLLECT_PENDING ? '采集榜单中' : ''),
    cached: !!(CHART_CACHE && CHART_CACHE.items && CHART_CACHE.items.length),
    updatedAt: (CHART_CACHE && CHART_CACHE.ts) || null,
    running: !!(CHART_CACHE && CHART_CACHE.running) || !!CHART_COLLECT_PENDING,
    collecting: !!CHART_COLLECT_PENDING,
    total: (CHART_CACHE && CHART_CACHE.total) || 0,
    done: (CHART_CACHE && CHART_CACHE.done) || 0,
    collectedAt: (CHART_RAW && CHART_RAW.collectedAt) || null,
    hasNew: !!(CHART_RAW && CHART_RAW.sig !== CHART_LAST_CUT_SIG),
  });
  // 切 进行中：直接交回进度，前端轮询追增量，绝不重触发
  if (CHART_CACHE && CHART_CACHE.running) {
    const s = shape();
    return sendJSON(res, 200, Object.assign(s, { items: CHART_CACHE.items || [] }));
  }
  // 素材尚未采集 → 后台触发采集，立即返回 running（前端轮询追增量），不阻塞首屏请求。
  // 与「切」一样复用 pending 互斥：采集中的请求直接复用进度，不会并发重打 meting。
  if (!CHART_RAW) {
    collectOnce();
    const s = shape();
    s.cached = false;
    return sendJSON(res, 200, Object.assign(s, { items: (CHART_CACHE && CHART_CACHE.items) || [] }));
  }
  // 关键闸门：只有当素材签名与上次「切」不同（即检测到新抓取内容）才触发「切」；
  // 没新内容且已有主题池 → 直接返回，绝不重切、不空烧 token。
  const hasNew = CHART_RAW.sig !== CHART_LAST_CUT_SIG;
  if (!hasNew) {
    if (CHART_CACHE && CHART_CACHE.items && CHART_CACHE.items.length) {
      const s = shape();
      return sendJSON(res, 200, Object.assign(s, { items: CHART_CACHE.items }));
    }
    return fallbackCharts(res, shape);
  }
  // 有新内容 → 触发「切」（按需 + 新内容才切）。立即返回 running 状态，交前端轮询追增量，
  // 不再用 90 秒长轮询挂住请求：多客户端并发时避免堆积挂起连接，事件循环也更干净。
  chartCutOnce();
  const s = shape();
  s.cached = false;
  return sendJSON(res, 200, Object.assign(s, { items: (CHART_CACHE && CHART_CACHE.items) || [] }));
}

// 兜底：采集/切 都失败时的低质回退。直连网易云已多数为死链，跳过无谓的 9 秒超时尝试，
// 直接走本地静态热歌主题池（public/data/hot-themes.json），离线也不会让面板空。
async function fallbackCharts(res, shape) {
  const fb = loadJSON(path.join(PUBLIC, 'data', 'hot-themes.json'), {});
  const items = (fb && fb.items) || [];
  console.log('[charts] 走本地静态兜底池（' + items.length + ' 条）');
  return sendJSON(res, 200, { ok: true, source: 'local-cache', cached: false, updatedAt: null, items });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  try {
    // ---- API ----
    if (p === '/api/ai/status') {
      const cfg = loadArkConfig();
      const avail = await ollamaAvailable(cfg.ollamaBase);
      return sendJSON(res, 200, {
        provider: cfg.provider || (cfg.arkApiKey ? 'ark' : 'ollama'),
        ark: { configured: !!cfg.arkApiKey, model: cfg.arkModel, base: cfg.arkBase },
        ollama: { ok: avail.ok, models: avail.models },
      });
    }
    if (p === '/api/settings' && req.method === 'GET') {
      const cfg = loadArkConfig();
      return sendJSON(res, 200, {
        provider: cfg.provider,
        arkModel: cfg.arkModel,
        arkBase: cfg.arkBase,
        arkConfigured: !!cfg.arkApiKey,
        ollamaBase: cfg.ollamaBase,
      });
    }
    if (p === '/api/settings' && req.method === 'POST') {
      const raw = await readBody(req, res);
      let body; try { body = JSON.parse(raw); } catch { return sendJSON(res, 400, { ok: false, message: 'JSON 解析失败' }); }
      let file = {};
      try { file = JSON.parse(fs.readFileSync(ARK_CONFIG_FILE, 'utf8')); } catch {}
      if (body.provider) file.provider = body.provider;
      if (typeof body.arkModel === 'string') file.arkModel = body.arkModel.trim();
      if (typeof body.arkBase === 'string' && body.arkBase.trim()) file.arkBase = body.arkBase.trim();
      if (typeof body.ollamaBase === 'string' && body.ollamaBase.trim()) file.ollamaBase = body.ollamaBase.trim();
      if (typeof body.arkApiKey === 'string' && body.arkApiKey.trim()) file.arkApiKey = body.arkApiKey.trim();
      fs.writeFileSync(ARK_CONFIG_FILE, JSON.stringify(file, null, 2));
      return sendJSON(res, 200, { ok: true, arkConfigured: !!file.arkApiKey, provider: file.provider });
    }
    if (p === '/api/ai/suggest' && req.method === 'POST') {
      const raw = await readBody(req, res);
      let body; try { body = JSON.parse(raw); } catch { return sendJSON(res, 400, { ok: false, message: 'JSON 解析失败' }); }
      const out = await handleAiSuggest(body);
      return sendJSON(res, out.ok ? 200 : 200, out); // 前端按 ok 字段判断
    }
    if (p === '/api/songs' && req.method === 'GET') {
      let files = [];
      try { files = fs.readdirSync(DATA).filter((f) => f.endsWith('.json')); } catch {}
      const list = files.map((f) => {
        try {
          const j = JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
          return { id: f.replace(/\.json$/, ''), title: j.meta?.title || '未命名', updatedAt: j.updatedAt || '' };
        } catch { return null; }
      }).filter(Boolean).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
      return sendJSON(res, 200, { songs: list });
    }
    if (p.startsWith('/api/songs/') && req.method === 'GET') {
      const rawId = p.split('/').pop();
      const id = safeId(rawId);
      // 存档 id 落盘前已被 safeId 化（仅字母数字与 _-），若请求里的 id 被剥离成非法值或退化成 'song'，
      // 直接判未找到，避免误读/覆盖其它存档。
      if (!id || id !== rawId) return sendJSON(res, 404, { ok: false, message: '未找到' });
      const fp = path.join(DATA, id + '.json');
      if (!fs.existsSync(fp)) return sendJSON(res, 404, { ok: false, message: '未找到' });
      return sendJSON(res, 200, JSON.parse(fs.readFileSync(fp, 'utf8')));
    }
    if (p.startsWith('/api/songs/') && req.method === 'DELETE') {
      const rawId = p.split('/').pop();
      const id = safeId(rawId);
      if (!id || id !== rawId) return sendJSON(res, 404, { ok: false, message: '未找到' });
      const fp = path.join(DATA, id + '.json');
      if (!fs.existsSync(fp)) return sendJSON(res, 404, { ok: false, message: '未找到' });
      try {
        fs.unlinkSync(fp);
      } catch (e) {
        // 某些环境下 unlink 被安全钩子拦截/兜底；只要文件已不存在即视为删除成功
        if (fs.existsSync(fp)) return sendJSON(res, 500, { ok: false, message: '删除失败：' + e.message });
      }
      return sendJSON(res, 200, { ok: true });
    }
    if (p === '/api/songs' && req.method === 'POST') {
      const raw = await readBody(req, res);
      let body; try { body = JSON.parse(raw); } catch { return sendJSON(res, 400, { ok: false, message: 'JSON 解析失败' }); }
      const id = safeId(body.id) || ('song_' + Date.now());
      const fp = path.join(DATA, id + '.json');
      fs.writeFileSync(fp, JSON.stringify({ ...body, id, updatedAt: new Date().toISOString() }, null, 2));
      return sendJSON(res, 200, { ok: true, id });
    }

    if (p === '/api/lyricists' && req.method === 'GET') {
      const list = Object.keys(LYRICISTS).map((name) => ({ name }));
      return sendJSON(res, 200, { ok: true, lyricists: list });
    }
    if (p === '/api/lexicon' && req.method === 'GET') {
      return sendJSON(res, 200, loadJSON(path.join(DATA, 'lexicon.json'), {}));
    }
    if (p === '/api/lyricists' && req.method === 'POST') {
      const raw = await readBody(req, res);
      let body; try { body = JSON.parse(raw); } catch { return sendJSON(res, 400, { ok: false, message: 'JSON 解析失败' }); }
      const name = (body.name || '').trim();
      if (!name) return sendJSON(res, 400, { ok: false, message: '词人名不能为空' });
      const entry = {
        profile: String(body.profile || ''),
        themes: Array.isArray(body.themes) ? body.themes.map(String) : [],
        devices: Array.isArray(body.devices) ? body.devices.map(String) : [],
        examples: Array.isArray(body.examples) ? body.examples.map(String).filter(Boolean) : [],
        lyrics: Array.isArray(body.lyrics) ? body.lyrics.map(String).filter(Boolean) : [],
        custom: true,
      };
      LYRICISTS[name] = entry; // 内存即时生效，无需重启
      const all = loadJSON(LYRICISTS_CUSTOM_FILE, {});
      all[name] = entry;
      try { fs.writeFileSync(LYRICISTS_CUSTOM_FILE, JSON.stringify(all, null, 2)); }
      catch (e) { return sendJSON(res, 500, { ok: false, message: '保存自定义词人失败：' + e.message }); }
      return sendJSON(res, 200, { ok: true, name, lyricists: Object.keys(LYRICISTS).map((n) => ({ name: n })) });
    }
    if (p === '/api/ai/distill' && req.method === 'POST') {
      const raw = await readBody(req, res);
      let body; try { body = JSON.parse(raw); } catch { return sendJSON(res, 400, { ok: false, message: 'JSON 解析失败' }); }
      const name = (body.name || '').trim();
      if (!name) return sendJSON(res, 400, { ok: false, message: '词人名不能为空' });
      const cfg = loadArkConfig();
      if (!cfg.arkApiKey) return sendJSON(res, 200, { ok: false, code: 'ark_no_key', message: '未配置火山 API Key，无法现场蒸馏。请在设置中填写。' });
      const samples = Array.isArray(body.samples) ? body.samples.map(String).filter(Boolean).slice(0, 20) : [];
      const sampleText = samples.length
        ? '以下是【' + name + '】的部分歌词样本（每行一句）：\n' + samples.join('\n') + '\n'
        : '（未提供歌词样本，请基于你对该作词人的了解进行分析）\n';
      const prompt = '你是华语流行歌词风格分析师。请分析作词人【' + name + '】的创作风格。\n' + sampleText +
        '只输出一个 JSON 对象，不要任何解释、不要 ```json 标记、不要 Markdown：\n' +
        '{\n  "profile": "风格指纹：意象系统、措辞、隐喻、结构、韵式，一段话",\n' +
        '  "themes": ["主题词1","主题词2","主题词3"],\n' +
        '  "devices": ["标志性手法1","标志性手法2"],\n' +
        '  "examples": ["原创仿写的风格例句1","原创仿写的风格例句2","原创仿写的风格例句3"],\n' +
        '  "lyrics": ["从给定样本里挑选的最具代表性的原句1","原句2","原句3"]\n}\n' +
        '要求：examples 必须是你原创仿写、不要照抄任何真实歌词；lyrics 只能从给定样本里挑选，若未提供样本则 lyrics 为空数组 []。';
      const out = await arkSuggest(prompt, cfg.arkModel, cfg);
      if (!out.ok) return sendJSON(res, 200, out);
      const data = parseAILyricistJSON(out.text);
      if (!data) return sendJSON(res, 200, { ok: false, code: 'parse', message: 'AI 返回的蒸馏结果解析失败', raw: String(out.text).slice(0, 500) });
      return sendJSON(res, 200, { ok: true, name, data });
    }

    // 透出创作规则（含 breath 气口节），供前端按曲风取气口预算做运行时检测
    if (p === '/api/rules' && req.method === 'GET') {
      return sendJSON(res, 200, { ok: true, rules: RULES });
    }

    // 实时榜单灵感：抓当前热歌榜 → 蒸馏成「词风 / 主题」灵感池（10 分钟缓存，离线兜底本地静态池）
    if (p === '/api/charts' && req.method === 'GET') {
      return await handleCharts(res);
    }

    // ---- 静态文件 ----
    let rel = p === '/' ? '/index.html' : p;
    const fp = path.join(PUBLIC, path.normalize(rel));
    // 严格边界：必须正好是 PUBLIC 本身，或以 PUBLIC + 路径分隔符开头，避免 /app/public-evil 这类前缀穿透
    if (fp !== PUBLIC && !fp.startsWith(PUBLIC + path.sep)) return sendJSON(res, 403, { ok: false, message: 'forbidden' });
    if (!fs.existsSync(fp) || !fs.statSync(fp).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Not Found');
    }
    const ext = path.extname(fp);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(fp).pipe(res);
  } catch (e) {
    // readBody 可能已直接写出 413 响应，此处若再写一次会触发 ERR_HTTP_HEADERS_SENT
    if (res.headersSent) return;
    const code = (e && e.statusCode) || 500;
    sendJSON(res, code, { ok: false, message: String(e && e.message || e) });
  }
});

server.listen(PORT, () => {
  try { fs.mkdirSync(DATA, { recursive: true }); } catch {}
  const cfg = loadArkConfig();
  console.log(`lyric-studio 已启动: http://localhost:${PORT}`);
  console.log(`词稿存档目录: ${DATA}`);
  console.log(`默认 AI 提供方: ${cfg.provider}${cfg.provider === 'ark' ? (cfg.arkApiKey ? '（已配置 Key）' : '（未配置 Key，请在设置中填写）') : '（Ollama: ' + cfg.ollamaBase + '）'}`);
  scheduleCollect();  // 启动定时采集（只刷新素材；「切」按需触发，不在此盲跑）
});
