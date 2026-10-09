// lyric-studio 前端逻辑（逐行编辑 · 逐行标注 · 演唱者匹配）
(function () {
  'use strict';

  const BLOCK_TYPES = [
    { v: 'verse', label: '主歌' },
    { v: 'chorus', label: '副歌' },
    { v: 'bridge', label: '桥段' },
    { v: 'pre', label: '导歌' },
    { v: 'intro', label: '前奏' },
    { v: 'inter', label: '间奏' },
    { v: 'outro', label: '尾奏' },
  ];
  const LS_KEY = 'lyric-studio:current';

  // 名作词家的「风格蒸馏」：从服务端 /api/lyricists 动态加载（内置库 + 用户自定义库），按中文名索引
  let STYLES = { none: { name: '', desc: '' } };
  // 具体演唱者（不再是男高音/女高音这种抽象分类）。style 指向该歌手最常合作的词人（中文名，用于联动）
  const SINGERS = [
    { v: 'zhoujielun', name: '周杰伦', gender: '男声', register: '中音', timbre: '清亮·说唱', style: '方文山' },
    { v: 'linjunjie', name: '林俊杰', gender: '男声', register: '高音', timbre: '清亮·转音', style: '易家扬' },
    { v: 'chenyixun', name: '陈奕迅', gender: '男声', register: '中音', timbre: '醇厚·叙事', style: '林夕' },
    { v: 'zhangxinzhe', name: '张信哲', gender: '男声', register: '高音', timbre: '清澈情歌', style: '李宗盛' },
    { v: 'lironghao', name: '李荣浩', gender: '男声', register: '中低音', timbre: '低沉·urban' },
    { v: 'maobuyi', name: '毛不易', gender: '男声', register: '中音', timbre: '温厚·叙事', style: '唐恬' },
    { v: 'xuwei', name: '许巍', gender: '男声', register: '中音', timbre: '沧桑·摇滚诗人', style: '许巍' },
    { v: 'lizong', name: '李宗盛', gender: '男声', register: '中低音', timbre: '老男人·叙事', style: '李宗盛' },
    { v: 'zhoushen', name: '周深', gender: '男声', register: '高音', timbre: '天籁·空灵', style: '唐恬' },
    { v: 'xuezhijian', name: '薛之谦', gender: '男声', register: '中音', timbre: '苦情·戏谑' },
    { v: 'mayday', name: '五月天', gender: '组合', register: '中音', timbre: '热血·摇滚' },
    { v: 'dengziqi', name: '邓紫棋', gender: '女声', register: '高音', timbre: '力量·转音' },
    { v: 'wangfei', name: '王菲', gender: '女声', register: '高音', timbre: '空灵·气声', style: '林夕' },
    { v: 'yangqianhua', name: '杨千嬅', gender: '女声', register: '中音', timbre: '市井·情感', style: '黄伟文' },
    { v: 'mowenwei', name: '莫文蔚', gender: '女声', register: '中音', timbre: '慵懒·爵士', style: '李宗盛' },
    { v: 'zhanghuiwei', name: '张惠妹', gender: '女声', register: '中高音', timbre: '爆发·情感' },
    { v: 'sunyanzi', name: '孙燕姿', gender: '女声', register: '中高音', timbre: '清亮·轻盈' },
    { v: 'liyuchun', name: '李宇春', gender: '女声', register: '中音', timbre: '中性·帅气', style: '唐恬' },
    { v: 'zhangliangying', name: '张靓颖', gender: '女声', register: '高音', timbre: '海豚音·力量', style: '易家扬' },
    { v: 'tianfuhen', name: '田馥甄', gender: '女声', register: '中高音', timbre: '清冷·细腻', style: '林夕' },
    { v: 'caiyilin', name: '蔡依林', gender: '女声', register: '中高音', timbre: '舞曲·咬字', style: '黄伟文' },
    { v: 'custom', name: '自定义演唱者…', gender: '', register: '', timbre: '', style: '' },
  ];
  // 曲风（流派）与语种：写词时连同「写词人」一起注入 AI 提示词，决定押韵体系与行文逻辑
  const GENRES = { '': '流行', rap: '说唱 / Rap', folk: '民谣', ancient: '古风', rock: '摇滚' };
  const LANGS = { zh: '中文', en: '英语', ja: '日语', ko: '韩语', es: '西班牙语', bilingual: '中英双语' };

  let currentStyle = 'none';
  let currentProvider = 'ark';
  let arkReady = false;
  let state = newDoc();
  let saveTimer = null;
  let lastFocusedInput = null; // 词库插入用的当前聚焦输入框

  function stylePayload() {
    const s = STYLES[currentStyle];
    return (s && s.name) ? { name: s.name, desc: s.desc || '' } : null;
  }
  // 当前曲风 / 语种 / 能量硬度（写词时注入 AI 提示词）
  function currentGenre() { const s = $('#ai-genre'); return (s && s.value) || ''; }
  function currentLang() { const s = $('#ai-lang'); return (s && s.value) || 'zh'; }
  function currentEnergy() { const s = $('#ai-energy'); return (s && s.value) || ''; }
  // 是否中文系语种（中文或中英双语）：决定前端是否显示十三辙韵脚
  function isHanLang() { const l = currentLang(); return l === 'zh' || l === 'bilingual'; }
  // 从服务端拉取词人列表（内置库 + 自定义库），动态填充风格下拉
  async function loadStyles() {
    try {
      const r = await fetch('/api/lyricists');
      const j = await r.json();
      const map = { none: { name: '', desc: '' } };
      (j.lyricists || []).forEach((x) => { if (x && x.name) map[x.name] = { name: x.name, desc: '' }; });
      STYLES = map;
      renderStyleOptions();
    } catch (e) { /* 拉取失败则保留 none，不影响正常使用 */ }
  }
  function renderStyleOptions() {
    const sel = $('#ai-style');
    if (!sel) return;
    sel.innerHTML = '';
    Object.values(STYLES).forEach((v) => {
      const o = el('option'); o.value = v.name || 'none'; o.textContent = v.name || '原声 / 自由';
      sel.appendChild(o);
    });
    if (!STYLES[currentStyle]) currentStyle = 'none';
    sel.value = (currentStyle && STYLES[currentStyle]) ? currentStyle : 'none';
  }
  // 自定义词人：填名字 + 选填歌词样本 → AI 现场蒸馏 → 存库
  function openCustomLyricist() {
    // 从信息弹窗内打开时，先隐藏信息弹窗，避免两个 modal 叠加导致点击被遮挡
    const infoM = $('#info-modal'); if (infoM) infoM.classList.add('hidden');
    const body = $('#modal-body'); $('#modal-title').textContent = '自定义词人 · AI 现场蒸馏';
    body.innerHTML = '';
    const tip = el('div', 'sel-style'); tip.textContent = '填词人名（如「陈镇川」），可贴几句你喜欢的 TA 的歌词，让 AI 现场总结风格指纹；也可不贴，由 AI 基于认知总结。确认后存入语料库，以后写词在「写词人」里直接选。';
    const rowName = el('label', 'sel-label'); rowName.textContent = '词人名';
    const inpName = el('input', 'sel-note'); inpName.placeholder = '如 陈镇川';
    const rowSamp = el('label', 'sel-label'); rowSamp.textContent = '歌词样本（选填，每行一句）';
    const taSamp = el('textarea', 'sel-note'); taSamp.placeholder = '贴几句你喜欢的 TA 的歌词，每行一句…';
    const bDistill = el('button', 'primary', 'AI 现场蒸馏');
    const preview = el('div', 'sel-preview'); preview.style.display = 'none';
    const actions = el('div', 'sel-actions');
    const bSave = el('button', 'primary', '保存到语料库'); bSave.style.display = 'none';
    const cancel = el('button', null, '取消'); cancel.addEventListener('click', () => $('#modal').classList.add('hidden'));
    actions.append(bSave, cancel);
    body.append(tip, rowName, inpName, rowSamp, taSamp, bDistill, preview, actions);
    $('#modal').classList.remove('hidden');

    let distilled = null;
    bDistill.addEventListener('click', async () => {
      const name = inpName.value.trim();
      if (!name) { inpName.focus(); toast('请先填词人名', 'err'); return; }
      const samples = taSamp.value.split('\n').map((s) => s.trim()).filter(Boolean);
      bDistill.disabled = true; bDistill.textContent = '蒸馏中…'; toast('AI 正在现场蒸馏「' + name + '」的风格…');
      try {
        const r = await fetch('/api/ai/distill', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, samples }) });
        const j = await r.json();
        if (j.ok && j.data) {
          distilled = j.data;
          preview.style.display = '';
          preview.innerHTML = '<div class="sel-label">AI 提炼的风格指纹（可改）</div>' +
            '<textarea id="cl-profile" class="sel-note" style="min-height:70px">' + esc(distilled.profile || '') + '</textarea>' +
            '<div class="sel-label">原创仿写例句（每行一句，可改）</div>' +
            '<textarea id="cl-examples" class="sel-note">' + esc((distilled.examples || []).join('\n')) + '</textarea>' +
            '<div class="sel-label">真实代表句（每行一句，可改；未提供样本则留空）</div>' +
            '<textarea id="cl-lyrics" class="sel-note">' + esc((distilled.lyrics || []).join('\n')) + '</textarea>';
          bSave.style.display = '';
          toast('蒸馏完成，可调整后保存', 'ok');
        } else { toast(j.message || '蒸馏失败', 'err'); }
      } catch (e) { toast('蒸馏请求失败：' + e.message, 'err'); }
      finally { bDistill.disabled = false; bDistill.textContent = 'AI 现场蒸馏'; }
    });

    bSave.addEventListener('click', async () => {
      if (!distilled) return;
      const name = inpName.value.trim();
      const payload = {
        name,
        profile: $('#cl-profile') ? $('#cl-profile').value.trim() : '',
        themes: (distilled.themes || []),
        devices: (distilled.devices || []),
        examples: ($('#cl-examples') ? $('#cl-examples').value : '').split('\n').map((s) => s.trim()).filter(Boolean),
        lyrics: ($('#cl-lyrics') ? $('#cl-lyrics').value : '').split('\n').map((s) => s.trim()).filter(Boolean),
      };
      if (!payload.profile) { toast('风格指纹不能为空', 'err'); return; }
      bSave.disabled = true; bSave.textContent = '保存中…';
      try {
        const r = await fetch('/api/lyricists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const j = await r.json();
        if (j.ok) { await loadStyles(); $('#modal').classList.add('hidden'); toast('已保存词人「' + name + '」，写词时可在「写词人」里直接选', 'ok'); }
        else toast(j.message || '保存失败', 'err');
      } catch (e) { toast('保存失败：' + e.message, 'err'); }
      finally { bSave.disabled = false; bSave.textContent = '保存到语料库'; }
    });
  }
  function singerPayload() {
    const s = state.meta.singer || {};
    if (!s.gender && !s.register && !s.timbre && !s.name) return null;
    return { name: s.name || '', gender: s.gender || '', register: s.register || '', timbre: s.timbre || '' };
  }
  function singerHint() {
    const s = state.meta.singer || {};
    const parts = [];
    if (s.gender) parts.push(s.gender);
    if (s.register) parts.push(s.register);
    if (s.timbre) parts.push(s.timbre);
    return (s.name ? s.name : '') + (parts.length ? '（' + parts.join('·') + '）' : '');
  }
  // 当前演唱者匹配到 SINGERS 中的哪一项（按歌手名匹配）
  function singerMatchKey() {
    const s = state.meta.singer || {};
    const hit = SINGERS.find((p) => p.name === s.name && p.v !== 'custom');
    return hit ? hit.v : 'custom';
  }
  function syncSingerSelect() { const sel = $('#ai-singer'); if (sel) sel.value = singerMatchKey(); }
  // 应用某个具体歌手：把其声部/音色属性写入 meta，并刷新下拉
  function applySinger(v) {
    const p = SINGERS.find((x) => x.v === v);
    if (!p) return;
    state.meta.singer.name = p.name;
    state.meta.singer.gender = p.gender;
    state.meta.singer.register = p.register;
    state.meta.singer.timbre = p.timbre;
    scheduleSave();
    syncSingerSelect();
  }

  // ---------- 工具 ----------
  function $(sel, root) { return (root || document).querySelector(sel); }
  function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function uid() { return 'b' + Math.random().toString(36).slice(2, 9); }
  function esc(s) { return (s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function newDoc() {
    return {
      id: null,
      meta: { title: '', author: '', key: '', bpm: '', genre: '', mood: '', theme: '', language: 'zh', energy: '', brief: { story: '', must: '', avoid: '', tone: '' }, singer: { gender: '', register: '', timbre: '', name: '' } },
      blocks: [{ id: uid(), type: 'verse', name: '', lines: [{ text: '', note: '' }] }],
    };
  }
  function typeLabel(v) { const t = BLOCK_TYPES.find((x) => x.v === v); return t ? t.label : v; }
  function findBlock(id) { return state.blocks.find((b) => b.id === id); }

  function toast(msg, kind) {
    let t = $('#toast');
    if (!t) { t = el('div', 'toast'); t.id = 'toast'; document.body.appendChild(t); }
    t.textContent = msg; t.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(t._timer); t._timer = setTimeout(() => { t.className = 'toast'; }, 3200);
  }

  // ---------- 自动保存 ----------
  function scheduleSave() {
    $('#save-flag') && ($('#save-flag').textContent = '编辑中…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(state));
        const now = new Date();
        $('#save-flag') && ($('#save-flag').textContent = '已自动保存 ' + now.toLocaleTimeString('zh-CN', { hour12: false }));
      } catch (e) { /* ignore */ }
    }, 800);
  }

  // ---------- 韵律分析（附在每行下） ----------
  function renderLineAnalysis(box, text) {
    const han = isHanLang();
    const showRhyme = $('#tg-rhyme').checked && han;
    const showPingze = $('#tg-pingze').checked && han;
    const showRhythm = $('#tg-rhythm') && $('#tg-rhythm').checked && han;
    const showMelody = $('#tg-melody') && $('#tg-melody').checked && han;
    const cnt = lineCount(text);
    const hasCount = (text || '').trim().length > 0;
    const overCls = han && cnt > 16 ? 'over' : '';
    const cntLabel = han ? `${cnt} 字` : `${cnt} 字符`;
    const prefix = hasCount ? `<span class="line-meter ${overCls}">${cntLabel}${han && cnt > 16 ? ' · 偏长' : ''}</span>` : '';
    if (!showRhyme && !showPingze && !showRhythm && !showMelody) {
      if (!hasCount) { box.style.display = 'none'; box.innerHTML = ''; return; }
      box.style.display = ''; box.innerHTML = prefix; return;
    }
    box.style.display = '';
    const line = (text || '').trim();
    if (!line) { box.innerHTML = prefix; return; }
    if (!window.Pinyin || !window.Pinyin.analyzeLine) { box.innerHTML = prefix + '<span class="rh"><span class="py">拼音数据未加载</span></span>'; return; }
    const a = window.Pinyin.analyzeLine(line);
    let html = '';
    if (showRhyme) {
      const r = a.rhyme;
      const color = window.Pinyin.rhymeColor(r.final);
      const py = r.py ? r.py.replace(/[0-9]$/, '') : '—';
      html += `<span class="rh"><span class="dot" style="background:${color}"></span><span class="py">${esc(py)}</span>${r.zhe ? `<span class="zhe">${esc(r.zhe)}</span>` : ''}</span>`;
      const info = lineRhymeInfo(line);
      if (info.level === '三押') html += '<span class="rh-multi tri">三押</span>';
      else if (info.level === '双押') html += '<span class="rh-multi dbl">双押</span>';
      if (info.inner) html += '<span class="rh-multi inner">内韵</span>';
      if (r.zhe) { const near = nearZhe(r.zhe); if (near.length) html += `<span class="rh-near">近韵 ${near.map(esc).join('·')}</span>`; }
    }
    if (showPingze) {
      let cs = '';
      for (const c of a.chars) {
        if (c.punct) { cs += `<span class="pc punct">${esc(c.ch)}</span>`; continue; }
        const t = c.tone === 1 ? '平' : c.tone === 2 ? '仄' : '轻';
        const cls = c.tone === 1 ? 'ping' : c.tone === 2 ? 'ze' : 'qing';
        cs += `<span class="pc ${cls}">${esc(c.ch)}<i>${t}</i></span>`;
      }
      html += `<span class="pz">${cs}</span>`;
    }
    if (showRhythm) {
      const rb = renderRhythm(text);
      if (rb) html += `<span class="rhythm">${rb}</span>`;
    }
    if (showMelody) {
      const mb = renderMelody(text);
      if (mb) html += `<span class="melody">${mb}</span>`;
    }
    box.innerHTML = prefix + html;
  }

  // 一行字数（非标点字符数，用于可唱性提醒）
  function lineCount(text) {
    const a = window.Pinyin.analyzeLine(text || '');
    return a.chars.filter((c) => !c.punct).length;
  }

  // 多押 / 内韵检测：按十三辙（同辙即视为同韵，兼容 ai/uai 等）
  function lineRhymeInfo(text) {
    const a = window.Pinyin.analyzeLine(text || '');
    const fin = a.chars.filter((c) => !c.punct && c.py).map((c) => window.Pinyin.getFinal(c.py)).filter(Boolean);
    if (!fin.length) return { level: '', inner: false };
    const zz = (f) => { const z = window.Pinyin.getZhe(f); return (z && z !== '其他') ? z : ''; };
    const z = fin.map(zz);
    let level = '单押';
    if (fin.length >= 3 && z[fin.length - 1] && z[fin.length - 1] === z[fin.length - 2] && z[fin.length - 2] === z[fin.length - 3]) level = '三押';
    else if (fin.length >= 2 && z[fin.length - 1] && z[fin.length - 1] === z[fin.length - 2]) level = '双押';
    const restZ = z.slice(0, -1).filter(Boolean);
    const inner = restZ.length >= 2 && restZ.some((x, i) => restZ.indexOf(x) !== i);
    return { level, inner };
  }

  // 近韵 / 宽韵：十三辙相邻映射（口型/收尾相近者视为近韵，提示用、非强制）
  const NEAR_ZHE = {
    发花: ['怀来', '遥条'], 怀来: ['发花', '灰堆'], 遥条: ['发花', '由求'],
    言前: ['人辰'], 人辰: ['言前'],
    江阳: ['中东'], 中东: ['江阳'],
    梭波: ['由求'], 由求: ['遥条', '姑苏', '梭波'], 姑苏: ['由求'],
    衣期: ['灰堆', '乜斜'], 灰堆: ['怀来', '衣期'], 乜斜: ['衣期'],
  };
  function nearZhe(zhe) { return (zhe && NEAR_ZHE[zhe]) ? NEAR_ZHE[zhe].filter(Boolean) : []; }

  // 情绪 → 推荐十三辙（功能⑤）：开口度/共鸣方向匹配情绪。仅作写词建议，非强制、不改 AI 严格押韵规则
  const MOOD_ZHE = {
    豪迈: ['江阳', '发花', '中东'],
    忧伤: ['遥条', '由求', '怀来'],
    温柔: ['怀来', '灰堆', '衣期'],
    思念: ['由求', '遥条', '姑苏'],
    坚定: ['江阳', '中东', '发花'],
    欢快: ['发花', '怀来', '江阳'],
    孤寂: ['姑苏', '乜斜', '遥条'],
    热血: ['江阳', '中东', '发花'],
    励志: ['江阳', '中东', '发花'],
  };

  // 节奏 / 呼吸分析（功能⑥）：以平仄作轻重代理标记落拍，并按曲风预算检测气口（换气点）
  // 说明：中文无词汇重音，这里用「仄声=重拍/落点、平声=轻」作演唱轻重代理，仅供呼吸与断句参考
  function renderRhythm(text) {
    if (!window.Pinyin || !window.Pinyin.analyzeLine) return '';
    const chars = window.Pinyin.analyzeLine(text || '').chars;
    let strip = '';
    for (const c of chars) {
      if (c.punct) { strip += '<i class="rc qing">|</i>'; continue; } // 标点处即气口位置（| 标记）
      if (c.tone === 2) strip += '<i class="rc ze">重</i>';
      else if (c.tone === 1) strip += '<i class="rc ping">轻</i>';
      else strip += '<i class="rc qing">·</i>';
    }
    // 气口 / 呼吸检测：预算按曲风浮动（来源 rules.json.breath.genreBudget，经 /api/rules 加载）
    const budget = (RULES && RULES.breath && RULES.breath.genreBudget)
      ? (RULES.breath.genreBudget[currentGenre()] || RULES.breath.genreBudget[''] || 12)
      : 12;
    let buf = 0; const runs = [];
    for (const c of chars) {
      if (c.punct) { if (buf > 0) runs.push({ n: buf, end: 'punct' }); buf = 0; }
      else buf++;
    }
    if (buf > 0) runs.push({ n: buf, end: 'line' });
    const warns = [];
    runs.forEach((s, i) => {
      if (s.n > budget) {
        if (s.end === 'line') warns.push(`句末无气口·${s.n}字超预算${budget}·建议句内加『/』或逗号偷气`);
        else warns.push(`第${i + 1}段${s.n}字超预算${budget}·需在词组间隙偷气`);
      }
    });
    // 拖长音提示：尾字为拖腔字且本句偏长无气口 → 其前一句需留大换气
    const tail = (text.match(/[啊呀哇呐哦啦哎哟~～—]$/u) || [])[0];
    if (tail && runs.some((s) => s.n > budget)) warns.push(`尾字『${tail}』拖长音·其前一句需留大换气`);
    // 节奏网格：字/拍 → 建议拍数/小节数（与 server 端提示词口径一致）
    const m = state.meta || {};
    const meter = (m.meter || (RULES && RULES.rhythm && RULES.rhythm.meter) || '4/4');
    const beatsPerBar = parseInt(String(meter).split('/')[0], 10) || 4;
    const cpbMap = (RULES && RULES.rhythm && RULES.rhythm.charPerBeat) || { '': 1 };
    const cpb = (cpbMap[currentGenre()] != null) ? cpbMap[currentGenre()] : (cpbMap[''] != null ? cpbMap[''] : 1);
    const hanN = chars.filter((c) => !c.punct).length;
    const beats = Math.max(1, Math.round(hanN * cpb));
    const bars = Math.max(1, Math.ceil(beats / beatsPerBar));
    const barInfo = `<span class="rh-bar">≈ ${beats} 拍 / ${bars} 小节</span>`;
    const warn = warns.length ? '<span class="rh-warn">⚠ 气口：' + warns.join('；') + '</span>' : '';
    const gR = currentGenre();
    const note = (gR === 'rap' || gR === 'rock')
      ? '<span class="rh-note">重=仄声落拍·轻=平声（平仄代理）；' + (GENRES[gR] || '该') + ' 以 flow/切分/反拍重音为律动核心，重音落核心实词即可、不必字字落正拍；气口预算按曲风' + budget + '字；字/拍 ' + cpb + '、拍号 ' + meter + '</span>'
      : '<span class="rh-note">重=仄声落拍·轻=平声（平仄代理）；强拍落核心实词、允许 off-beat 点缀避免念经感；气口预算按曲风' + budget + '字；字/拍 ' + cpb + '、拍号 ' + meter + '</span>';
    return barInfo + strip + warn + note;
  }

  // 旋律标记（依字行腔）：用字声调(四声)推断旋律轮廓走向，并检测『倒字』风险
  // 说明：pinyin.js 的 tone 已折叠为 平(1)/仄(2)/轻(3)，但原始四声数字藏在 py 末尾（如 'yang2'），
  // 这里解析 py 取真实 1-4 声映射到旋律走向箭头：阴平→平、阳平↗、上声∨、去声↘。这是真正的旋律相关维度。
  function renderMelody(text) {
    if (!window.Pinyin || !window.Pinyin.analyzeLine) return '';
    const chars = window.Pinyin.analyzeLine(text || '').chars;
    const arrow = { 1: '→', 2: '↗', 3: '∨', 4: '↘', 0: '·' };
    const cls = { 1: 'm1', 2: 'm2', 3: 'm3', 4: 'm4', 0: 'm0' };
    let strip = '';
    const risks = [];
    let prevTone = 0;
    for (const c of chars) {
      if (c.punct) { strip += '<i class="mc qing">|</i>'; prevTone = 0; continue; }
      const raw = c.py ? parseInt(String(c.py).slice(-1), 10) : 0;
      const t = (raw >= 1 && raw <= 4) ? raw : 0;
      strip += `<i class="mc ${cls[t]}">${arrow[t]}</i>`;
      // 倒字风险：去声(4) 后紧跟 阴平/阳平(1/2)，若旋律上行则去声被唱成上扬=倒字
      if (prevTone === 4 && (t === 1 || t === 2)) risks.push(c.ch);
      prevTone = t;
    }
    // 曲风门控：rap/rock 以 flow/律动优先，依字行腔非硬约束 → 不报倒字（仅保留旋律走向箭头作参考）
    const gMel = currentGenre();
    const daoziSoft = (gMel === 'rap' || gMel === 'rock');
    const warn = (!daoziSoft && risks.length) ? '<span class="rh-warn">⚠ 倒字风险：去声后接『' + risks.join('、') + '』，旋律若上行会唱歪，建议去声字配下行或该处改旋律走向</span>' : '';
    const note = daoziSoft
      ? '<span class="rh-note">箭头=依字行腔旋律走向（→平 ↗上扬 ∨降升 ↘下行）；' + (GENRES[gMel] || '该') + ' 曲风以 flow/律动优先，倒字非硬约束</span>'
      : '<span class="rh-note">箭头=依字行腔旋律走向（→平 ↗上扬 ∨降升 ↘下行）；基于字声调，非真实音高；古风/民谣/抒情建议避免明显倒字</span>';
    return strip + warn + note;
  }

  // 顶部情感弧线（按各段 energy 画曲线）
  function renderArc() {
    const arc = $('#arc'); if (!arc) return;
    const blocks = state.blocks;
    if (!blocks.length) { arc.innerHTML = ''; return; }
    const W = 820, H = 70, padX = 26, padY = 16;
    const n = blocks.length;
    const pts = blocks.map((b, i) => {
      const x = n === 1 ? W / 2 : padX + (W - 2 * padX) * i / (n - 1);
      const e = (b.energy == null ? 5 : b.energy);
      const y = H - padY - (H - 2 * padY) * (e - 1) / 9;
      return { x, y, e, label: typeLabel(b.type) };
    });
    const poly = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    let svg = `<svg viewBox="0 0 ${W} ${H}" class="arc-svg" preserveAspectRatio="none">`;
    svg += `<polyline points="${poly}" class="arc-line"/>`;
    pts.forEach((p) => {
      svg += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4.5" class="arc-dot"/>`;
      svg += `<text x="${p.x.toFixed(1)}" y="${H - 3}" class="arc-lbl">${esc(p.label)}</text>`;
    });
    svg += '</svg>';
    arc.innerHTML = svg;
  }

  function updateStats() {
    let chars = 0, lines = 0, maxLines = 0;
    const rhymeCount = {};
    for (const b of state.blocks) {
      const bl = b.lines.filter((x) => (x.text || '').trim()).length;
      if (bl > maxLines) maxLines = bl;
      for (const ln of b.lines) {
        const t = (ln.text || '').trim();
        if (!t) continue;
        lines++;
        const a = window.Pinyin.analyzeLine(t);
        for (const c of a.chars) if (!c.punct) chars++;
        if (a.rhyme.final) rhymeCount[a.rhyme.final] = (rhymeCount[a.rhyme.final] || 0) + 1;
      }
    }
    const top = Object.entries(rhymeCount).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k}×${v}`).join('，') || '—';
    const dataOk = window.Pinyin && window.Pinyin.hasData ? '' : ' <span style="color:var(--err)">（拼音未加载）</span>';
    const sunoCls = chars > 400 ? 'var(--err)' : (chars > 0 && chars < 60 ? 'var(--muted)' : 'var(--ok)');
    const sunoHint = chars > 400 ? '偏多·赶拍风险' : (chars > 0 && chars < 60 ? '偏少·易循环' : '适配');
    const lenCls = maxLines > 10 ? 'var(--err)' : 'var(--muted)';
    const lenHint = maxLines > 10 ? `最长段 ${maxLines}行·建议拆分` : `最长段 ${maxLines}行`;
    $('#stats').innerHTML = `段落 <b>${state.blocks.length}</b> · 句数 <b>${lines}</b> · 字数 <b>${chars}</b> · 韵脚 ${top} · <span style="color:${sunoCls}">Suno ${chars}字·${sunoHint}</span> · <span style="color:${lenCls}">${lenHint}</span>${dataOk}`;
  }

  // ---------- 渲染 ----------
  function renderAll() {
    const root = $('#blocks');
    root.innerHTML = '';
    syncReqBadge();
    state.blocks.forEach((b) => root.appendChild(buildBlock(b)));
    $('#meta-title').value = state.meta.title || '';
    syncSingerSelect();
    updateStats();
    renderArc();
  }

  function buildBlock(b) {
    const wrap = el('div', 'block'); wrap.dataset.id = b.id;
    const head = el('div', 'block-head');
    const sel = el('select', 'block-type');
    BLOCK_TYPES.forEach((t) => { const o = el('option'); o.value = t.v; o.textContent = t.label; sel.appendChild(o); });
    sel.value = b.type;
    sel.addEventListener('change', () => { b.type = sel.value; scheduleSave(); });
    const name = el('input', 'block-name'); name.placeholder = '段落名（可选）'; name.value = b.name || '';
    name.addEventListener('input', () => { b.name = name.value; scheduleSave(); });
    const spacer = el('span', 'spacer');

    // 情感能量滑块（1-10），用于顶部情感弧线
    const eWrap = el('span', 'energy-wrap');
    const eRange = el('input', 'energy-range');
    eRange.type = 'range'; eRange.min = '1'; eRange.max = '10';
    eRange.value = (b.energy == null ? 5 : b.energy);
    eRange.title = '这段的情绪能量（1 平静 → 10 高潮）';
    const eVal = el('span', 'energy-val'); eVal.textContent = eRange.value;
    eRange.addEventListener('input', () => { eVal.textContent = eRange.value; b.energy = +eRange.value; renderArc(); });
    eRange.addEventListener('change', () => { b.energy = +eRange.value; scheduleSave(); });
    eWrap.append(eRange, eVal);

    // AI 菜单（续写 / 整段重生成 / 润色）
    const menu = el('details', 'ai-menu');
    const sum = el('summary', 'ai-menu-sum'); sum.textContent = '✦ AI';
    const mbody = el('div', 'ai-menu-body');
    const mi1 = el('button', null, '续写几句'); mi1.addEventListener('click', () => { menu.open = false; aiContinue(b.id, mi1); });
    const mi2 = el('button', null, '整段重生成'); mi2.addEventListener('click', () => { menu.open = false; aiRegenBlock(b.id, mi2); });
    const mi3 = el('button', null, '诗意润色整段'); mi3.addEventListener('click', () => { menu.open = false; aiPolish(b.id, null, 'block'); });
    const mi4 = el('button', null, '对比 3 版'); mi4.addEventListener('click', () => { menu.open = false; aiVariants(b.id, 'block', null); });
    mbody.append(mi1, mi2, mi3, mi4); menu.append(sum, mbody);

    const btnUp = el('button', 'ico', '↑'); btnUp.title = '上移';
    const btnDown = el('button', 'ico', '↓'); btnDown.title = '下移';
    const btnDel = el('button', 'ico', '✕'); btnDel.title = '删除段落';
    btnUp.addEventListener('click', () => moveBlock(b.id, -1));
    btnDown.addEventListener('click', () => moveBlock(b.id, 1));
    btnDel.addEventListener('click', () => { if (state.blocks.length <= 1) { toast('至少保留一个段落', 'err'); return; } state.blocks = state.blocks.filter((x) => x.id !== b.id); renderAll(); scheduleSave(); });
    head.append(sel, name, eWrap, spacer, btnUp, btnDown, menu, btnDel);

    const linesWrap = el('div', 'lines');
    b.lines.forEach((_, i) => linesWrap.appendChild(buildLineRow(b, i)));
    const warn = el('div', 'block-warn hidden');
    wrap.append(head, linesWrap, warn);
    updateBlockWarn(wrap, b);
    return wrap;
  }

  // 段落太长实时提醒：Suno/Udio 每段建议 ≤8 行，否则易忽略或仓促
  function updateBlockWarn(wrap, b) {
    const warn = wrap.querySelector('.block-warn');
    if (!warn) return;
    const n = b.lines.filter((x) => (x.text || '').trim()).length;
    if (n > 8) {
      warn.classList.remove('hidden');
      warn.innerHTML = '';
      const msg = el('span', 'bw-msg');
      msg.textContent = `⚠ 此段共 ${n} 行，Suno / Udio 建议每段 ≤8 行（易忽略或仓促演唱）。`;
      const btn = el('button', 'bw-split', '一键拆分');
      btn.addEventListener('click', () => splitBlock(b.id));
      warn.append(msg, btn);
    } else {
      warn.classList.add('hidden');
    }
  }
  // 按每 8 行把一个超长段落拆成若干段（保类型，后续段插在原段之后）
  function splitBlock(blockId) {
    const idx = state.blocks.findIndex((x) => x.id === blockId);
    if (idx < 0) return;
    const b = state.blocks[idx];
    const lines = b.lines.slice();
    if (lines.length <= 8) return;
    const chunks = [];
    for (let i = 0; i < lines.length; i += 8) chunks.push(lines.slice(i, i + 8));
    b.lines = chunks[0];
    const newBlocks = chunks.slice(1).map((c) => ({ id: uid(), type: b.type, name: '', lines: c }));
    state.blocks.splice(idx + 1, 0, ...newBlocks);
    renderAll(); scheduleSave();
    toast('已按 8 行拆分：共 ' + chunks.length + ' 段', 'ok');
  }

  function buildLineRow(b, idx) {
    const line = b.lines[idx];
    const row = el('div', 'line'); row.dataset.idx = idx;
    if (line.note) row.classList.add('has-note');
    if (line.locked) row.classList.add('locked');

    const input = el('input', 'line-input'); input.value = line.text || ''; input.placeholder = '写一句…（回车换行）';
    input.addEventListener('focus', () => { lastFocusedInput = input; });
    input.addEventListener('input', () => { line.text = input.value; onLineChanged(row); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); insertLine(b, idx + 1); }
      else if (e.key === 'Backspace' && input.selectionStart === 0 && input.selectionEnd === 0 && !line.text) {
        e.preventDefault(); removeLine(b, idx);
      }
    });

    const acts = el('div', 'line-acts');
    const btnLock = el('button', 'ico', line.locked ? '🔒' : '🔓'); btnLock.title = line.locked ? '已锁定金句（AI 续写/重生成会保留此句）' : '锁定这一句为金句';
    btnLock.classList.toggle('on', !!line.locked);
    btnLock.addEventListener('click', () => {
      line.locked = !line.locked;
      row.classList.toggle('locked', line.locked);
      btnLock.textContent = line.locked ? '🔒' : '🔓';
      btnLock.classList.toggle('on', line.locked);
      scheduleSave();
      toast(line.locked ? '已锁定此句，AI 改写时会保留' : '已解锁此句', 'ok');
    });
    const btnNote = el('button', 'ico', '📝'); btnNote.title = '这一句的标注';
    const btnAi = el('button', 'ico', '✦'); btnAi.title = 'AI 写 / 改这一句';
    const btnDel = el('button', 'ico', '✕'); btnDel.title = '删除这句';
    btnNote.addEventListener('click', () => { row.querySelector('.line-note').classList.toggle('hidden'); });
    btnAi.addEventListener('click', () => openLineAi(b, idx, input));
    btnDel.addEventListener('click', () => removeLine(b, idx));
    acts.append(btnLock, btnNote, btnAi, btnDel);

    const noteBox = el('div', 'line-note hidden');
    const noteInput = el('input', 'line-note-input');
    noteInput.placeholder = '这一句的标注（可选）：AI 改写时作为要求，如「押 ang 韵」「更口语」「更有画面感」';
    noteInput.value = line.note || '';
    noteInput.addEventListener('input', () => {
      line.note = noteInput.value; scheduleSave();
      row.classList.toggle('has-note', !!noteInput.value);
    });
    noteBox.appendChild(noteInput);

    const inline = el('div', 'line-inline');
    const analysis = el('div', 'line-analysis');
    row.append(input, acts, inline, noteBox, analysis);
    renderLineAnalysis(analysis, line.text);
    renderInlineBar(inline, line.text);
    return row;
  }

  function onLineChanged(row) {
    const analysis = row.querySelector('.line-analysis');
    const input = row.querySelector('.line-input');
    renderLineAnalysis(analysis, input.value);
    const il = row.querySelector('.line-inline'); if (il) renderInlineBar(il, input.value);
    const meter = row.querySelector('.line-meter');
    if (meter) { const n = lineCount(input.value); meter.textContent = n + ' 字'; meter.classList.toggle('over', n > 16); }
    const wrap = row.closest('.block');
    if (wrap) {
      const b = state.blocks.find((x) => x.id === wrap.dataset.id);
      if (b) updateBlockWarn(wrap, b);
    }
    updateStats(); scheduleSave();
  }

  function insertLine(b, at) {
    b.lines.splice(at, 0, { text: '', note: '' });
    renderAll(); scheduleSave();
    const wrap = document.querySelector(`.block[data-id="${b.id}"]`);
    if (wrap) { const rows = wrap.querySelectorAll('.line'); const t = rows[at]; if (t) { const inp = t.querySelector('.line-input'); inp && inp.focus(); } }
  }
  function removeLine(b, idx) {
    if (b.lines.length <= 1) b.lines = [{ text: '', note: '' }];
    else b.lines.splice(idx, 1);
    renderAll(); scheduleSave();
    const wrap = document.querySelector(`.block[data-id="${b.id}"]`);
    if (wrap) {
      const rows = wrap.querySelectorAll('.line');
      const t = rows[Math.max(0, idx - 1)];
      if (t) { const inp = t.querySelector('.line-input'); if (inp) { inp.focus(); const v = inp.value; inp.setSelectionRange(v.length, v.length); } }
    }
  }
  function moveBlock(id, dir) {
    const i = state.blocks.findIndex((b) => b.id === id);
    const j = i + dir;
    if (j < 0 || j >= state.blocks.length) return;
    const [x] = state.blocks.splice(i, 1);
    state.blocks.splice(j, 0, x);
    renderAll(); scheduleSave();
  }

  // ---------- 元信息（标题、信息弹窗） ----------
  function openInfo() {
    $('#meta-author').value = state.meta.author || '';
    $('#meta-key').value = state.meta.key || '';
    $('#meta-bpm').value = state.meta.bpm || '';
    $('#meta-meter').value = state.meta.meter || '';
    $('#meta-genre').value = state.meta.genre || '';
    $('#meta-mood').value = state.meta.mood || '';
    const s = state.meta.singer || {};
    $('#singer-name').value = s.name || '';
    $('#singer-gender').value = s.gender || '';
    $('#singer-register').value = s.register || '';
    $('#singer-timbre').value = s.timbre || '';
    $('#info-modal').classList.remove('hidden');
  }

  // ---------- AI ----------
  async function checkAiStatus() {
    const dot = $('#ai-status');
    dot.className = 'dot unknown'; dot.title = 'AI: 检测中…';
    try {
      const r = await fetch('/api/ai/status');
      const j = await r.json();
      currentProvider = j.provider || 'ark';
      if (currentProvider === 'ark') {
        if (j.ark && j.ark.configured) { arkReady = true; dot.className = 'dot ok'; dot.title = 'AI: 火山方舟(' + (j.ark.model || 'doubao') + ')'; }
        else { arkReady = false; dot.className = 'dot err'; dot.title = 'AI: 火山未配置 Key（点击设置）'; }
      } else if (currentProvider === 'openai') {
        if (j.openai && j.openai.configured) { arkReady = true; dot.className = 'dot ok'; dot.title = 'AI: OpenAI 兼容(' + (j.openai.model || '未填模型名') + ')'; }
        else { arkReady = false; dot.className = 'dot err'; dot.title = 'AI: OpenAI 兼容未配置（点击设置）'; }
      } else {
        if (j.ollama && j.ollama.ok) { dot.className = 'dot ok'; dot.title = 'AI: Ollama(' + ((j.ollama.models || [])[0] || 'local') + ')'; }
        else { dot.className = 'dot err'; dot.title = 'AI: Ollama 未连接'; }
      }
    } catch { dot.className = 'dot err'; dot.title = 'AI: 不可用'; }
  }

  // 清理 AI 返回里可能混入的段落结构标签（如「主歌」【副歌】[Verse]），避免"主歌"被当歌词压进韵脚
  function cleanAiText(text) {
    if (!text) return '';
    const LABELS = ['主歌', '副歌', '桥段', '导歌', '前奏', '间奏', '尾奏',
      'Intro', 'Verse', 'Chorus', 'Bridge', 'Pre-Chorus', 'PreChorus', 'Outro', 'Interlude'];
    const reStart = new RegExp('^\\s*[\\(\\[【(]?\\s*(' + LABELS.join('|') + ')\\s*[）\\]】)]?\\s*[:：]?\\s*', 'i');
    const reAnyTag = /^\s*[【\[\(（][^】\)\]）]{1,14}[】\)\]）]\s*/;
    return text.split('\n').map((raw) => {
      let t = raw.replace(reStart, '').replace(reAnyTag, '').replace(/\s+$/, '');
      return t;
    }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  let CURRENT_PINNED = []; // 本次 AI 调用携带的锁定金句
  function aiBody(context, instruction, sectionType, mode) {
    const m = state.meta || {};
    return { context, instruction, provider: currentProvider, style: stylePayload(), singer: singerPayload(), sectionType: sectionType || '', mode: mode || '', pinned: CURRENT_PINNED, genre: currentGenre(), language: currentLang(), energy: currentEnergy(), bpm: m.bpm || '', key: m.key || '', meter: m.meter || '', brief: briefOf() };
  }

  async function aiContinue(blockId, btn) {
    const block = findBlock(blockId);
    const prev = btn.textContent; btn.disabled = true; btn.textContent = '续写中…';
    const ctx = block.lines.map((l) => l.text).join('\n');
    CURRENT_PINNED = block.lines.filter((l) => l.locked).map((l) => l.text);
    try {
      const r = await fetch('/api/ai/suggest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(aiBody(ctx, themeHint() + briefHint() + '续写 2-4 行，延续本段情绪与意象，尽量贴合已有韵脚走向。只输出歌词。', typeLabel(block.type))),
      });
      const j = await r.json();
      if (j.ok && j.text) {
        const newLines = cleanAiText(j.text).split('\n').map((t) => ({ text: t, note: '' })).filter((l) => l.text);
        block.lines.push(...newLines);
        renderAll(); scheduleSave();
        toast('AI 已续写', 'ok');
      } else toast(j.message || 'AI 续写失败', 'err');
    } catch (e) { toast('AI 请求失败：' + e.message, 'err'); }
    finally { CURRENT_PINNED = []; btn.disabled = false; btn.textContent = prev; }
  }

  async function aiRegenBlock(blockId, btn) {
    const block = findBlock(blockId);
    const prev = btn.textContent; btn.disabled = true; btn.textContent = '重生成中…';
    const ctx = block.lines.map((l) => l.text).join('\n');
    const hints = block.lines.map((l) => l.note).filter(Boolean).join('；');
    CURRENT_PINNED = block.lines.filter((l) => l.locked).map((l) => l.text);
    try {
      const r = await fetch('/api/ai/suggest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(aiBody(ctx, themeHint() + briefHint() + `重写整段歌词${hints ? '，各句要求：' + hints : ''}${CURRENT_PINNED.length ? '，其中已锁定金句必须原样保留：' + CURRENT_PINNED.join('｜') : ''}。保持段落结构与大致行数，直接输出改写后的整段（每行一句），不要解释、不要加引号。`, typeLabel(block.type))),
      });
      const j = await r.json();
      if (j.ok && j.text) {
        let lines = cleanAiText(j.text).split('\n').map((t) => ({ text: t.trim(), note: '' })).filter((l) => l.text);
        // 强制保留锁定金句（按原索引回填，AI 万一漏改也能兜住）
        block.lines.forEach((l, k) => { if (l.locked && lines[k]) lines[k] = { text: l.text, note: l.note, locked: true }; });
        block.lines = lines.length ? lines : [{ text: '', note: '' }];
        renderAll(); scheduleSave();
        toast('AI 已重生成整段', 'ok');
      } else toast(j.message || 'AI 重生成失败', 'err');
    } catch (e) { toast('AI 请求失败：' + e.message, 'err'); }
    finally { CURRENT_PINNED = []; btn.disabled = false; btn.textContent = prev; }
  }

  function openLineAi(b, idx, input) {
    const line = b.lines[idx];
    const s = input.selectionStart, e = input.selectionEnd;
    const selText = s !== e ? input.value.slice(s, e) : '';
    const body = $('#modal-body'); $('#modal-title').textContent = '这一句的 AI';
    body.innerHTML = '';
    const preview = el('div', 'sel-preview'); preview.textContent = '当前这句：' + (line.text || '（空）');
    const label = el('label', 'sel-label'); label.textContent = '标注 / 要求（可选）：';
    const taNote = el('textarea', 'sel-note'); taNote.placeholder = '如：押 ang 韵 / 更口语 / 更有画面感 / 更伤感'; taNote.value = line.note || '';
    const styleInfo = el('div', 'sel-style');
    styleInfo.textContent = '词人风格：' + ((STYLES[currentStyle] || {}).name || '原声 / 自由') + (singerHint() ? '　|　演唱：' + singerHint() : '');
    const actions = el('div', 'sel-actions');
    const bRewrite = el('button', 'primary', '按标注重写本句');
    bRewrite.addEventListener('click', () => doLineRegen(b.id, idx, taNote.value.trim(), '', bRewrite));
    const bImprove = el('button', null, '顺一下这一句');
    bImprove.addEventListener('click', () => doLineRegen(b.id, idx, taNote.value.trim(), '', bImprove));
    const bPolish = el('button', null, '✦ 诗意润色');
    bPolish.addEventListener('click', () => { $('#modal').classList.add('hidden'); aiPolish(b.id, idx, 'line'); });
    const bVers = el('button', null, '对比 3 版');
    bVers.addEventListener('click', () => { $('#modal').classList.add('hidden'); aiVariants(b.id, 'line', idx); });
    actions.append(bRewrite, bImprove, bPolish, bVers);
    body.append(preview, label, taNote, styleInfo, actions);
    if (selText) {
      const selInfo = el('div', 'sel-style'); selInfo.textContent = '选中文字：「' + selText + '」';
      const bSel = el('button', null, '重写选中文字');
      bSel.addEventListener('click', () => doLineRegen(b.id, idx, taNote.value.trim(), selText, bSel));
      body.append(selInfo, bSel);
    }
    const cancel = el('button', null, '取消'); cancel.addEventListener('click', () => $('#modal').classList.add('hidden'));
    body.append(cancel);
    $('#modal').classList.remove('hidden');
    setTimeout(() => taNote.focus(), 30);
  }

  async function doLineRegen(blockId, idx, annotation, selText, btn) {
    const block = findBlock(blockId); const line = block.lines[idx];
    if (line && line.locked) { toast('此句已锁定为金句，先解锁再改写', 'err'); return; }
    const prev = btn.textContent; btn.disabled = true; btn.textContent = '生成中…';
    const ctx = selText || line.text;
    const instruction = selText
      ? `改写下面这句歌词里的「${selText}」${annotation ? '，要求：' + annotation : ''}。保持原意与上下文，只输出替换后的那段文字本身，不要解释、不要加引号、不要写“以下是”。`
      : `重写这一句歌词${annotation ? '，要求：' + annotation : ''}。保持原意、情绪与大致押韵，直接输出改写后的一句歌词，不要解释、不要加引号、不要写“以下是”。`;
    try {
      const r = await fetch('/api/ai/suggest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(aiBody(ctx, instruction, typeLabel(block.type))),
      });
      const j = await r.json();
      if (j.ok && j.text) {
        const rep = cleanAiText(j.text);
        line.text = selText ? line.text.replace(selText, rep) : rep;
        renderAll(); scheduleSave();
        $('#modal').classList.add('hidden');
        toast('AI 已改写这一句', 'ok');
      } else toast(j.message || 'AI 改写失败', 'err');
    } catch (e) { toast('AI 请求失败：' + e.message, 'err'); }
    finally { btn.disabled = false; btn.textContent = prev; }
  }

  // 诗意润色（Poetic Elevation / 去 AI 味）：弹窗展示 before/after，确认才替换
  async function aiPolish(blockId, idx, scope) {
    const block = findBlock(blockId);
    if (!block) return;
    const prevText = scope === 'line' ? (block.lines[idx] ? block.lines[idx].text : '') : block.lines.map((l) => l.text).join('\n');
    if (!prevText.trim()) { toast('还没有可润色的文字', 'err'); return; }
    const body = $('#modal-body'); $('#modal-title').textContent = '诗意润色预览';
    body.innerHTML = '';
    const tip = el('div', 'sel-style'); tip.textContent = 'AI 将按「诗意提升 / 去 AI 味」规则改写：用更鲜活的意象替换平淡陈述，增加感官细节与动态画面，避免堆砌形容词与空洞感叹，去除套话，让语感自然、有记忆点；保持原意、情绪与押韵。';
    const before = el('div', 'polish-before'); before.innerHTML = '<div class="sel-label">润色前</div><div class="polish-txt">' + esc(prevText) + '</div>';
    const afterWrap = el('div', 'polish-after'); afterWrap.innerHTML = '<div class="sel-label">润色后</div><div class="polish-txt" id="polish-out">⏳ 生成中…</div>';
    const actions = el('div', 'sel-actions');
    const bApply = el('button', 'primary', '应用到歌词'); bApply.disabled = true;
    const bCancel = el('button', null, '放弃'); bCancel.addEventListener('click', () => $('#modal').classList.add('hidden'));
    actions.append(bApply, bCancel);
    body.append(tip, before, afterWrap, actions);
    $('#modal').classList.remove('hidden');

    const ctx = prevText;
    const instruction = scope === 'line'
      ? `请对下面这一句歌词做「诗意润色」：用更鲜活的意象替换平淡陈述，增加感官细节与动态画面，避免堆砌形容词与空洞感叹，去除 AI 常见套话，让语感自然、有记忆点。保持原意、情绪与大致押韵。直接输出润色后的一句歌词，不要解释、不要加引号、不要写“以下是”。\n原句：${ctx}`
      : `请对下面这段歌词做「诗意润色」：逐行润色，用更鲜活的意象替换平淡陈述，增加感官细节与动态画面，避免堆砌形容词与空洞感叹，去除 AI 常见套话，让语感自然、有记忆点。保持原意、情绪、行数与押韵。直接输出逐行润色后的歌词（每行一句，行数与原文一致），不要解释、不要加引号、不要写“以下是”。\n原段：\n${ctx}`;
    const secType = scope === 'line' && block.lines[idx] ? typeLabel(block.type) : '';
    try {
      const r = await fetch('/api/ai/suggest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(aiBody(ctx, instruction, secType, '')),
      });
      const j = await r.json();
      if (j.ok && j.text) {
        const polished = cleanAiText(j.text);
        const out = scope === 'line' ? (polished.split('\n').map((t) => t.trim()).filter(Boolean)[0] || polished) : polished;
        const outEl = $('#polish-out'); if (outEl) outEl.textContent = out;
        bApply.disabled = false;
        bApply.addEventListener('click', () => {
          if (scope === 'line') { if (block.lines[idx]) block.lines[idx].text = out; }
          else { const arr = cleanAiText(j.text).split('\n').map((t) => ({ text: t.trim(), note: '' })).filter((l) => l.text); if (arr.length) block.lines = arr; }
          renderAll(); scheduleSave(); $('#modal').classList.add('hidden'); toast('已应用润色', 'ok');
        });
      } else { const o = $('#polish-out'); if (o) o.textContent = '生成失败：' + (j.message || ''); }
    } catch (e) { const o = $('#polish-out'); if (o) o.textContent = '请求失败：' + e.message; }
  }

  // ---------- 多版本并排（功能④） ----------
  const VER_KEY = 'lyric-studio:versions';
  let VER = loadVersions();
  function loadVersions() { try { return JSON.parse(localStorage.getItem(VER_KEY)) || {}; } catch { return {}; } }
  function saveVersions() { try { localStorage.setItem(VER_KEY, JSON.stringify(VER)); } catch {} }
  function pushVersion(blockId, set) {
    if (!VER[blockId]) VER[blockId] = [];
    VER[blockId].unshift(set);
    VER[blockId] = VER[blockId].slice(0, 8);
    saveVersions();
  }
  async function aiVariants(blockId, scope, idx) {
    const block = findBlock(blockId); if (!block) return;
    const prevText = scope === 'line'
      ? (block.lines[idx] ? block.lines[idx].text : '')
      : block.lines.map((l) => l.text).join('\n');
    if (!prevText.trim()) { toast('还没有可生成版本的内容', 'err'); return; }
    const body = $('#modal-body'); $('#modal-title').textContent = '对比 3 版';
    body.innerHTML = '';
    const tip = el('div', 'sel-style'); tip.textContent = 'AI 同时生成 3 个版本（同一要求、不同表达），并排对比，选最顺的 apply；本次与历史版本都会留档，可随时回看。';
    const grid = el('div', 'vers-grid');
    for (let i = 0; i < 3; i++) { const col = el('div', 'vers-col'); col.innerHTML = '<div class="vers-h">版本 ' + (i + 1) + '</div><div class="vers-out" id="vers-out-' + i + '">⏳ 生成中…</div><div class="vers-act"><button class="primary sm" data-i="' + i + '" disabled>应用</button></div>'; grid.appendChild(col); }
    const hist = el('div', 'vers-hist'); hist.innerHTML = '<div class="sel-label">本段历史版本</div><div id="vers-hist-list" class="vers-hist-list"></div>';
    body.append(tip, grid, hist);
    $('#modal').classList.remove('hidden');
    renderVersHist(blockId);
    const pinned = scope === 'block' ? block.lines.filter((l) => l.locked).map((l) => l.text) : [];
    CURRENT_PINNED = pinned;
    const baseInstr = scope === 'line'
      ? '请改写下面这一句歌词' + (block.lines[idx] && block.lines[idx].note ? '，要求：' + block.lines[idx].note : '') + '。保持原意、情绪与大致押韵，直接输出改写后的一句歌词，不要解释、不要加引号、不要写“以下是”。\n原句：' + prevText
      : '请重写整段歌词' + (pinned.length ? '，其中已锁定金句必须原样保留：' + pinned.join('｜') : '') + '。保持段落结构与大致行数，直接输出改写后的整段（每行一句），不要解释、不要加引号、不要写“以下是”。';
    const secType = scope === 'line' && block.lines[idx] ? typeLabel(block.type) : (scope === 'block' ? typeLabel(block.type) : '');
    const results = [null, null, null];
    await Promise.all([0, 1, 2].map(async (i) => {
      try {
        const r = await fetch('/api/ai/suggest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(aiBody(prevText, baseInstr, secType, scope === 'line' ? '' : '')) });
        const j = await r.json();
        if (j.ok && j.text) { results[i] = cleanAiText(j.text); const o = $('#vers-out-' + i); if (o) o.textContent = results[i]; const btn = grid.querySelector('button[data-i="' + i + '"]'); if (btn) btn.disabled = false; }
        else { const o = $('#vers-out-' + i); if (o) o.textContent = '生成失败：' + (j.message || ''); }
      } catch (e) { const o = $('#vers-out-' + i); if (o) o.textContent = '请求失败：' + e.message; }
    }));
    CURRENT_PINNED = [];
    grid.querySelectorAll('button[data-i]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = +btn.dataset.i; const txt = results[i]; if (!txt) return;
        if (scope === 'line') { if (block.lines[idx]) block.lines[idx].text = txt.trim(); }
        else {
          let lines = txt.split('\n').map((t) => ({ text: t.trim(), note: '' })).filter((l) => l.text);
          block.lines.forEach((l, k) => { if (l.locked && lines[k]) lines[k] = { text: l.text, note: l.note, locked: true }; });
          block.lines = lines.length ? lines : [{ text: '', note: '' }];
        }
        pushVersion(blockId, { ts: Date.now(), scope, text: txt });
        renderVersHist(blockId);
        renderAll(); scheduleSave(); $('#modal').classList.add('hidden'); toast('已应用版本 ' + (i + 1), 'ok');
      });
    });
  }
  function renderVersHist(blockId) {
    const list = $('#vers-hist-list'); if (!list) return;
    const sets = VER[blockId] || [];
    if (!sets.length) { list.innerHTML = '<div class="empty" style="padding:10px">暂无历史版本</div>'; return; }
    list.innerHTML = '';
    sets.forEach((s) => {
      const item = el('div', 'vers-hist-item');
      const t = new Date(s.ts).toLocaleString('zh-CN', { hour12: false });
      const preview = (s.text || '').split('\n').slice(0, 2).join(' / ');
      item.innerHTML = '<div class="vh-t">' + esc(t) + ' · ' + (s.scope === 'line' ? '单句' : '整段') + '</div><div class="vh-p">' + esc(preview) + '</div>';
      const b = el('button', 'sm', '应用'); b.addEventListener('click', () => {
        const block = findBlock(blockId); if (!block) return;
        if (s.scope === 'line') { toast('单句历史请在该句「对比3版」里重做', 'err'); return; }
        let lines = (s.text || '').split('\n').map((x) => ({ text: x.trim(), note: '' })).filter((l) => l.text);
        block.lines = lines.length ? lines : [{ text: '', note: '' }];
        renderAll(); scheduleSave(); $('#modal').classList.add('hidden'); toast('已回退到历史版本', 'ok');
      });
      item.appendChild(b); list.appendChild(item);
    });
  }

  // ---------- 词库（功能①） ----------
  let LEX = null;
  async function openLexicon() {
    const body = $('#modal-body'); $('#modal-title').textContent = '词库 · 同义族 / 意象 / 修辞';
    body.innerHTML = '';
    const tip = el('div', 'sel-style'); tip.textContent = '写词卡壳时查词：同义替换、按主题找意象、按手法看范例。点候选可插入到当前光标处（或复制）。';
    const row = el('div', 'lex-row');
    const inp = el('input', 'lex-inp'); inp.placeholder = '输入一个词查同义族，如「爱」「夜」「雨」';
    row.appendChild(inp);
    const out = el('div', 'lex-out'); out.innerHTML = '<div class="empty">输入或选主题查看建议</div>';
    const themeBar = el('div', 'lex-themes');
    const rhetBar = el('div', 'lex-themes');
    body.append(tip, row, out, themeBar, rhetBar);
    $('#modal').classList.remove('hidden');
    if (!LEX) { try { const r = await fetch('/api/lexicon'); LEX = await r.json(); } catch { LEX = {}; } }
    if (LEX && LEX.imagery) Object.keys(LEX.imagery).forEach((th) => { const b = el('button', 'chip', th); b.addEventListener('click', () => showImagery(th, out)); themeBar.appendChild(b); });
    if (LEX && LEX.rhetoric) { const lab = el('div', 'lex-lab'); lab.textContent = '修辞手法'; rhetBar.appendChild(lab); Object.keys(LEX.rhetoric).forEach((d) => { const b = el('button', 'chip', d); b.addEventListener('click', () => showRhetoric(d, out)); rhetBar.appendChild(b); }); }
    inp.addEventListener('input', () => showSynonyms(inp.value.trim(), out));
    setTimeout(() => inp.focus(), 30);
  }
  function insertLex(text) {
    const inp = lastFocusedInput;
    if (inp && document.body.contains(inp)) {
      const s = inp.selectionStart || inp.value.length, e = inp.selectionEnd || inp.value.length;
      inp.value = inp.value.slice(0, s) + text + inp.value.slice(e);
      inp.focus(); try { inp.setSelectionRange(s + text.length, s + text.length); } catch {}
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      toast('已插入到歌词输入框', 'ok');
    } else { navigator.clipboard.writeText(text).then(() => toast('已复制到剪贴板', 'ok')).catch(() => toast('复制失败', 'err')); }
  }
  function showSynonyms(word, out) {
    if (!word) { out.innerHTML = '<div class="empty">输入或选主题查看建议</div>'; return; }
    const syns = (LEX && LEX.synonyms && LEX.synonyms[word]) || [];
    if (!syns.length) { out.innerHTML = '<div class="empty">词库暂未收录「' + esc(word) + '」的同义族（可手动写，或换词试试）</div>'; return; }
    out.innerHTML = '<div class="sel-label">「' + esc(word) + '」的同义族（点选插入）</div>' + syns.map((s) => '<span class="lex-item" data-w="' + esc(s) + '">' + esc(s) + '</span>').join('');
    out.querySelectorAll('.lex-item').forEach((x) => x.addEventListener('click', () => insertLex(x.dataset.w)));
  }
  function showImagery(theme, out) {
    const arr = (LEX && LEX.imagery && LEX.imagery[theme]) || [];
    out.innerHTML = '<div class="sel-label">意象库 · ' + esc(theme) + '（点选插入）</div>' + arr.map((s) => '<span class="lex-item" data-w="' + esc(s) + '">' + esc(s) + '</span>').join('');
    out.querySelectorAll('.lex-item').forEach((x) => x.addEventListener('click', () => insertLex(x.dataset.w)));
  }
  function showRhetoric(dev, out) {
    const arr = (LEX && LEX.rhetoric && LEX.rhetoric[dev]) || [];
    out.innerHTML = '<div class="sel-label">修辞 · ' + esc(dev) + '</div>' + arr.map((s) => '<div class="lex-rh">' + esc(s) + '</div>').join('');
  }

  // 词库预载（功能③需要行内同义替换，init 时拉一次，后续行内提示直接读内存）
  function ensureLex() {
    if (LEX) return Promise.resolve(LEX);
    return fetch('/api/lexicon').then((r) => r.json()).then((j) => { LEX = j; return LEX; }).catch(() => { LEX = {}; return LEX; });
  }

  // ---------- 实时内联助手（功能③） ----------
  // 每行输入框下方常驻一条助手：实时韵脚(辙+拼音尾)、字数(≤16)、若句末词命中词库同义族则给出可点替换芯片。
  // 始终可见（不依赖韵脚/平仄/节奏开关），输入时刷新。
  function renderInlineBar(bar, text) {
    if (!bar) return;
    const t = (text || '').trim();
    if (!t) { bar.style.display = 'none'; bar.innerHTML = ''; return; }
    bar.style.display = '';
    let html = '';
    if (isHanLang() && window.Pinyin && window.Pinyin.analyzeLine) {
      const a = window.Pinyin.analyzeLine(t);
      const r = a.rhyme;
      const zhe = r.zhe ? '韵·' + r.zhe : '韵·—';
      const py = r.py ? r.py.replace(/[0-9]$/, '') : '';
      html += `<span class="li-rh">${esc(zhe)}${py ? ` <i>${esc(py)}</i>` : ''}</span>`;
    }
    const n = lineCount(t);
    if (isHanLang()) html += `<span class="li-cnt ${n > 16 ? 'over' : ''}">${n}字</span>`;
    else html += `<span class="li-cnt">${n}字符</span>`;
    if (LEX && LEX.synonyms) {
      const last2 = t.slice(-2), last1 = t.slice(-1);
      const key = LEX.synonyms[last2] ? last2 : (LEX.synonyms[last1] ? last1 : null);
      if (key) {
        const syns = LEX.synonyms[key].filter((s) => s !== key).slice(0, 3);
        if (syns.length) {
          html += `<span class="li-syn">↔同义 ${esc(key)}：` + syns.map((s) => `<span class="li-sy" data-k="${esc(key)}" data-s="${esc(s)}">${esc(s)}</span>`).join('') + '</span>';
        }
      }
    }
    bar.innerHTML = html;
    bar.querySelectorAll('.li-sy').forEach((ch) => ch.addEventListener('click', () => {
      const inp = bar.closest('.line').querySelector('.line-input');
      const k = ch.dataset.k, s = ch.dataset.s;
      const idx = inp.value.lastIndexOf(k);
      if (idx < 0) return;
      inp.value = inp.value.slice(0, idx) + s + inp.value.slice(idx + k.length);
      const blk = state.blocks.find((b) => b.id === bar.closest('.block').dataset.id);
      const line = blk && blk.lines[+bar.closest('.line').dataset.idx];
      if (line) line.text = inp.value;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      toast('已替换为「' + s + '」', 'ok');
    }));
  }
  function refreshInlineAll() {
    document.querySelectorAll('.block').forEach((wrap) => {
      const b = findBlock(wrap.dataset.id); if (!b) return;
      wrap.querySelectorAll('.line').forEach((row, i) => {
        const bar = row.querySelector('.line-inline');
        if (bar && b.lines[i]) renderInlineBar(bar, b.lines[i].text);
      });
    });
  }

  // 整首歌结构预设与段落性质说明
  const SONG_STRUCTURES = {
    standard: { label: '标准流行（主歌×2 / 副歌×2 / 桥段 / 副歌）', order: ['主歌', '副歌', '主歌', '副歌', '桥段', '副歌'] },
    classic: { label: '经典（主歌×2 / 副歌×2 / 尾奏）', order: ['主歌', '副歌', '主歌', '副歌', '尾奏'] },
    intro: { label: '加前奏（前奏 / 主歌 / 副歌 / 主歌 / 副歌 / 桥段 / 副歌）', order: ['前奏', '主歌', '副歌', '主歌', '副歌', '桥段', '副歌'] },
    simple: { label: '简单（主歌 / 副歌 / 主歌 / 副歌）', order: ['主歌', '副歌', '主歌', '副歌'] },
  };
  const SECTION_NATURE = {
    主歌: '叙事铺陈、展开意象', 副歌: '情绪高潮、点题、易记', 桥段: '转折升华、打破重复',
    导歌: '铺垫引入、留白', 前奏: '极简短念白或氛围', 间奏: '极简短念白或氛围', 尾奏: '收束余韵',
  };

  async function aiInspire() {
    // 弹窗：一次性生成一整首带结构的歌，之后用户在各正文框里逐句微调
    const body = $('#modal-body'); $('#modal-title').textContent = 'AI 写整首歌';
    body.innerHTML = '';
    const tip = el('div', 'sel-style'); tip.textContent = 'AI 会生成一整首带段落结构的歌（主歌 / 副歌 / 桥段…），生成后你在各正文框里逐句微调即可。';
    const rowStruct = el('label', 'sel-label'); rowStruct.textContent = '歌曲结构';
    const selStruct = el('select', 'sel-type');
    Object.keys(SONG_STRUCTURES).forEach((k) => { const o = el('option'); o.value = k; o.textContent = SONG_STRUCTURES[k].label; selStruct.appendChild(o); });
    selStruct.value = 'standard';
    const rowTheme = el('label', 'sel-label'); rowTheme.textContent = '主题 / 情绪（选填，如：深夜的城市、失恋后的洒脱）';
    const taTheme = el('textarea', 'sel-note'); taTheme.placeholder = '想写什么主题 / 情绪？（可留空，AI 自行设定完整主题）';
    const actions = el('div', 'sel-actions');
    const bGo = el('button', 'primary', '生成整首');
    const cancel = el('button', null, '取消'); cancel.addEventListener('click', () => $('#modal').classList.add('hidden'));
    actions.append(bGo, cancel);
    body.append(tip, rowStruct, selStruct, rowTheme, taTheme, actions);
    $('#modal').classList.remove('hidden');
    taTheme.value = state.meta.theme || '';
    setTimeout(() => taTheme.focus(), 30);

    bGo.addEventListener('click', async () => {
      const theme = taTheme.value.trim();
      const order = (SONG_STRUCTURES[selStruct.value] || SONG_STRUCTURES.standard).order;
      const ctx = state.blocks.map((b) => b.lines.map((l) => l.text).join('\n')).filter(Boolean).join('\n\n');
      const singer = singerHint();
      const structText = order.map((lab, i) => `${i + 1}) ${lab}（${SECTION_NATURE[lab] || ''}）`).join('；');
      const themePart = theme ? `主题 / 情绪：「${theme}」。` : '请自行设定一个完整统一的主题与情绪。';
      const singerPart = singer ? `请适配演唱者「${singer}」的音色与音域，便于人声自然演唱。` : '';
      const allLocked = [];
      state.blocks.forEach((b) => b.lines.forEach((l) => { if (l.locked && (l.text || '').trim()) allLocked.push({ text: l.text.trim(), type: b.type || 'verse' }); }));
      const pinnedPart = allLocked.length ? `以下 ${allLocked.length} 句是已锁定金句，必须一字不改地出现在歌词中（放在合适段落）：${allLocked.map((o) => o.text).join('｜')}。` : '';
      const langName = LANGS[currentLang()] || '华语';
      const genreName = currentGenre() ? '（' + (GENRES[currentGenre()] || '流行') + '）' : '';
      const briefPart = briefHint() ? briefHint() + '。' : '';
      const instruction = `请创作一整首${langName}流行歌${genreName}，段落顺序与性质如下（共 ${order.length} 段）：${structText}。${themePart}${briefPart}段落行数严格按硬性规则：主歌与副歌必须等长（固定各 4 行，需铺陈可各 8 行，禁止 6 行），全为偶数行、禁止奇数行；每行一句，押韵自然；副歌歌词只需写一遍（后续重复由音乐生成器循环）。${singerPart}${pinnedPart}段落标题可用【主歌】【副歌】【桥段】或 [Verse]/[Chorus]/[Bridge] 等，独占一行，只输出歌词，不要解释。`;
      // 已有内容时确认覆盖
      if (state.blocks.some((b) => b.lines.some((l) => (l.text || '').trim()))) {
        if (!window.confirm('当前已有歌词，是否覆盖生成整首新歌？（取消则保留现有内容）')) return;
      }
      CURRENT_PINNED = allLocked.map((o) => o.text);
      bGo.disabled = true; bGo.textContent = '生成中…';
      toast('AI 正在写整首歌…');
      try {
        const r = await fetch('/api/ai/suggest', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(aiBody(ctx, instruction, '', 'song')),
        });
        const j = await r.json();
        if (j.ok && j.text) {
          const blocks = parseSong(j.text);
          // 兜底：与整段重写路径一致——AI 万一漏掉锁定金句，按原段落性质强制插回（放该段倒数第二行位置）。
          // 金句保留优先于行数奇偶约束，缺几句补几句。
          const missing = allLocked.filter((o) => !blocks.some((bl) => bl.lines.some((ln) => (ln.text || '').includes(o.text))));
          for (const o of missing) {
            const tb = blocks.find((bl) => bl.type === o.type) || blocks.find((bl) => bl.lines.length >= 2) || blocks[0];
            if (!tb) break;
            tb.lines.splice(Math.max(0, tb.lines.length - 1), 0, { text: o.text, note: '' });
          }
          state.blocks = blocks;
          renderAll(); scheduleSave();
          $('#modal').classList.add('hidden');
          toast('AI 已生成整首歌（' + blocks.length + ' 段）' + (missing.length ? '，已强制保留锁定金句 ' + missing.length + ' 句' : ''), 'ok');
        } else toast(j.message || 'AI 生成失败', 'err');
      } catch (e) { toast('AI 请求失败：' + e.message, 'err'); }
      finally { CURRENT_PINNED = []; bGo.disabled = false; bGo.textContent = '生成整首'; }
    });
  }

  // 主题提示：应用灵感推荐后，逐段写词也遵循该主题方向
  function themeHint() { return state.meta.theme ? '主题方向：「' + state.meta.theme + '」。' : ''; }

  // ---------- 🎯 委托要求（客户/委托方给的资料，硬性约束，自动带入每次生成） ----------
  function briefOf() {
    const b = (state && state.meta && state.meta.brief) || {};
    const g = (v) => String(v == null ? '' : v).trim();
    return { story: g(b.story), must: g(b.must), avoid: g(b.avoid), tone: g(b.tone), traits: g(b.traits) };
  }
  function briefLines(v) { return String(v || '').split('\n').map((s) => s.trim()).filter(Boolean); }
  function briefHint() {
    const b = briefOf();
    const parts = [];
    if (b.story) parts.push('委托方给的资料与故事素材：' + b.story);
    if (b.traits) parts.push('必须用到的笔法（照此手法写，不是堆意象）：' + briefLines(b.traits).join('；'));
    if (b.must) parts.push('必须出现的词句（务必原样写进歌词）：' + briefLines(b.must).join('、'));
    if (b.avoid) parts.push('绝对不要写（委托方明确排除）：' + briefLines(b.avoid).join('、'));
    if (b.tone) parts.push('口气 / 人称 / 其他要求：' + b.tone);
    return parts.length ? parts.join(' ') + '。' : '';
  }
  function hasBrief() { const b = briefOf(); return !!(b.story || b.traits || b.must || b.avoid || b.tone); }
  // 必留词堆到一定条数，AI 会把它们当成一串任务点、退化成「只写几句」，
  // 同时 prompt 变长、生成耗时暴涨。到阈值就在按钮上直接报警，让用户知道该先「清空」。
  const MUST_WARN_AT = 6;
  function syncReqBadge() {
    const btn = $('#btn-req'); if (!btn) return;
    const has = hasBrief();
    btn.classList.toggle('on', has);
    const n = briefLines(briefOf().must).length;
    const warn = has && n >= MUST_WARN_AT;
    btn.textContent = has ? (warn ? '🎯 要求⚠' + n : '🎯 要求' + (n ? '·' + n : '')) : '🎯 要求';
    btn.title = has
      ? '已填委托要求（' + (n ? n + ' 个必留词' + (warn ? '——过多，AI 可能只生成少量歌词且耗时变长，建议先清空' : '') + '，' : '') + 'AI 生成会自动带上）'
      : '填写客户给的资料（故事 / 必留词 / 雷区 / 口气），自动带入每次生成';
    btn.classList.toggle('warn', !!warn);
  }

  // ---------- 要求模板（从灵感提取 / 自己存）存 localStorage，可一键套用 ----------
  function loadReqTpl() { try { return JSON.parse(localStorage.getItem(TPL_KEY) || '[]'); } catch (e) { return []; } }
  function saveReqTpl(arr) { try { localStorage.setItem(TPL_KEY, JSON.stringify(arr)); } catch (e) { /* 配额满则忽略 */ } }
  function applyReqTpl(name, onApplied) {
    const t = loadReqTpl().find((x) => x.name === name);
    if (!t) { toast('模板不存在', 'err'); return; }
    const b = briefOf();
    if (b.story || b.traits || b.must || b.avoid || b.tone) {
      if (!window.confirm('套用模板「' + name + '」会覆盖当前「要求」里的内容，继续？')) return;
    }
    if (!state.meta) state.meta = {};
    if (!state.meta.brief) state.meta.brief = {};
    const src = t.brief || {};
    state.meta.brief = { story: src.story || '', must: src.must || '', avoid: src.avoid || '', tone: src.tone || '', traits: src.traits || '' };
    syncReqBadge(); renderAll(); scheduleSave();
    if (typeof onApplied === 'function') onApplied(); // 弹窗里套用时，同步刷新输入框，避免"点了却看不到变化"
    toast('已套用模板：' + name, 'ok');
  }
  // 把要求整理成一段可直接发给客户确认的文本
  function briefToText() {
    const b = briefOf();
    const out = ['【主题 / 故事要点】', b.story || '（未填）'];
    if (b.traits) { out.push('', '【笔法特质（必须用到）】', briefLines(b.traits).map((s, i) => (i + 1) + '. ' + s).join('\n')); }
    if (b.must) { out.push('', '【必须出现的词句】', briefLines(b.must).map((s, i) => (i + 1) + '. ' + s).join('\n')); }
    if (b.avoid) { out.push('', '【不要写什么】', briefLines(b.avoid).map((s, i) => (i + 1) + '. ' + s).join('\n')); }
    if (b.tone) { out.push('', '【口气 / 人称 / 其他】', b.tone); }
    return out.join('\n');
  }
  function copyText(txt) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(() => toast('已复制，可直接发给客户确认', 'ok'), () => fallbackCopy(txt));
    } else fallbackCopy(txt);
    function fallbackCopy(t) {
      const ta = document.createElement('textarea');
      ta.value = t; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast('已复制，可直接发给客户确认', 'ok'); }
      catch (e) { toast('复制失败，请手动选中复制', 'err'); }
      document.body.removeChild(ta);
    }
  }

  function openReqModal(prefill) {
    const body = $('#modal-body'); $('#modal-title').textContent = '🎯 委托要求';
    body.innerHTML = '';
    const tip = el('div', 'sel-style');
    tip.textContent = '填客户 / 委托方给的资料。填好后，续写、整段重生成、写整首、对比 3 版都会自动带上，不用每次重打。留空的项不影响生成。';
    body.appendChild(tip);

    // 模板行：灵感应提取出的要求可存成模板；套用前会提示覆盖
    const tplBar = el('div', 'req-tpl');
    const tplSel = el('select');
    const o0 = el('option'); o0.value = ''; o0.textContent = '（选模板套用）'; tplSel.appendChild(o0);
    const tplList = loadReqTpl();
    tplList.forEach((t) => { const o = el('option'); o.value = t.name; o.textContent = t.name; tplSel.appendChild(o); });
    // 默认选中最近存的那条：重开弹窗时点「套用」直接生效，不必先手动选
    if (tplList.length) tplSel.selectedIndex = 1;
    const tplName = el('input'); tplName.placeholder = '模板名，如：失恋-方文山';
    const bTplApply = el('button', null, '套用');
    const bTplSave = el('button', null, '💾 存为模板');
    const bCopy = el('button', null, '📋 复制为文本');
    bTplApply.addEventListener('click', () => {
      if (!tplSel.value) { toast('先选一个模板', 'err'); return; }
      applyReqTpl(tplSel.value, () => {
        const nb = briefOf();
        taStory.value = nb.story; taMust.value = nb.must; taAvoid.value = nb.avoid;
        taTone.value = nb.tone; taTraits.value = nb.traits || '';
        syncReqBadge();
      });
    });
    bTplSave.addEventListener('click', () => {
      const name = (tplName.value || '').trim();
      if (!name) { toast('先给模板起个名字', 'err'); return; }
      // 取输入框当前值，而不是 state：从灵感刚提取出来、还没点「保存要求」时也应能直接存
      const draft = { story: taStory.value.trim(), must: taMust.value.trim(), avoid: taAvoid.value.trim(), tone: taTone.value.trim() };
      if (!(draft.story || draft.must || draft.avoid || draft.tone)) { toast('还没有可保存的要求内容', 'err'); return; }
      const arr = loadReqTpl().filter((x) => x.name !== name);
      arr.unshift({ name, brief: draft, ts: Date.now() });
      saveReqTpl(arr);
      const o = el('option'); o.value = name; o.textContent = name; tplSel.appendChild(o);
      tplName.value = '';
      tplSel.value = name; // 自动选中刚存的模板，否则点「套用」会作用在占位项上变成空操作
      toast('已存为模板：' + name, 'ok');
    });
    bCopy.addEventListener('click', () => copyText(briefToText()));
    tplBar.append(tplSel, tplName, bTplApply, bTplSave, bCopy);
    body.appendChild(tplBar);

    const mk = (label, ph, key, rows) => {
      const lab = el('label', 'sel-label'); lab.textContent = label;
      const ta = el('textarea', 'sel-note'); ta.rows = rows || 3; ta.placeholder = ph;
      body.append(lab, ta); return ta;
    };
    // prefill 优先（多来自灵感提取），未提供的项沿用原有内容
    const b0 = briefOf();
    const P = prefill || {};
    const taStory = mk('故事 / 主题要点（一行一条，越具体越好）', '例：写异地恋三年，最后在机场分开，副歌要落到「你没回头」这个画面', 'story', 4);
    const taMust = mk('必须出现的词 / 句子（一行一条，必须原样写进歌词）', '例：老藤椅\n你没回头', 'must', 3);
    const taAvoid = mk('不要写什么 / 雷区（一行一条）', '例：不要写「断了」「碎了」这类烂俗词\n不要提真实地名、公司名', 'avoid', 3);
    const taTone = mk('口气 / 人称 / 其他要求', '例：全程第二人称，像在对方耳边说话；不要煽情腔、不要堆形容词', 'tone', 3);
    const taTraits = mk('笔法特质（一行一条：必须用到的写法手法，不写即不违反）', '例：用具体器物承载情绪，不直接抒情\n每段收在画面上，不写总结句', 'traits', 3);
    taStory.value = P.story != null ? P.story : b0.story;
    taMust.value = P.must != null ? P.must : b0.must;
    taAvoid.value = P.avoid != null ? P.avoid : b0.avoid;
    taTone.value = P.tone != null ? P.tone : b0.tone;
    taTraits.value = P.traits != null ? P.traits : b0.traits;

    const actions = el('div', 'sel-actions');
    const bClear = el('button', null, '清空');
    bClear.addEventListener('click', () => { taStory.value = ''; taMust.value = ''; taAvoid.value = ''; taTone.value = ''; taTraits.value = ''; taStory.focus(); });
    const bSave = el('button', 'primary', '保存要求');
    bSave.addEventListener('click', () => {
      const b = briefOf();
      b.story = taStory.value.trim(); b.must = taMust.value.trim();
      b.avoid = taAvoid.value.trim(); b.tone = taTone.value.trim(); b.traits = taTraits.value.trim();
      if (!state.meta) state.meta = { brief: {} };
      if (!state.meta.brief) state.meta.brief = {};
      state.meta.brief = b;
      syncReqBadge(); renderAll(); scheduleSave();
      $('#modal').classList.add('hidden');
      toast(hasBrief() ? '要求已保存，之后每次生成都会带上' : '要求已清空', 'ok');
    });
    const cancel = el('button', null, '取消');
    cancel.addEventListener('click', () => $('#modal').classList.add('hidden'));
    actions.append(bClear, bSave, cancel);
    body.appendChild(actions);
    $('#modal').classList.remove('hidden');
    setTimeout(() => taStory.focus(), 30);
  }

  // ---------- 热门灵感推荐（基于当下热歌提炼的词风 / 主题） ----------
  let HOT = [];
  let STRUCTS = [];
  let INSP_TAB = 'themes'; // themes | structs | favs
  let currentPool = [];    // 当前渲染的数据（含 favs 包装），供按钮按 index 取用
  const FAV_KEY = 'lyric-studio:favs';
  const TPL_KEY = 'lyric-studio:req-templates';
  let RULES = null; // 创作规则（含 breath 气口节），来自 /api/rules，供运行时气口检测按曲风取预算
  let CHART_META = { source: '', updatedAt: null, cached: false }; // 主题灵感来源（实时榜 / 本地缓存）
  async function loadRules() {
    if (RULES) return RULES;
    try { const r = await fetch('/api/rules'); const j = await r.json(); RULES = (j && j.rules) || null; } catch (e) { RULES = null; }
    return RULES;
  }
  // ============ 主题灵感：浏览器端实时抓榜蒸馏（绕开服务端沙箱无外网的限制） ============
  // 蒸馏表：关键词 → 主题 / 情绪（mood 严格对应 index.html 的 ai-mood 九选一）
  const THEME_RULES = [
    { kw: ['爱','恋','喜欢','心动','告白','甜','抱','吻','宠','约'], theme: '爱情里的甜蜜与心动', mood: '温柔' },
    { kw: ['泪','哭','伤','痛','碎','遗憾','错过','分手','断','罪'], theme: '失恋后的心碎与遗憾', mood: '忧伤' },
    { kw: ['想','念','思','忆','回忆','旧','从前','往','记','故'], theme: '对人与往事的思念', mood: '思念' },
    { kw: ['夜','晚','失眠','梦','黑','寂','独','空','寞'], theme: '深夜里的孤独与情绪', mood: '孤寂' },
    { kw: ['流浪','漂泊','远方','旅行','路','离开','他乡','走'], theme: '漂泊远方与自由向往', mood: '欢快' },
    { kw: ['风','雨','雪','海','月','花','阳','星','山','河','云','春','夏','秋','冬','景'], theme: '自然风景里的意象与治愈', mood: '温柔' },
    { kw: ['青春','少年','时光','岁月','成长','老'], theme: '青春岁月与成长感悟', mood: '励志' },
    { kw: ['家','妈','爸','娘','故乡','乡','亲','童'], theme: '亲情与家乡的温柔牵绊', mood: '温柔' },
    { kw: ['燃','战','勇','光','希望','追','飞','强','梦想'], theme: '追梦路上的热血与力量', mood: '热血' },
    { kw: ['放','释','原谅','再见','重来','好','和解'], theme: '释怀与自我和解', mood: '励志' },
    { kw: ['酒','醉','疯','野','浪','酷'], theme: '洒脱不羁的生活态度', mood: '欢快' },
    { kw: ['国风','古风','戏','墨','江南','长安','侠'], theme: '国风意境与古典美学', mood: '豪迈' },
    { kw: ['摇','躁','爆','硬'], theme: '摇滚的力量与躁动', mood: '热血' },
    { kw: ['说唱','rap','diss','flow'], theme: '说唱的态度与节奏', mood: '坚定' },
  ];
  const THEME_LINES = {
    '爱情里的甜蜜与心动': ['把没说出口的喜欢，藏进副歌转音里轻轻托起','让心跳的节拍，正好落在每句尾音的停顿'],
    '失恋后的心碎与遗憾': ['让尾音在副歌高处发抖，像一句没说完的对不起','把没接住的眼泪，写进桥段渐弱的钢琴'],
    '对人与往事的思念': ['用一句重复的副歌，把名字念到发烫','让回忆在间奏里慢慢褪色成背景'],
    '深夜里的孤独与情绪': ['把凌晨三点的空，留白成一句最长的尾音','让城市的霓虹，在副歌里熄成一点微光'],
    '漂泊远方与自由向往': ['把行李和心事都押进同一个韵，走向下一段月台','让远方的风，替我把原地困住的自己吹散'],
    '自然风景里的意象与治愈': ['用一场雨洗掉副歌的燥，留出呼吸的缝隙','把山海写进主歌，让听的人也看见光'],
    '青春岁月与成长感悟': ['把年少那句倔强，留给副歌最高的一声','让时间的尾音，慢慢把伤痕唱成勋章'],
    '亲情与家乡的温柔牵绊': ['把妈妈的话写成最软的一句，藏在 Bridge','让故乡的炊烟，在副歌里慢慢升起'],
    '追梦路上的热血与力量': ['把不服气的那口气，顶成副歌最亮的高音','让每一步鼓点，都踩在往前走的脚印上'],
    '释怀与自我和解': ['把放不下的那句，唱成轻轻松手的尾音','让原谅在副歌里，慢慢长成一束光'],
    '洒脱不羁的生活态度': ['把日子过成押韵的玩笑，不较真也不回头','让酒精和夜色，在副歌里一起晃'],
    '国风意境与古典美学': ['用一笔水墨的留白，写尽江南的烟雨','让古词的仄平，在副歌里落回山河'],
    '摇滚的力量与躁动': ['把积压的喊，砸成副歌最重的那一拍','让失真吉他，替我说完不敢说的狠'],
    '说唱的态度与节奏': ['把态度写进密集的 flow，不喘也不让','让押韵像拳头，一句句砸在节拍点上'],
    '生活里的小感悟': ['把今天一件小事，写成副歌里轻轻晃的尾音','让平淡的日子，也押上一个温柔的韵'],
  };
  const GENRE_HINTS = [
    { kw: ['说唱','rap','diss','flow'], g: 'rap' },
    { kw: ['民谣','folk'], g: 'folk' },
    { kw: ['国风','古风','戏','江南','长安','侠','墨'], g: 'ancient' },
    { kw: ['摇','躁','硬','金属'], g: 'rock' },
  ];
  function classifyTrack(name, artist) {
    const text = (name || '') + ' ' + (artist || '');
    const matches = THEME_RULES.filter((r) => r.kw.some((k) => text.includes(k)));
    const primary = matches[0] || { theme: '生活里的小感悟', mood: '温柔' };
    const secondary = matches.find((r) => r.theme !== primary.theme);
    let genre = '';
    for (const h of GENRE_HINTS) { if (h.kw.some((k) => text.includes(k))) { genre = h.g; break; } }
    const cards = [];
    const make = (r) => {
      const lines = THEME_LINES[r.theme] || ['把此刻的情绪，写成一句能唱出口的真心话'];
      const line = lines[Math.floor(Math.random() * lines.length)];
      cards.push({ source: (name || '未知') + (artist ? ' - ' + artist : ''), genre, mood: r.mood, theme: r.theme, tags: ['实时榜单'], tip: line });
    };
    make(primary);
    if (secondary) make(secondary);
    return cards;
  }
  // 浏览器端友好的国内榜单源（CORS 开放、国内可达）；解析兼容多种返回结构。
  // 抓取策略：① 直连 vvhan 三端点 → ② 若被 CORS/网络拦截，走 CORS 代理（codetabs / allorigins）补 CORS 头兜底。
  const CHART_DIRECT = [
    { name: '网易云音乐热歌榜', url: 'https://api.vvhan.com/api/music/rank?type=wy' },
    { name: 'QQ音乐热歌榜', url: 'https://api.vvhan.com/api/music/rank?type=qq' },
    { name: '酷狗音乐热歌榜', url: 'https://api.vvhan.com/api/music/rank?type=kg' },
  ];
  const CHART_PROXIES = [
    (u) => 'https://api.codetabs.com/v1/proxy/?quest=' + encodeURIComponent(u),
    (u) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
  ];
  const CHART_SOURCES = CHART_DIRECT.concat(
    CHART_PROXIES.flatMap((px) => CHART_DIRECT.map((s) => ({ name: s.name + '（代理）', url: px(s.url) })))
  );
  function extractTracks(j) {
    let arr = null;
    if (Array.isArray(j)) arr = j;
    else if (j) {
      if (Array.isArray(j.data)) arr = j.data;
      else if (j.data && Array.isArray(j.data.list)) arr = j.data.list;
      else if (j.data && Array.isArray(j.data.data)) arr = j.data.data;
      else if (j.data && Array.isArray(j.data.tracks)) arr = j.data.tracks;
      else if (Array.isArray(j.result && j.result.tracks)) arr = j.result.tracks;
      else if (Array.isArray(j.playlist && j.playlist.tracks)) arr = j.playlist.tracks;
      else if (Array.isArray(j.songList)) arr = j.songList;
      else if (j.data && Array.isArray(j.data.songList)) arr = j.data.songList;
      else if (Array.isArray(j.list)) arr = j.list;
    }
    if (!arr) return [];
    const pickArtist = (v) => {
      if (!v) return '';
      if (Array.isArray(v)) return v.map((s) => (s && (s.name || s)) || '').join('/');
      return String(v);
    };
    return arr.map((t) => ({
      name: t.name || t.title || t.song || t.songname || '',
      artist: pickArtist(t.artist || t.singer || t.singers || t.author || (Array.isArray(t.artists) ? t.artists : '')) || '',
    })).filter((t) => t.name);
  }
  const CHART_CACHE_KEY = 'lyric-studio:charts';
  // 本地 6 小时缓存：避免面板反复打服务端；后台定时采集让素材常新，切动作仅在检测到新抓取内容时按需触发
  const CHART_TTL = 6 * 60 * 60 * 1000;
  let CHART_LAST_ERR = '';
  // 采集（拉榜+抓歌词）定时跑、素材常新；切（切片+金句+AI 归纳）按需触发，且仅在检测到新抓取内容时才跑。
  // 全量切要跑近两小时，单次请求等不到头。这里每次只取「当前已归纳到的增量」，
  // 浏览器端每 30 秒轮询一次，池子边跑边变厚，不再靠一个超时硬等。
  let CHART_POLL = null;     // 高频轮询：切进行中每 30s 追增量
  let CHART_WATCH = null;    // 低频回探：切跑完后每 5min 查一次服务器是否采集到新内容（hasNew）
  // 切进行中：高频轮询拿增量；跑完就切到低频回探，让面板在有新素材时能按需再切而不空转打服务端
  function stopChartPoll() { if (CHART_POLL) { clearInterval(CHART_POLL); CHART_POLL = null; } if (!CHART_WATCH) startChartWatch(); }
  function startChartPoll() { if (CHART_WATCH) { clearInterval(CHART_WATCH); CHART_WATCH = null; } if (CHART_POLL) return; CHART_POLL = setInterval(async () => {
      try {
        const r = await fetch('/api/charts');
        if (!r.ok) return;
        const j = await r.json();
        const items = (j && Array.isArray(j.items)) ? j.items : [];
        if (!items.length) { if (j && !j.running) stopChartPoll(); return; }
        // 蒸馏跑完了就停高频轮询、切低频回探，否则会一直空转打服务端
        if (j && !j.running) stopChartPoll();
        // loadCharts(true) 会写 HOT / CHART_META / localStorage 并重绘面板
        await loadCharts(true);
      } catch (e) { /* 轮询失败静默重试，下一轮再来 */ }
    }, 30000); }
  // 低频回探：蒸馏跑完后每 5 分钟轻量打一次服务端，若发现「服务器已开始新一轮重蒸馏」或
  // 「池子 updatedAt 比本地新」就接管高频轮询，让后台的「一直更新」能反映到面板。
  function stopChartWatch() { if (CHART_WATCH) { clearInterval(CHART_WATCH); CHART_WATCH = null; } }
  function startChartWatch() {
    if (CHART_WATCH) return;
    CHART_WATCH = setInterval(async () => {
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 8000);
        const r = await fetch('/api/charts', { signal: ctrl.signal });
        clearTimeout(to);
        if (!r.ok) return;
        const j = await r.json();
        const newer = j.updatedAt && CHART_META && CHART_META.updatedAt && j.updatedAt > CHART_META.updatedAt;
        const fresh = j.hasNew && !j.running;   // 服务器采集到了新内容且当前没在切 → 按需触发切
        if (j.running || newer || fresh) { stopChartWatch(); await loadCharts(true); if (j.running) startChartPoll(); }
      } catch (e) { /* 回探失败静默重试 */ }
    }, 5 * 60 * 1000);
  }
  // 轻量回探：发现服务器采集到了新内容（hasNew）且未在切，则触发一次「切」
  async function probeNewMaterial() {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 8000);
      const r = await fetch('/api/charts', { signal: ctrl.signal });
      clearTimeout(to);
      if (!r.ok) return;
      const j = await r.json();
      if (j && j.hasNew && !j.running) { await loadCharts(true); }
    } catch (e) { /* 回探失败静默 */ }
  }
  async function fetchLiveCharts() {
    CHART_LAST_ERR = '';
    // 主路径：服务端灵感管道（采集定时跑；切=切片+金句+AI 归纳，主题名从金句归纳，池子上限不再受 15 个 bucket 限制）。
    // 首次打开面板且检测到新抓取内容时，会触发一趟全量切（约 1-1.6 小时）；期间的面板内容由本地池顶着。
    try {
      const ctrl = new AbortController();
      // 服务端现在不阻塞：无素材时立即返回 running（后台采集），有切时立即返回 running（后台蒸馏）。
      // 这里 15 秒只是连接级安全上限，正常几毫秒就返回，不会触发。
      const to = setTimeout(() => ctrl.abort(), 15000);
      const r = await fetch('/api/charts', { signal: ctrl.signal });
      clearTimeout(to);
      if (r.ok) {
        const j = await r.json();
        if (j && j.ok) {
          const items = Array.isArray(j.items) ? j.items : [];
          const running = !!j.running;
          const prog = running ? '（蒸馏中 ' + (j.done || 0) + '/' + (j.total || 0) + ' 首）' : '';
          if (items.length) {
            if (running) startChartPoll();
            return { items, source: (j.source || '实时榜单') + prog, running };
          }
          // 还没产出的第一批，别空手回落本地池，交给轮询等下一轮
          if (running) { startChartPoll(); return null; }
          return { items, source: (j.source || '实时榜单') + (j.cached ? '（缓存）' : ''), running };
        }
      }
    } catch (e) {
      CHART_LAST_ERR = '服务端蒸馏管道暂不可用：' + e.message;
    }
    // 兜底：浏览器直连第三方榜单（多数源在本机已被阻断，保留只为换环境时可用）
    for (const src of CHART_SOURCES) {
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 6000);
        const r = await fetch(src.url, { signal: ctrl.signal, headers: { 'Accept': 'application/json' } });
        clearTimeout(to);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json();
        const tracks = extractTracks(j);
        if (tracks.length) {
          const items = [];
          for (const tr of tracks) classifyTrack(tr.name, tr.artist).forEach((c) => items.push(c));
          if (items.length) return { items, source: src.name };
        }
      } catch (e) {
        CHART_LAST_ERR = (CHART_LAST_ERR ? CHART_LAST_ERR + '；' : '') + src.name + '：' + e.message;
        console.warn('[charts] 抓取失败 ' + src.name + '：' + e.message);
      }
    }
    return null;
  }
  // 主题灵感：浏览器端实时抓榜蒸馏；带 10 分钟 localStorage 缓存；失败回退本地静态池
  async function loadCharts(force) {
    if (!force) {
      try {
        const raw = localStorage.getItem(CHART_CACHE_KEY);
        if (raw) {
          const c = JSON.parse(raw);
          if (c && c.items && c.ts && Date.now() - c.ts < CHART_TTL) {
            HOT = c.items; CHART_META = { source: c.source, updatedAt: c.ts, cached: true };
            // 本地缓存期内：轻量回探服务器是否采集到新内容，有则触发「切」（按需 + 有新内容才切）
            if (!CHART_POLL && !CHART_WATCH) { probeNewMaterial(); startChartWatch(); }
            return HOT;
          }
        }
      } catch (e) {}
    }
    const live = await fetchLiveCharts();
    if (live) {
      HOT = live.items;
      CHART_META = { source: live.source, updatedAt: Date.now(), cached: false, running: !!live.running };
      try { localStorage.setItem(CHART_CACHE_KEY, JSON.stringify({ ts: CHART_META.updatedAt, source: live.source, items: live.items })); } catch (e) {}
      // 蒸馏进行中→高频轮询；否则确保低频回探在跑，让后台的持续更新能反映到面板
      if (live.running) startChartPoll(); else if (!CHART_POLL) startChartWatch();
      return HOT;
    }
    // 蒸馏还在跑、但这一轮还没有新条目：保留现有池子，等下一轮轮询补上，不要退回静态池
    if (CHART_POLL && HOT.length) return HOT;
    await loadHot();
    CHART_META = { source: 'local-cache', updatedAt: null, cached: false, error: CHART_LAST_ERR };
    return HOT;
  }
  async function loadHot() {
    if (HOT.length) return HOT;
    try { const r = await fetch('data/hot-themes.json'); const j = await r.json(); HOT = (j && j.items) || []; }
    catch (e) { HOT = []; }
    return HOT;
  }
  async function loadStructs() {
    if (STRUCTS.length) return STRUCTS;
    try { const r = await fetch('data/hot-structures.json'); const j = await r.json(); STRUCTS = (j && j.items) || []; }
    catch (e) { STRUCTS = []; }
    return STRUCTS;
  }
  function loadFavs() { try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); } catch (e) { return []; } }
  function saveFavs(a) { try { localStorage.setItem(FAV_KEY, JSON.stringify(a)); } catch (e) {} }
  // 自动收录：灵感库里的主题不用手动点 ★ 就全部存进「我的收藏」。
  // 手动取消过的（itemKey）记进排除表，实时榜刷新后不会被再次自动加回。
  const AUTO_FAV_OFF_KEY = 'lyric-studio:autoFavOff';
  const AUTO_FAV_ON_KEY = 'lyric-studio:autoFavOn';
  const AUTO_FAV_MAX = 200;  // 实时榜条目异常变多时的收录上限，避免收藏区被刷爆
  // 注意：歌词蒸馏管道一次可产出上百条不重名主题，全量自动收藏后 themes tab 会被抽空（既定规则的结果，
  // 非缺陷）。逃生口有两个：收藏区取消几个 ★，或在灵感面板关掉「自动收藏」开关。
  function loadAutoFavOff() { try { return JSON.parse(localStorage.getItem(AUTO_FAV_OFF_KEY) || '[]'); } catch (e) { return []; } }
  function saveAutoFavOff(a) { try { localStorage.setItem(AUTO_FAV_OFF_KEY, JSON.stringify(a)); } catch (e) {} }
  // 总开关：关掉后主题不再自动进收藏区，「换一批」也就有牌可抽了
  function loadAutoFavOn() { const v = localStorage.getItem(AUTO_FAV_ON_KEY); return v === null ? true : v === '1'; }
  function saveAutoFavOn(v) { try { localStorage.setItem(AUTO_FAV_ON_KEY, v ? '1' : '0'); } catch (e) {} }
  // 把当前灵感库（HOT）里的主题全部收进收藏区，返回新增条数
  function ensureAutoFavs() {
    if (!loadAutoFavOn()) return 0;
    const pool = HOT || [];
    if (!pool || !pool.length) return 0;
    const favs = loadFavs();
    const have = new Set(favs.map((f) => itemKey(f.kind, f.item)));
    const offSet = new Set(loadAutoFavOff());
    let added = 0;
    pool.slice(0, AUTO_FAV_MAX).forEach((it) => {
      const kind = 'themes';
      const k = itemKey(kind, it);
      if (have.has(k) || offSet.has(k)) return;
      favs.push({ kind, item: it, auto: true });
      have.add(k); added += 1;
    });
    if (added) saveFavs(favs);
    return added;
  }
  function itemKey(kind, it) { return kind + ':' + (it.source ? it.source + '|' + it.theme : it.type + '|' + it.example); }
  function shuffleArr(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  // 换一批不重复 —— 硬排除，不做任何轮替：
  // 候选池严格等于「未收藏 ∧ 未手动取消 ∧ 本轮会话未发过」的牌。
  // 「已收藏」只当排除表用，永远不会作为补位池被抽到；凑不满就少给，抽空就空着。
  const INSP_DECKS = {}; // tab -> 打乱后待发队列（pop 取用）
  const INSP_SEEN = {};  // tab -> 已发过的 key 集合
  // 当前还能抽的牌（不含：手动收藏 / 手动取消过 / 本轮已发的）。
  // 关键：自动收录项（auto:true）只在「自动收藏」总开关开启时才挡住抽卡；
  // 关掉总开关后，它们仍留在「我的收藏」里，但可被换一批重新抽到 —— 这样切开关不会让条目凭空消失。
  function availPool(pool, kind) {
    const favs = loadFavs();
    const autoFavOn = loadAutoFavOn();
    const offSet = new Set(loadAutoFavOff());
    const seen = INSP_SEEN[kind] || new Set();
    return shuffleArr(pool).filter((it) => {
      const k = itemKey(kind, it);
      if (offSet.has(k) || seen.has(k)) return false;
      const fav = favs.find((f) => itemKey(f.kind, f.item) === k);
      // 手动收藏（auto:false/undefined）永远挡住抽卡；自动收录项仅当总开关开时挡住
      if (fav && !(fav.auto && !autoFavOn)) return false;
      return true;
    });
  }
  function pickN(pool, n) {
    if (!pool || !pool.length) return [];
    const kind = INSP_TAB;
    if (!INSP_SEEN[kind]) INSP_SEEN[kind] = new Set();
    if (!INSP_DECKS[kind] || INSP_DECKS[kind].length < n) {
      // 池里够就抽够，不够就正好给这么多 —— 已收藏的一条都不放进来
      INSP_DECKS[kind] = availPool(pool, kind);
    }
    const chosen = [];
    while (chosen.length < n && INSP_DECKS[kind].length) {
      const it = INSP_DECKS[kind].pop();
      if (!it) break;
      const k = itemKey(kind, it);
      if (INSP_SEEN[kind].has(k)) continue;
      chosen.push(it);
      INSP_SEEN[kind].add(k);
    }
    return chosen;
  }
  // 主题灵感：先用本地/缓存秒开面板，再后台拉实时榜覆盖（避免慢网时空白等待）
  async function loadThemesInstant() {
    if (HOT.length) return;
    try {
      const raw = localStorage.getItem(CHART_CACHE_KEY);
      if (raw) { const c = JSON.parse(raw); if (c && c.items && c.ts && Date.now() - c.ts < CHART_TTL) { HOT = c.items; CHART_META = { source: c.source, updatedAt: c.ts, cached: true }; return; } }
    } catch (e) {}
    await loadHot();
    CHART_META = { source: 'local-cache', updatedAt: null, cached: false };
  }
  async function openInspire() {
    const sec = $('#inspire'); if (!sec) return;
    sec.classList.remove('hidden');
    if (!STRUCTS.length) await loadStructs();
    if (INSP_TAB === 'themes') {
      await loadThemesInstant();      // 先用本地/缓存秒开
      renderInspire();
      loadCharts(false).then(() => {   // 后台拉实时榜，回来后覆盖重渲
        if (INSP_TAB === 'themes' && !sec.classList.contains('hidden')) {
          // 只重洗牌堆，保留「已发过」的记录：拉到新榜时新条目自然登场，
          // 拉不到则继续给没展示过的旧牌。清空会让已经看过的牌被洗回来。
          INSP_DECKS.themes = null;
          renderInspire();
        }
      });
    } else {
      renderInspire();
    }
  }
  function cardHtml(kind, item, i) {
    const isTheme = kind === 'theme' || kind === 'themes';
    const favs = loadFavs();
    const isFav = favs.some((f) => (f.kind === kind || (isTheme && (f.kind === 'theme' || f.kind === 'themes'))) && itemKey(kind, item) === itemKey(f.kind, f.item));
    const favBtn = '<button class="insp-fav' + (isFav ? ' on' : '') + '" data-i="' + i + '" title="收藏 / 取消">★</button>';
    if (isTheme) {
      const chips = [];
      if (item.genre) chips.push(GENRES[item.genre] || item.genre);
      if (item.mood) chips.push(item.mood);
      const chipHtml = chips.map((c) => '<span class="insp-chip">' + esc(c) + '</span>').join('');
      const tagHtml = (item.tags || []).map((t) => '<span class="insp-tag">' + esc(t) + '</span>').join('');
      const tipHtml = item.tip ? '<div class="insp-tip">💡 ' + esc(item.tip) + '</div>' : '';
      // 灵感自带的「笔法特质 / 必留意象 / 雷区」：写清楚这张灵感到底要求什么，避免只能靠猜
      const traitHtml = (item.traits || []).map((t) => '<li>' + esc(t) + '</li>').join('');
      const traitBlock = traitHtml ? '<div class="insp-sec insp-traits"><b>笔法特质</b><ul>' + traitHtml + '</ul></div>' : '';
      const mustList = Array.isArray(item.must) ? item.must.filter(Boolean) : [];
      const mustBlock = mustList.length ? '<div class="insp-sec insp-must"><b>必留意象</b>' + mustList.map((m) => '<span class="insp-mustchip">' + esc(m) + '</span>').join('') + '</div>' : '';
      const avoidList = Array.isArray(item.avoid) ? item.avoid.filter(Boolean) : [];
      const avoidBlock = avoidList.length ? '<div class="insp-sec insp-avoid"><b>雷区（不写）</b><ul>' + avoidList.map((m) => '<li>' + esc(m) + '</li>').join('') + '</ul></div>' : '';
      return '<div class="insp-card">'
        + favBtn
        + '<div class="insp-src">来源热歌：' + esc(item.source || '') + '</div>'
        + '<div class="insp-theme">' + esc(item.theme || '') + '</div>'
        + '<div class="insp-chips">' + chipHtml + '</div>'
        + tipHtml
        + traitBlock + mustBlock + avoidBlock
        + '<div class="insp-tags">' + tagHtml + '</div>'
        + '<div class="insp-btns">'
        + '<button class="primary sm insp-apply" data-i="' + i + '">应用此灵感</button>'
        + '<button class="ghost sm" data-i="' + i + '" data-openreq="1" title="打开「🎯 要求」查看这条灵感带来的完整约束（可另存模板）">🔍 查看要求</button>'
        + '</div>'
        + '</div>';
    }
    // 句式骨架（纯描述）
    const tagHtml = (item.tags || []).map((t) => '<span class="insp-tag">' + esc(t) + '</span>').join('');
    const fit = item.fitSection ? '适用：' + item.fitSection : '';
    const grp = item.group ? '<span class="insp-group">' + esc(item.group) + '</span>' : '';
    return '<div class="insp-card">'
      + favBtn
      + '<div class="insp-type">' + esc(item.type || '句式') + grp + '</div>'
      + '<div class="insp-mech"><b>节奏机制</b>：' + esc(item.mechanism || '') + '</div>'
      + '<div class="insp-example">例：' + esc(item.example || '') + '</div>'
      + '<div class="insp-fit">' + esc(fit) + '</div>'
      + '<div class="insp-tags">' + tagHtml + '</div>'
      + '<div class="insp-btns">'
      + '<button class="primary sm insp-apply" data-i="' + i + '">套用此句式</button>'
      + '<button class="ghost sm insp-rewrite" data-i="' + i + '">✦ AI 改写</button>'
      + '</div>'
      + '</div>';
  }
  function renderInspire() {
    const list = $('#inspire-list'); if (!list) return;
    // 顶部来源状态条：明确告知这是实时榜单还是本地缓存
    const st = $('#inspire-status');
    if (st) {
      if (INSP_TAB === 'themes') {
        if (CHART_META.source === 'local-cache') {
          const why = CHART_META.error ? '（' + CHART_META.error.slice(0, 80) + '）' : '';
          st.innerHTML = '📦 本地缓存主题（实时榜暂不可达，已自动降级）' + why;
          st.className = 'inspire-status warn';
        } else {
          const tm = CHART_META.updatedAt ? new Date(CHART_META.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '';
          st.innerHTML = '🔴 实时榜单：' + esc(CHART_META.source) + (tm ? ' · 更新于 ' + tm : '') + (CHART_META.cached ? '（10 分钟内缓存）' : '（刚刚刷新）');
          st.className = 'inspire-status live';
        }
        st.style.display = '';
      } else {
        st.style.display = 'none';
      }
    }
    // 主题灵感全部自动进收藏区，不需要手动点 ★（排除了手动取消过的）
    if (INSP_TAB === 'themes') ensureAutoFavs();
    // 「换一批」只在抽卡的两个 tab 有意义，收藏区是全量列表
    const rBtn = $('#inspire-refresh');
    if (rBtn) rBtn.style.display = (INSP_TAB === 'favs') ? 'none' : '';
    if (INSP_TAB === 'favs') {
      currentPool = loadFavs(); // 每项 {kind, item}，主题灵感已全部自动收录
      list.classList.add('scroll-y');
      const autoN = currentPool.filter((f) => f.auto).length;
      const note = '<div class="inspire-note">📌 灵感库里的主题已全部自动收录到这里（' + autoN + ' 条），不需要手动点 ★。手动取消过的不会再自动加回；其中「手动收藏」永远不参与换一批，而「自动收录」项仅在「自动收藏」开关开启时不参与换一批（关掉开关后它们会被换一批抽到，但始终留在这里）。</div>';
      if (!currentPool.length) { list.innerHTML = note + '<div class="empty">暂无收藏。主题灵感会自动收录在这里，也可在「句式骨架」手动 ★。</div>'; return; }
      list.innerHTML = note + currentPool.map((e, i) => cardHtml(e.kind, e.item, i)).join('');
    } else {
      list.classList.remove('scroll-y');
      const pool = INSP_TAB === 'themes' ? HOT : STRUCTS;
      if (!pool || !pool.length) { list.innerHTML = '<div class="empty">' + (INSP_TAB === 'themes' ? '主题灵感暂不可用（无法加载 data/hot-themes.json）' : '句式骨架暂不可用（无法加载 data/hot-structures.json）') + '</div>'; return; }
      currentPool = pickN(pool, 6);
      if (!currentPool.length && INSP_TAB === 'themes') {
        // 全部主题都在收藏区里 → 硬排除后候选池为空，这是规则写死的必然结果，不是 bug。
        // 逃生口：一键关闭自动收藏，themes tab 立刻恢复可抽（再点一次可重新开启）。
        const on = loadAutoFavOn();
        const placeholder = on
          ? '<div class="inspire-note">🎯 灵感库里的主题已全部收进「我的收藏」，按你定的规则「已收藏的不再出现」，所以这里已没有可抽的新主题。</div>'
            + '<div class="inspire-note" style="background:#fff6e5;border-color:#f0c36d;color:#7a5a12">要继续换一批：点下面关掉自动收藏，或去收藏区取消几个 ★（取消过的会回到抽卡池）。</div>'
          : '<div class="inspire-note">自动收藏已关闭，灵感库里的主题没有进收藏区，因此可以正常抽卡。</div>';
        list.innerHTML = placeholder
          + '<div style="padding:8px 4px"><button id="unfav-all" class="btn" style="width:100%">'
          + (on ? '↩ 关闭自动收藏，恢复换一批' : '↪ 重新开启自动收藏') + '</button></div>';
        const ua = $('#unfav-all');
        if (ua) ua.addEventListener('click', () => {
          // 只切「自动收藏」总开关：不再硬删 auto 条目（旧逻辑 filter(!f.auto) 会在关→开之间把条目永久丢失）。
          // 开关关闭时，availPool 不再把 auto 条目当排除项，换一批即可抽到；开启时它们照旧挡住抽卡但始终留在收藏区。
          saveAutoFavOn(!loadAutoFavOn());
          INSP_SEEN.themes = new Set();
          INSP_DECKS.themes = null;
          renderInspire();
        });
        return;
      }
      list.innerHTML = currentPool.map((e, i) => cardHtml(INSP_TAB, e, i)).join('');
    }
    list.querySelectorAll('.insp-apply').forEach((b) => b.addEventListener('click', () => {
      const e = currentPool[+b.dataset.i];
      if (INSP_TAB === 'favs') ((e.kind === 'theme' || e.kind === 'themes') ? applyRecommend : applyStruct)(e.item);
      else (INSP_TAB === 'themes' ? applyRecommend : applyStruct)(e);
    }));
    // 「🔍 查看要求」：把这张灵感解析成完整约束，打开要求弹窗给客户看，可选存模板
    list.querySelectorAll('[data-openreq]').forEach((b) => b.addEventListener('click', () => {
      if (INSP_TAB === 'themes' || (INSP_TAB === 'favs' && currentPool[+b.dataset.i] && currentPool[+b.dataset.i].kind === 'themes')) {
        openReqModal(inspireToBrief(currentPool[+b.dataset.i].item || currentPool[+b.dataset.i]), { view: true });
      } else { toast('句式骨架没有主题约束，请到「主题灵感」查看', 'warn'); }
    }));
    list.querySelectorAll('.insp-fav').forEach((b) => b.addEventListener('click', () => {
      const e = currentPool[+b.dataset.i];
      toggleFav(INSP_TAB === 'favs' ? e.kind : INSP_TAB, INSP_TAB === 'favs' ? e.item : e, +b.dataset.i);
    }));
    list.querySelectorAll('.insp-rewrite').forEach((b) => b.addEventListener('click', () => {
      const e = currentPool[+b.dataset.i];
      openStructRewrite(INSP_TAB === 'favs' ? e.item : e);
    }));
  }
  function toggleFav(kind, item, idx) {
    const favs = loadFavs();
    const key = itemKey(kind, item);
    const fi = favs.findIndex((f) => itemKey(f.kind, f.item) === key);
    let turnedOn = false;
    if (fi >= 0) {
      const wasAuto = !!favs[fi].auto;
      favs.splice(fi, 1);
      // 手动取消的自动收录项写进排除表，否则下次刷新实时榜又会被自动加回来
      if (wasAuto) {
        const off = loadAutoFavOff();
        if (off.indexOf(key) < 0) off.push(key);
        saveAutoFavOff(off);
      }
      toast(wasAuto ? '已取消收藏（不再自动收录）' : '已取消收藏', '');
    }
    else { favs.push({ kind, item }); toast('已收藏（刷新不丢）', 'ok'); turnedOn = true; }
    saveFavs(favs);
    // 不重新随机抽：仅切换被点星标，避免刚收藏/取消的项从视图里消失；唯「我的收藏」里取消时才整体重渲染
    if (INSP_TAB === 'favs' && !turnedOn) { renderInspire(); return; }
    const btn = document.querySelector('.insp-fav[data-i="' + idx + '"]');
    if (btn) btn.classList.toggle('on', turnedOn);
  }
  // 把一张主题灵感解析成「🎯 要求」内容（只解析不写 state，供「查看要求」预览给客户看）
  function inspireToBrief(rec) {
    if (!rec) return null;
    const lines = [];
    lines.push('主题 / 情绪：' + (rec.theme || ''));
    if (rec.source) lines.push('客户的参考感觉（热歌）：' + rec.source);
    const tags = Array.isArray(rec.tags) && rec.tags.length ? rec.tags.join('、') : '';
    if (tags) lines.push('这类主题的典型意象关键词：' + tags);
    const tone = [];
    if (rec.mood) tone.push('情绪基调：' + rec.mood);
    if (rec.genre) tone.push('曲风：' + (GENRES[rec.genre] || rec.genre));
    return {
      story: lines.join('\n'),
      tone: tone.join('；'),
      must: (Array.isArray(rec.must) ? rec.must : []).join('\n'),
      avoid: (Array.isArray(rec.avoid) ? rec.avoid : []).join('\n'),
      traits: (Array.isArray(rec.traits) ? rec.traits : []).join('\n')
    };
  }
  // 追加去重写进 brief：灵感带来的特质/必留词/雷区不覆盖用户原有内容，重复的不重复堆叠
  function mergeBriefLines(cur, arr) {
    const out = briefLines(cur);
    (Array.isArray(arr) ? arr : []).forEach((x) => {
      const t = String(x || '').trim();
      if (!t) return;
      const dup = out.some((o) => o === t ||
        (Math.abs(o.length - t.length) > 1 && (o.indexOf(t) >= 0 || t.indexOf(o) >= 0)));
      if (!dup) out.push(t);
    });
    return out.join('\n');
  }
  function applyRecommend(rec) {
    if (!rec) return;
    if (rec.genre) { const g = $('#ai-genre'); if (g) { g.value = rec.genre; g.dispatchEvent(new Event('change')); } }
    if (rec.mood) applyMood(rec.mood);
    if (rec.theme) { state.meta.theme = rec.theme; scheduleSave(); }
    // 灵感自带的笔法特质 / 必留意象 / 雷区 → 一并写进「🎯 要求」的硬性约束
    const b = briefOf();
    const next = {
      story: b.story,
      tone: b.tone,
      traits: mergeBriefLines(b.traits, rec.traits),
      must: mergeBriefLines(b.must, rec.must),
      avoid: mergeBriefLines(b.avoid, rec.avoid)
    };
    let added = 0;
    ['traits', 'must', 'avoid'].forEach((k) => { added += briefLines(next[k]).length - briefLines(b[k]).length; });
    state.meta.brief = next;
    syncReqBadge(); renderAll(); scheduleSave();
    const parts = [];
    if (rec.genre) parts.push(GENRES[rec.genre] || '流行');
    if (rec.mood) parts.push(rec.mood);
    if (rec.theme) parts.push('主题：' + rec.theme);
    if (added > 0) parts.push('已带入 ' + added + ' 条特质 / 必留 / 雷区');
    else parts.push('要求无新增（内容已存在）');
    // 应用灵感是「追加」语义，连着用几条就会层层堆积，必须让用户看见总量
    const total = briefLines(next.must).length;
    if (total >= MUST_WARN_AT) parts.push('⚠ 必留词已累计 ' + total + ' 条，建议先「清空」再生成');
    toast('已应用灵感：' + parts.join(' · '), total >= MUST_WARN_AT ? 'err' : 'ok');
  }
  // 套用句式：把成品例句填入当前聚焦的那一行（先点正文某行），无聚焦则填入首个空行；不覆盖有内容的行以外之处
  function applyStruct(item) {
    if (!item) return;
    let inp = document.querySelector('.line-input:focus');
    if (!inp) {
      const empties = Array.from(document.querySelectorAll('.block .line .line-input')).filter((e) => !e.value.trim());
      inp = empties[0] || document.querySelector('.block .line .line-input');
    }
    if (!inp) { toast('正文中还没有行，请先添加段落', 'warn'); return; }
    inp.value = item.example || '';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    toast('已套用句式：' + (item.type || '句式') + '（可在此基础上改写）', 'ok');
  }

  // 按指定句式骨架，让 AI 把用户「不太符合的字句」改写成符合该句式的歌词
  function openStructRewrite(item) {
    if (!item || !item.mechanism) { toast('主题灵感没有句式改写，请切到「句式骨架」使用', 'warn'); return; }
    const body = $('#modal-body'); $('#modal-title').textContent = '按此句式 · AI 改写';
    body.innerHTML = '';
    const info = el('div', 'sel-style');
    info.innerHTML = '目标句式：<b>' + esc(item.type || '') + '</b>（' + esc(item.group || '') + '）<br>节奏机制：' + esc(item.mechanism || '') + '<br>参考范例：' + esc(item.example || '');
    const label = el('label', 'sel-label'); label.textContent = '把你想改写、还不太符合这个句式的字句贴进来：';
    const ta = el('textarea', 'rw-ta'); ta.placeholder = '例如：随便写的两句，没节奏也没对仗……';
    const tagLabel = el('label', 'sel-label'); tagLabel.textContent = '附加要求（可选）：';
    const taNote = el('textarea', 'sel-note'); taNote.placeholder = '如：更口语 / 更伤感 / 押 ang 韵 / 保留「海」字';
    const actions = el('div', 'sel-actions');
    const bGo = el('button', 'primary', '✦ 改写成此句式');
    const outWrap = el('div', 'rw-out-wrap');
    outWrap.innerHTML = '<div class="sel-label">改写结果</div><div class="rw-out" id="rw-out">⏳ 等待生成…</div>';
    const bFill = el('button', null, '填入正文'); bFill.disabled = true;
    const bCopy = el('button', null, '复制'); bCopy.disabled = true;
    const cancel = el('button', null, '取消');
    actions.append(bGo, bFill, bCopy, cancel);
    body.append(info, label, ta, tagLabel, taNote, outWrap, actions);
    let lastText = '';
    bGo.addEventListener('click', async () => {
      const src = ta.value.trim();
      if (!src) { toast('先贴上要改写的字句', 'err'); return; }
      const prev = bGo.textContent; bGo.disabled = true; bGo.textContent = '生成中…';
      const outEl = $('#rw-out'); outEl.textContent = '⏳ 生成中…';
      const note = taNote.value.trim();
      const instruction = '请将下面这句/这段歌词改写成【' + (item.type || '指定') + '】句式。\n'
        + '该句式的节奏机制：' + (item.mechanism || '') + '\n'
        + '参考范例：' + (item.example || '') + '\n'
        + '要求：保留原意与情感，使其严格符合上述句式的节奏、对称与字数规律，成为自然、可唱的歌词；'
        + (note ? '附加要求：' + note + '；' : '')
        + '只输出改写后的歌词（每行一句），不要解释、不要加引号、不要写“以下是”。\n'
        + '原句：\n' + src;
      try {
        const r = await fetch('/api/ai/suggest', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(aiBody(src, (themeHint() ? themeHint() + '\n' : '') + instruction, '', '')),
        });
        const j = await r.json();
        if (j.ok && j.text) {
          lastText = cleanAiText(j.text);
          outEl.textContent = lastText;
          bFill.disabled = false; bCopy.disabled = false;
          toast('AI 已改写成此句式', 'ok');
        } else { outEl.textContent = '生成失败：' + (j.message || ''); }
      } catch (e) { outEl.textContent = '请求失败：' + e.message; }
      finally { bGo.disabled = false; bGo.textContent = prev; }
    });
    bFill.addEventListener('click', () => { if (lastText) { fillStructResult(lastText); $('#modal').classList.add('hidden'); } });
    bCopy.addEventListener('click', () => { if (lastText && navigator.clipboard) { navigator.clipboard.writeText(lastText).then(() => toast('已复制', 'ok'), () => toast('复制失败', 'err')); } });
    cancel.addEventListener('click', () => $('#modal').classList.add('hidden'));
    $('#modal').classList.remove('hidden');
    setTimeout(() => ta.focus(), 30);
  }
  // 把改写结果（可能多行）回填到正文：从聚焦行开始逐行填入，跳过锁定金句，不够则追加
  function fillStructResult(text) {
    const lines = cleanAiText(text).split('\n').map((t) => t.trim()).filter(Boolean);
    if (!lines.length) { toast('没有可填入的内容', 'err'); return; }
    let inp = document.querySelector('.line-input:focus') || lastFocusedInput;
    let block = null, startIdx = 0;
    if (inp && inp.closest) {
      const row = inp.closest('.line'); const wrap = inp.closest('.block');
      if (row && wrap && wrap.dataset.id) { block = findBlock(wrap.dataset.id); startIdx = +row.dataset.idx || 0; }
    }
    if (!block) {
      block = state.blocks[0];
      if (block) {
        const empties = block.lines.map((l, i) => ({ l, i })).filter((x) => !x.l.text.trim());
        startIdx = empties.length ? empties[0].i : block.lines.length;
      }
    }
    if (!block) { toast('请先在正文添加段落', 'err'); return; }
    let i = startIdx;
    for (const t of lines) {
      while (i < block.lines.length && block.lines[i].locked) i++;
      if (i < block.lines.length) block.lines[i] = { text: t, note: '' };
      else block.lines.push({ text: t, note: '' });
      i++;
    }
    renderAll(); scheduleSave();
    toast('已填入正文（' + lines.length + ' 行）', 'ok');
  }

  // 把 AI 返回的一整首歌解析成多个段落块（按【主歌】等标题切分）
  function parseSong(text) {
    const hRe = /^\s*[【\[（(]?\s*(主歌|副歌|桥段|导歌|前奏|间奏|尾奏|Verse|Chorus|Bridge|Pre-?Chorus|Intro|Outro|Interlude)\s*[\d一二三四五六七八九十百0-9]*\s*[）\]】)]?\s*[:：]?\s*$/i;
    const stripTag = /^\s*[【\[（(]\s*(主歌|副歌|桥段|导歌|前奏|间奏|尾奏|Verse|Chorus|Bridge|Pre-?Chorus|Intro|Outro|Interlude)\b[】\)\]）]\s*/i;
    const typeOf = (s) => {
      s = s.toLowerCase();
      if (/主歌|verse/.test(s)) return 'verse';
      if (/副歌|chorus/.test(s)) return 'chorus';
      if (/桥段|bridge/.test(s)) return 'bridge';
      if (/导歌|pre-?chorus/.test(s)) return 'pre';
      if (/前奏|intro/.test(s)) return 'intro';
      if (/间奏|interlude/.test(s)) return 'inter';
      if (/尾奏|outro/.test(s)) return 'outro';
      return 'verse';
    };
    const labelOf = (s) => {
      s = s.toLowerCase();
      if (/主歌|verse/.test(s)) return '主歌';
      if (/副歌|chorus/.test(s)) return '副歌';
      if (/桥段|bridge/.test(s)) return '桥段';
      if (/导歌|pre-?chorus/.test(s)) return '导歌';
      if (/前奏|intro/.test(s)) return '前奏';
      if (/间奏|interlude/.test(s)) return '间奏';
      if (/尾奏|outro/.test(s)) return '尾奏';
      return '段落';
    };
    const blocks = [];
    let cur = null;
    for (const raw of (text || '').split('\n')) {
      const m = raw.match(hRe);
      if (m) {
        const label = labelOf(m[1]);
        cur = { type: typeOf(m[1]), label, name: label, lines: [] };
        blocks.push(cur);
        continue;
      }
      const t = raw.replace(stripTag, '').trim();
      if (!t) continue;
      if (!cur) { cur = { type: 'verse', label: '主歌', name: '主歌', lines: [] }; blocks.push(cur); }
      cur.lines.push({ text: t, note: '' });
    }
    const out = blocks.filter((b) => b.lines.length);
    const cnt = {};
    for (const b of out) {
      cnt[b.label] = (cnt[b.label] || 0) + 1;
      b.name = cnt[b.label] > 1 ? `${b.label} ${cnt[b.label]}` : b.label;
      b.id = uid();
    }
    if (!out.length) out.push({ id: uid(), type: 'verse', label: '主歌', name: '主歌', lines: [{ text: '', note: '' }] });
    return out;
  }

  // ---------- 设置（AI 提供方） ----------
  async function loadSettings() {
    try {
      const r = await fetch('/api/settings'); const j = await r.json();
      currentProvider = j.provider || 'ark';
      const sp = $('#set-provider'); if (sp) sp.value = currentProvider;
      if ($('#set-ark-model')) $('#set-ark-model').value = j.arkModel || 'ark-code-latest';
      if ($('#set-ark-base')) $('#set-ark-base').value = j.arkBase || 'https://ark.cn-beijing.volces.com/api/coding/v3';
      if ($('#set-ollama-base')) $('#set-ollama-base').value = j.ollamaBase || 'http://127.0.0.1:11434';
      if ($('#set-openai-key')) $('#set-openai-key').value = j.openaiApiKey || '';
      if ($('#set-openai-model')) $('#set-openai-model').value = j.openaiModel || '';
      if ($('#set-openai-base')) $('#set-openai-base').value = j.openaiBase || '';
      toggleProviderFields();
    } catch {}
  }
  function toggleProviderFields() {
    const p = $('#set-provider').value;
    $('#set-ark-fields').style.display = p === 'ark' ? '' : 'none';
    $('#set-openai-fields').style.display = p === 'openai' ? '' : 'none';
    $('#set-ollama-fields').style.display = p === 'ollama' ? '' : 'none';
  }
  function openSettings() { $('#settings-modal').classList.remove('hidden'); loadSettings(); const m = $('#set-msg'); m.textContent = ''; m.className = 'set-msg'; }
  async function saveSettings() {
    const payload = {
      provider: $('#set-provider').value,
      arkApiKey: $('#set-ark-key').value,
      arkModel: $('#set-ark-model').value.trim(),
      arkBase: $('#set-ark-base').value.trim(),
      ollamaBase: $('#set-ollama-base').value.trim(),
      openaiApiKey: $('#set-openai-key').value,
      openaiModel: $('#set-openai-model').value.trim(),
      openaiBase: $('#set-openai-base').value.trim(),
    };
    const m = $('#set-msg');
    try {
      const r = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const j = await r.json();
      if (j.ok) { currentProvider = payload.provider; m.textContent = '已保存'; m.className = 'set-msg ok'; toast('AI 设置已保存', 'ok'); checkAiStatus(); setTimeout(() => $('#settings-modal').classList.add('hidden'), 600); }
      else { m.textContent = j.message || '保存失败'; m.className = 'set-msg err'; }
    } catch (e) { m.textContent = '保存失败：' + e.message; m.className = 'set-msg err'; }
  }

  // ---------- 存档 ----------
  async function saveToServer() {
    state.meta.title = $('#meta-title').value;
    if (!state.id) state.id = 'song_' + Date.now().toString(36);
    try {
      const r = await fetch('/api/songs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) });
      const j = await r.json();
      if (j.ok) toast('已保存到本机服务：' + state.id, 'ok');
      else toast('保存失败：' + (j.message || ''), 'err');
    } catch (e) { toast('保存失败：' + e.message, 'err'); }
  }
  async function openLoadModal() {
    const body = $('#modal-body'); $('#modal-title').textContent = '打开存档';
    body.innerHTML = '加载中…'; $('#modal').classList.remove('hidden');
    try {
      const r = await fetch('/api/songs'); const j = await r.json();
      const list = j.songs || [];
      if (!list.length) { body.innerHTML = '<div class="empty">暂无服务器存档。点「保存」可存一份到本机服务。</div>'; return; }
      body.innerHTML = '';
      list.forEach((s) => {
        const item = el('div', 'song-item');
        const left = el('div');
        left.innerHTML = `<div class="t">${esc(s.title)}</div><div class="d">${esc(s.id)} · ${(s.updatedAt || '').replace('T', ' ').slice(0, 16)}</div>`;
        const open = el('button', null, '打开'); open.addEventListener('click', (ev) => { ev.stopPropagation(); loadSong(s.id); });
        const del = el('button', 'del', '删除'); del.addEventListener('click', (ev) => { ev.stopPropagation(); deleteSong(s.id); });
        item.append(left, open, del); item.addEventListener('click', () => loadSong(s.id)); body.appendChild(item);
      });
    } catch (e) { body.innerHTML = '<div class="empty">读取失败：' + esc(e.message) + '</div>'; }
  }
  async function loadSong(id) {
    try {
      const r = await fetch('/api/songs/' + encodeURIComponent(id));
      const j = await r.json();
      if (j && j.meta) { state = normalizeDoc(j); renderAll(); scheduleSave(); $('#modal').classList.add('hidden'); toast('已打开：' + (j.meta.title || id), 'ok'); }
      else toast('存档为空或格式错误', 'err');
    } catch (e) { toast('打开失败：' + e.message, 'err'); }
  }
  async function deleteSong(id) {
    if (!window.confirm('确认删除存档 ' + id + '？')) return;
    try {
      const r = await fetch('/api/songs/' + encodeURIComponent(id), { method: 'DELETE' });
      const j = await r.json();
      if (j.ok) { toast('已删除', 'ok'); openLoadModal(); } else toast('删除失败', 'err');
    } catch (e) { toast('删除失败：' + e.message, 'err'); }
  }
  function normalizeDoc(j) {
    const d = newDoc();
    d.id = j.id || null;
    d.meta = Object.assign(d.meta, j.meta || {});
    d.meta.singer = Object.assign({ gender: '', register: '', timbre: '', name: '' }, (j.meta && j.meta.singer) || {});
    if (Array.isArray(j.blocks) && j.blocks.length) {
      d.blocks = j.blocks.map((b) => {
        let lines = [];
        if (Array.isArray(b.lines) && b.lines.length) lines = b.lines.map((l) => ({ text: (l && l.text) || '', note: (l && l.note) || '' }));
        else if (typeof b.text === 'string' && b.text) lines = b.text.split('\n').map((t) => ({ text: t, note: '' }));
        else lines = [{ text: '', note: '' }];
        return { id: b.id || uid(), type: b.type || 'verse', name: b.name || '', lines };
      });
    }
    return d;
  }

  // ---------- 导出 ----------
  function exportTxt() {
    let out = '';
    if (state.meta.title) out += '《' + state.meta.title + '》\n';
    const sub = [state.meta.author && ('作词：' + state.meta.author), state.meta.key && ('调式：' + state.meta.key), state.meta.bpm && (state.meta.bpm + ' BPM')].filter(Boolean);
    const s = state.meta.singer || {};
    const singerStr = [s.name, s.gender, s.register, s.timbre].filter(Boolean).join(' · ');
    if (singerStr) sub.push('演唱：' + singerStr);
    if (sub.length) out += sub.join('   ') + '\n';
    out += '\n';
    for (const b of state.blocks) {
      out += '【' + typeLabel(b.type) + (b.name ? '·' + b.name : '') + '】\n';
      out += b.lines.map((l) => l.text).join('\n') + '\n\n';
    }
    const blob = new Blob([out], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = (state.meta.title || 'lyric') + '.txt'; a.click(); URL.revokeObjectURL(a.href);
    toast('已导出 txt', 'ok');
  }
  function newSong() {
    if (!window.confirm('新建会清空当前内容（已自动保存的草稿仍在浏览器中）。继续？')) return;
    state = newDoc(); renderAll(); scheduleSave();
  }

  // ---------- 导出到 Suno / Udio（考虑 AI 音乐软件限制） ----------
  // 段落类型 -> Suno 结构标签
  const SUNO_TAG = { verse: 'Verse', chorus: 'Chorus', bridge: 'Bridge', pre: 'Pre-Chorus', intro: 'Intro', inter: 'Instrumental', outro: 'Outro' };
  function sunoStyle(platform) {
    const s = state.meta.singer || {};
    const parts = [];
    if (state.meta.genre) parts.push(state.meta.genre);
    const g = s.gender || '';
    if (g === '男声') parts.push('male vocals');
    else if (g === '女声') parts.push('female vocals');
    else if (g === '组合') parts.push('group vocals');
    if (platform === 'udio') parts.push('Mandarin vocals'); // Udio 风格框加「中文演唱」标签
    if (s.timbre) parts.push(s.timbre);
    if (state.meta.mood) parts.push(state.meta.mood);
    if (state.meta.energy) parts.push(state.meta.energy);
    if (state.meta.bpm) parts.push(state.meta.bpm + ' BPM');
    if (state.meta.key) parts.push('key ' + state.meta.key);
    return parts.join(', ');
  }
  function buildSuno(platform) {
    const counters = { Verse: 0, Chorus: 0 };
    const out = [];
    const warnings = [];
    let totalChars = 0, trailingPunct = 0;
    const longLines = [];
    const PUNCT = /[，。！？；：、,.!?;:\s]+$/;
    const isWord = (c) => !/[　\s，。！？；：、,.!?;:]/.test(c);
    for (const b of state.blocks) {
      const base = SUNO_TAG[b.type] || 'Verse';
      let tag = base;
      if (base === 'Verse') { counters.Verse++; tag = 'Verse ' + counters.Verse; }
      else if (base === 'Chorus') { counters.Chorus++; tag = 'Chorus ' + counters.Chorus; }
      out.push('[' + tag + ']');
      const lines = b.lines.map((l) => (l.text || '').trim()).filter(Boolean);
      let prev = null;
      for (const raw of lines) {
        const before = raw;
        const ln = raw.replace(PUNCT, '');
        if (ln !== before) trailingPunct++;
        const cc = [...ln].filter(isWord).length;
        totalChars += cc;
        if (cc > 14) longLines.push(ln + '（' + cc + '字）');
        if (prev && ln && ln === prev) warnings.push('相邻重复行（Suno 可能循环）：' + ln);
        prev = ln;
        out.push(ln);
      }
      if (lines.length > 10) warnings.push('段落「' + tag + '」' + lines.length + ' 行偏多（Suno 建议每段≤8-10行，否则易忽略或仓促）');
      if (lines.length === 0 && base !== 'Instrumental') warnings.push('段落「' + tag + '」没有歌词（空段落）');
      out.push('');
    }
    if (trailingPunct) warnings.push(trailingPunct + ' 行已自动去掉行尾标点（Suno 演唱更稳）');
    if (longLines.length) warnings.push('以下行偏长、可能赶拍吞字，建议拆分：' + longLines.slice(0, 6).join('；'));
    if (totalChars > 400) warnings.push('总字数约 ' + totalChars + '，偏多（3分钟歌建议≈200-400字），可能赶拍，建议删减或拆分段落');
    else if (totalChars > 0 && totalChars < 60) warnings.push('总字数约 ' + totalChars + '，偏少（Suno 可能重复段落），建议补充');
    return { text: out.join('\n').replace(/\n+$/, '\n'), style: sunoStyle(platform), warnings, totalChars };
  }
  function exportSuno() {
    let platform = 'suno';
    const body = $('#modal-body'); $('#modal-title').textContent = '导出到 AI 音乐软件';
    body.innerHTML = '';
    // 平台切换：Suno 与 Udio 结构标签写法一致，仅风格框名称不同
    const plat = el('div', 'suno-plat');
    plat.innerHTML = '<label>目标平台<select id="suno-plat-sel">' +
      '<option value="suno">Suno</option>' +
      '<option value="udio">Udio</option></select></label>';
    body.append(plat);
    const styleBox = el('div', 'suno-style');
    const rep = el('div', 'suno-report');
    const lyr = el('textarea', 'suno-lyrics'); lyr.readOnly = true;
    const acts = el('div', 'suno-acts');
    body.append(styleBox, rep, lyr, acts);

    function refresh() {
      const { text, style, warnings, totalChars } = buildSuno(platform);
      const isUdio = platform === 'udio';
      const boxName = isUdio ? 'Style of Music（音乐风格）框' : 'Style（风格）框';
      const platNote = isUdio
        ? 'Udio：歌词粘到「Lyrics」框、风格粘到「Style of Music」框；结构标签 [Verse]/[Chorus]… 写法与 Suno 一致。'
        : 'Suno：歌词直接粘到歌词框、风格填到「Style」框；结构标签 [Verse]/[Chorus]… 必不可少。';
      styleBox.innerHTML = '<div class="suno-label">建议填到 ' + boxName + '：</div>' +
        '<div class="suno-style-text">' + (style ? esc(style) : '（未设置，建议在「信息」里填曲风 / 演唱者 / 情绪）') + '</div>' +
        '<div class="suno-note">' + platNote + ' 两家都不识别具体歌手名（如周杰伦），已用其性别/音色代替（male/female vocals）。</div>';
      rep.innerHTML = '<div class="suno-label">适配检查（总字数 ≈' + totalChars + '，3分钟建议 200-400 字，每段≤8-10行）：</div>' +
        (warnings.length ? '<ul class="suno-warn">' + warnings.map((w) => '<li>' + esc(w) + '</li>').join('') + '</ul>' : '<div class="suno-ok">✓ 未发现明显超限，可直接复制</div>');
      lyr.value = text;
    }
    const sel = plat.querySelector('#suno-plat-sel');
    sel.addEventListener('change', () => { platform = sel.value; refresh(); });
    const bCopy = el('button', 'primary', '复制歌词');
    bCopy.addEventListener('click', () => { navigator.clipboard.writeText(lyr.value).then(() => toast('已复制歌词', 'ok')).catch(() => toast('复制失败', 'err')); });
    const bCopyStyle = el('button', null, '复制 Style');
    bCopyStyle.addEventListener('click', () => { navigator.clipboard.writeText(styleBox.querySelector('.suno-style-text').textContent).then(() => toast('已复制 Style', 'ok')).catch(() => toast('复制失败', 'err')); });
    const bDown = el('button', null, '下载 .txt');
    bDown.addEventListener('click', () => { const blob = new Blob([lyr.value], { type: 'text/plain;charset=utf-8' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = (state.meta.title || 'lyric') + '-' + platform + '.txt'; a.click(); URL.revokeObjectURL(a.href); toast('已下载 ' + platform + ' 歌词', 'ok'); });
    acts.append(bCopy, bCopyStyle, bDown);
    refresh();
    $('#modal').classList.remove('hidden');
  }

  // ---------- 情绪 → 韵脚推荐（功能⑤） ----------
  function applyMood(v) {
    const sel = $('#ai-mood'); if (sel) sel.value = v || '';
    state.meta.mood = v || '';
    renderMoodRhyme();
    scheduleSave();
  }
  function renderMoodRhyme() {
    const box = $('#mood-rhyme'); if (!box) return;
    const v = state.meta.mood || '';
    if (!v || !MOOD_ZHE[v]) { box.style.display = 'none'; box.innerHTML = ''; return; }
    box.style.display = '';
    box.innerHTML = `🎯 情绪：<b>${esc(v)}</b> → 推荐押韵（十三辙）：${MOOD_ZHE[v].map((z) => `<span class="mz">${esc(z)}</span>`).join('')}`;
  }

  // ---------- 版权存证（功能⑧，纯前端离线） ----------
  const COPY_KEY = 'lyric-studio:copyright';
  function loadCopyright() { try { return JSON.parse(localStorage.getItem(COPY_KEY)) || []; } catch { return []; } }
  function saveCopyright(list) { try { localStorage.setItem(COPY_KEY, JSON.stringify(list)); } catch {} }
  function allLyricsText() {
    let out = '';
    if (state.meta.title) out += '《' + state.meta.title + '》\n';
    for (const b of state.blocks) {
      out += '【' + typeLabel(b.type) + (b.name ? ('·' + b.name) : '') + '】\n';
      out += b.lines.map((l) => l.text).filter(Boolean).join('\n') + '\n\n';
    }
    return out.replace(/\n+$/, '\n');
  }
  async function sha256Text(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  function copyCardHTML(rec, local, utc) {
    const stmt = `本人声明：于 ${local}（UTC ${utc}）创作完成作品《${rec.title}》（共 ${rec.blocks} 段 / ${rec.lines} 句 / ${rec.chars} 字）。该作品内容的 SHA-256 哈希为 ${rec.hash}，可作为创作完成时间与内容完整性的存证。`;
    return '<div class="copy-grid">' +
      '<div class="cp"><span>作品</span><b>' + esc(rec.title) + '</b></div>' +
      '<div class="cp"><span>作者</span><b>' + esc(rec.author || '—') + '</b></div>' +
      '<div class="cp"><span>段落 / 句 / 字</span><b>' + rec.blocks + ' / ' + rec.lines + ' / ' + rec.chars + '</b></div>' +
      '<div class="cp"><span>本地时间</span><b>' + esc(local) + '</b></div>' +
      '<div class="cp"><span>UTC</span><b>' + esc(utc) + '</b></div>' +
      '<div class="cp cph"><span>SHA-256</span><code>' + esc(rec.hash) + '</code></div>' +
      '</div><div class="copy-stmt">' + esc(stmt) + '</div>';
  }
  function renderCopyHist() {
    const box = $('#copy-hist'); if (!box) return;
    const list = loadCopyright();
    if (!list.length) { box.innerHTML = '<div class="empty" style="padding:10px">暂无历史存证</div>'; return; }
    const cur = allLyricsText();
    box.innerHTML = '';
    list.forEach((r) => {
      const item = el('div', 'copy-hist-item');
      const t = new Date(r.ts).toLocaleString('zh-CN', { hour12: false });
      item.innerHTML = '<div class="ch-info"><div class="ch-t">' + esc(r.title || '未命名') + ' · ' + esc(t) + '</div><div class="ch-h">' + esc((r.hash || '').slice(0, 16)) + '…</div></div>';
      const b = el('button', 'sm', '校验');
      b.addEventListener('click', async () => {
        const h = await sha256Text(cur);
        if (h === r.hash) toast('校验通过：当前歌词与存证 ' + t + ' 内容一致 ✓', 'ok');
        else toast('内容已变动：当前哈希与存证不一致 ✗', 'err');
      });
      item.appendChild(b); box.appendChild(item);
    });
  }
  function downloadCopy(rec, kind) {
    let content, name, type;
    if (kind === 'json') {
      content = JSON.stringify({
        title: rec.title, author: rec.author, createdAt: rec.ts,
        hash: rec.hash, chars: rec.chars, lines: rec.lines, blocks: rec.blocks,
        statement: `SHA-256(${rec.hash}) attests the lyric content existed at ${rec.ts}.`,
        lyrics: rec.text,
      }, null, 2);
      name = (rec.title || 'lyric') + '-版权存证.json'; type = 'application/json';
    } else {
      content = '版权存证\n作品：《' + rec.title + '》\n作者：' + (rec.author || '—') +
        '\n创作时间（本地）：' + new Date(rec.ts).toLocaleString('zh-CN', { hour12: false }) +
        '\n创作时间（UTC）：' + rec.ts +
        '\n段落 / 句 / 字数：' + rec.blocks + ' / ' + rec.lines + ' / ' + rec.chars +
        '\nSHA-256：' + rec.hash +
        '\n\n声明：上述 SHA-256 哈希对应下方歌词内容，可作为创作完成时间与内容完整性的存证。\n\n========== 歌词 ==========\n' + rec.text;
      name = (rec.title || 'lyric') + '-版权存证.txt'; type = 'text/plain;charset=utf-8';
    }
    const blob = new Blob([content], { type });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
    URL.revokeObjectURL(a.href);
    toast('已下载 ' + kind + ' 存证', 'ok');
  }
  async function openCopyright() {
    const body = $('#modal-body'); $('#modal-title').textContent = '版权存证';
    body.innerHTML = '';
    const tip = el('div', 'sel-style'); tip.textContent = '为当前歌词生成一份「创作完成时间 + 内容哈希」的离线存证。SHA-256 哈希可证明此内容在此时已存在；日后若歌词被改动，重算哈希会与存证不一致。存证仅落本机（localStorage）与可导出的文件，不上传任何服务器。';
    const card = el('div', 'copy-card'); card.id = 'copy-card';
    const list = el('div', 'copy-list');
    list.innerHTML = '<div class="sel-label">历史存证（可校验是否改动）</div><div id="copy-hist" class="copy-hist"></div>';
    const acts = el('div', 'sel-actions');
    const bGen = el('button', 'primary', '生成并存证');
    const bTxt = el('button', null, '下载 .txt');
    const bJson = el('button', null, '下载 .json');
    acts.append(bGen, bTxt, bJson);
    body.append(tip, card, list, acts);
    $('#modal').classList.remove('hidden');
    renderCopyHist();
    const txt = allLyricsText();
    if (!txt.trim()) { card.innerHTML = '<div class="empty">还没有可存证的歌词，先写几句吧。</div>'; bGen.disabled = true; bTxt.disabled = true; bJson.disabled = true; return; }
    bGen.disabled = true; bGen.textContent = '计算中…';
    const hash = await sha256Text(txt);
    const now = new Date();
    const local = now.toLocaleString('zh-CN', { hour12: false });
    const utc = now.toISOString();
    const chars = [...txt].filter((c) => !/\s/.test(c)).length;
    let lines = 0; const blocks = state.blocks.length;
    for (const b of state.blocks) lines += b.lines.filter((l) => (l.text || '').trim()).length;
    const rec = { ts: now.toISOString(), title: state.meta.title || '未命名', author: state.meta.author || '', chars, lines, blocks, hash, text: txt };
    card.innerHTML = copyCardHTML(rec, local, utc);
    bGen.disabled = false; bGen.textContent = '生成并存证';
    bGen.addEventListener('click', () => {
      const all = loadCopyright();
      all.unshift({ ts: rec.ts, title: rec.title, hash: rec.hash, chars: rec.chars, lines: rec.lines, blocks: rec.blocks });
      saveCopyright(all.slice(0, 30));
      renderCopyHist();
      toast('已存证（本机）', 'ok');
    });
    bTxt.addEventListener('click', () => downloadCopy(rec, 'txt'));
    bJson.addEventListener('click', () => downloadCopy(rec, 'json'));
  }

  // ---------- 事件绑定 ----------
  function bind() {
    $('#btn-add').addEventListener('click', () => { state.blocks.push({ id: uid(), type: 'verse', name: '', lines: [{ text: '', note: '' }] }); renderAll(); scheduleSave(); });
    $('#btn-save').addEventListener('click', saveToServer);
    $('#btn-load').addEventListener('click', openLoadModal);
    $('#btn-export').addEventListener('click', exportTxt);
    $('#btn-suno').addEventListener('click', exportSuno);
    $('#btn-new').addEventListener('click', newSong);
    $('#btn-info').addEventListener('click', openInfo);
    $('#info-close').addEventListener('click', () => $('#info-modal').classList.add('hidden'));
    $('#info-modal').addEventListener('click', (e) => { if (e.target.id === 'info-modal') $('#info-modal').classList.add('hidden'); });
    $('#ai-status').addEventListener('click', () => { if (currentProvider === 'ark' && !arkReady) openSettings(); else checkAiStatus(); });
    $('#btn-settings').addEventListener('click', openSettings);
    $('#settings-close').addEventListener('click', () => $('#settings-modal').classList.add('hidden'));
    $('#settings-modal').addEventListener('click', (e) => { if (e.target.id === 'settings-modal') $('#settings-modal').classList.add('hidden'); });
    $('#set-provider').addEventListener('change', toggleProviderFields);
    $('#set-save').addEventListener('click', saveSettings);
    $('#set-cancel').addEventListener('click', () => $('#settings-modal').classList.add('hidden'));

    $('#meta-title').addEventListener('input', (e) => { state.meta.title = e.target.value; scheduleSave(); });
    ['author', 'key', 'bpm', 'meter', 'genre', 'mood'].forEach((k) => $('#meta-' + k).addEventListener('input', (e) => { state.meta[k] = e.target.value; scheduleSave(); }));
    $('#singer-name').addEventListener('input', (e) => { state.meta.singer.name = e.target.value; scheduleSave(); });
    $('#singer-gender').addEventListener('change', (e) => { state.meta.singer.gender = e.target.value; scheduleSave(); syncSingerSelect(); });
    $('#singer-register').addEventListener('change', (e) => { state.meta.singer.register = e.target.value; scheduleSave(); syncSingerSelect(); });
    $('#singer-timbre').addEventListener('input', (e) => { state.meta.singer.timbre = e.target.value; scheduleSave(); });

    const singerSel = $('#ai-singer');
    SINGERS.forEach((x) => { const o = el('option'); o.value = x.v; o.textContent = x.name; singerSel.appendChild(o); });
    singerSel.addEventListener('change', () => {
      const v = singerSel.value;
      if (v === 'custom') { openInfo(); return; }
      const p = SINGERS.find((x) => x.v === v);
      if (!p) return;
      applySinger(v);
      // 联动词人风格：若该歌手有常合作词人、且当前还是「原声」，自动匹配
      if (p.style && currentStyle === 'none') {
        currentStyle = p.style;
        $('#ai-style').value = currentStyle;
        toast('已为「' + p.name + '」匹配词人风格：' + ((STYLES[currentStyle] || {}).name || ''));
      } else {
        toast('演唱者：' + p.name);
      }
    });

    $('#tg-rhyme').addEventListener('change', refreshAnalysisAll);
    $('#tg-pingze').addEventListener('change', refreshAnalysisAll);
    $('#tg-rhythm').addEventListener('change', refreshAnalysisAll);
    $('#tg-melody').addEventListener('change', refreshAnalysisAll);
    $('#btn-lexicon').addEventListener('click', openLexicon);
    $('#btn-copyright').addEventListener('click', openCopyright);
    const moodSel = $('#ai-mood');
    if (moodSel) { moodSel.value = state.meta.mood || ''; moodSel.addEventListener('change', () => applyMood(moodSel.value)); }

    const styleSel = $('#ai-style');
    renderStyleOptions();
    loadStyles(); // 异步从服务端拉取词人列表（内置库 + 自定义库）填充下拉
    const clBtn = $('#btn-custom-lyricist'); if (clBtn) clBtn.addEventListener('click', openCustomLyricist);
    styleSel.addEventListener('change', () => {
      currentStyle = styleSel.value;
      const st = STYLES[currentStyle];
      toast('词人风格：' + (st && st.name ? st.name : '原声 / 自由'));
      // 联动演唱者：该风格有默认歌手、且当前尚未选演唱者时自动匹配（SINGERS.style 为中文名）
      if (st && st.name) {
        const cur = state.meta.singer || {};
        if (!cur.name) {
          const sg = SINGERS.find((x) => x.style === st.name);
          if (sg) { applySinger(sg.v); toast('已为「' + st.name + '」匹配演唱者：' + sg.name + '（可在「信息」里改）'); }
        }
      }
    });

    // 曲风 / 语种：写词时连同「写词人」一起注入 AI 提示词，决定押韵体系与行文逻辑
    const genreSel = $('#ai-genre');
    if (genreSel) {
      genreSel.value = state.meta.genre || '';
      genreSel.addEventListener('change', () => { state.meta.genre = genreSel.value; scheduleSave(); toast('曲风：' + (GENRES[genreSel.value] || '流行')); });
    }
    const langSel = $('#ai-lang');
    if (langSel) {
      langSel.value = state.meta.language || 'zh';
      langSel.addEventListener('change', () => {
        state.meta.language = langSel.value; scheduleSave();
        refreshInlineAll(); refreshAnalysisAll();
        toast('语种：' + (LANGS[langSel.value] || '中文'));
      });
    }
    const energySel = $('#ai-energy');
    if (energySel) {
      energySel.value = state.meta.energy || '';
      energySel.addEventListener('change', () => {
        state.meta.energy = energySel.value; scheduleSave();
        const L = { soft: '柔和 / 抒情', '': '标准', energetic: '有力', hard: '炸裂 / 硬核' };
        toast('能量：' + (L[energySel.value] || '标准'));
      });
    }

    // 主条「✦ 写整首」静态按钮（已在 HTML 中）
    $('#btn-ai-song').addEventListener('click', aiInspire);
    // 更多菜单切换（点击外部收起）
    const moreBtn = $('#btn-more'), morePop = $('#more-pop');
    if (moreBtn && morePop) {
      moreBtn.addEventListener('click', (e) => { e.stopPropagation(); morePop.classList.toggle('hidden'); });
      document.addEventListener('click', (e) => { if (!morePop.contains(e.target) && e.target !== moreBtn) morePop.classList.add('hidden'); });
    }
    // 灵感面板
    $('#btn-inspire').addEventListener('click', openInspire);
    // 🎯 委托要求：客户资料填入后自动带入每次生成
    const bReq = $('#btn-req');
    if (bReq) { bReq.addEventListener('click', openReqModal); syncReqBadge(); }
    $('#inspire-refresh').addEventListener('click', () => {
      const btn = $('#inspire-refresh');
      if (btn) btn.textContent = '刷新中…';
      // 换一批不清空「已发过」的记录：否则等于纯随机重抽，第二批会直接撞上一批。
      // 保留它，抽卡才会优先给没展示过的；「已收藏」只作硬排除，永不参与补位。
      const reshuffle = (tab) => { INSP_DECKS[tab] = null; renderInspire(); }; // 只重置牌堆，保留 INSP_SEEN
      if (INSP_TAB === 'themes') {
        const tagOf = (arr) => (arr && arr.length ? itemKey('themes', arr[0]) + '#' + arr.length : '');
        const before = tagOf(HOT);
        // 先立刻用本地灵感库换一批：网络不通时也要有反应，不能卡在「刷新中…」
        reshuffle('themes');
        if (btn) btn.textContent = '🔄 换一批';
        loadCharts(true).then((hot) => {
          if (btn) btn.textContent = '🔄 换一批';
          // 只有榜单真的变了才再换一次，否则会白白多闪一次
          if (INSP_TAB !== 'themes') return;
          if (tagOf(hot) !== before) reshuffle('themes');
        });
      } else {
        reshuffle(INSP_TAB);
        if (btn) btn.textContent = '🔄 换一批';
      }
    });
    $('#inspire-close').addEventListener('click', () => $('#inspire').classList.add('hidden'));
    document.querySelectorAll('.insp-tab').forEach((t) => t.addEventListener('click', () => {
      INSP_TAB = t.dataset.tab;
      document.querySelectorAll('.insp-tab').forEach((x) => x.classList.toggle('active', x === t));
      renderInspire();
    }));

    $('#modal-close').addEventListener('click', () => $('#modal').classList.add('hidden'));
    $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') $('#modal').classList.add('hidden'); });
    // 流行实测器
    const pmBtn = $('#btn-popmetric'); if (pmBtn) pmBtn.addEventListener('click', openPopMetric);
    const pmRun = $('#popmetric-run'); if (pmRun) pmRun.addEventListener('click', runPopMetric);
    const pmClear = $('#popmetric-clear'); if (pmClear) pmClear.addEventListener('click', clearPopMetrics);
    const pmSample = $('#popmetric-sample'); if (pmSample) pmSample.addEventListener('click', popMetricFillSample);
    const pmClose = $('#popmetric-close'); if (pmClose) pmClose.addEventListener('click', () => { const m = $('#popmetric-modal'); if (m) m.classList.add('hidden'); });
    const pmModal = $('#popmetric-modal'); if (pmModal) pmModal.addEventListener('click', (e) => { if (e.target.id === 'popmetric-modal') pmModal.classList.add('hidden'); });
  }

  function refreshAnalysisAll() {
    document.querySelectorAll('.block').forEach((wrap) => {
      const b = findBlock(wrap.dataset.id); if (!b) return;
      wrap.querySelectorAll('.line').forEach((row, i) => {
        const analysis = row.querySelector('.line-analysis');
        if (analysis && b.lines[i]) renderLineAnalysis(analysis, b.lines[i].text);
      });
    });
  }

  // ---------- 流行实测器（文本指标引擎：用真实热歌校准节奏/旋律规则） ----------
  // 边界：纯歌词文本只能实测 句长/字密度/韵密度/断句率/句尾四声；BPM·切分·倒字率·音域 属音频特征，需文献支撑（见 rules.json.popEvidence）
  const POP_METRIC_KEY = 'lyric-studio:popmetrics';
  const PM_TONES = { 1: '阴平', 2: '阳平', 3: '上声', 4: '去声', 0: '轻' };
  function analyzePopLyrics(text, genre) {
    if (!window.Pinyin || !window.Pinyin.analyzeLine) return { error: '拼音引擎未加载' };
    const lines = (text || '').split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (!lines.length) return { error: '请粘贴歌词（每行一句）' };
    const P = window.Pinyin;
    const charArr = [], tailTone = { 1: 0, 2: 0, 3: 0, 4: 0, 0: 0 }, zheCount = {};
    let withBreak = 0;
    for (let i = 0; i < lines.length; i++) {
      const a = P.analyzeLine(lines[i]);
      const han = a.chars.filter(function (c) { return !c.punct; });
      const n = han.length;
      if (!n) continue;
      charArr.push(n);
      const last = han[han.length - 1];
      const raw = last.py ? parseInt(String(last.py).slice(-1), 10) : 0;
      const t = (raw >= 1 && raw <= 4) ? raw : 0;
      tailTone[t]++;
      const fin = last.py ? P.getFinal(last.py) : '';
      const z = fin ? P.getZhe(fin) : '';
      if (z && z !== '其他') zheCount[z] = (zheCount[z] || 0) + 1;
      if (a.chars.some(function (c) { return c.punct; })) withBreak++;
    }
    const nLines = charArr.length;
    if (!nLines) return { error: '未检测到有效中文歌词行' };
    const sum = charArr.reduce(function (a, b) { return a + b; }, 0);
    const avg = sum / nLines;
    const sorted = charArr.slice().sort(function (a, b) { return a - b; });
    const median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
    const min = sorted[0], max = sorted[sorted.length - 1];
    let domZhe = '', domN = 0;
    for (const k in zheCount) { if (zheCount[k] > domN) { domN = zheCount[k]; domZhe = k; } }
    const rhymeRate = Math.round(domN / nLines * 100);
    const breakRate = Math.round(withBreak / nLines * 100);
    const tt = tailTone[1] + tailTone[2] + tailTone[3] + tailTone[4] + tailTone[0];
    const tailDist = tt ? {
      1: Math.round(tailTone[1] / tt * 100), 2: Math.round(tailTone[2] / tt * 100),
      3: Math.round(tailTone[3] / tt * 100), 4: Math.round(tailTone[4] / tt * 100), 0: Math.round(tailTone[0] / tt * 100)
    } : {};
    return { nLines: nLines, avg: Math.round(avg * 10) / 10, median: median, min: min, max: max,
      rhymeRate: rhymeRate, breakRate: breakRate, tailDist: tailDist, domZhe: domZhe, domN: domN };
  }
  function getPopMetrics() { try { return JSON.parse(localStorage.getItem(POP_METRIC_KEY) || '[]'); } catch (e) { return []; } }
  function renderPopDashboard() {
    const el = $('#popmetric-dash'); if (!el) return;
    const arr = getPopMetrics();
    if (!arr.length) { el.innerHTML = '<div class="pm-empty">尚无累积样本。粘贴热歌歌词 → 分析 → 「记入累积」，样本越多越准（建议 ≥30 首再做规则校准）。</div>'; return; }
    let sumAvg = 0, sumRhyme = 0, sumBreak = 0; const tail = { 1: 0, 2: 0, 3: 0, 4: 0, 0: 0 }; const n = arr.length;
    arr.forEach(function (s) { sumAvg += s.avg; sumRhyme += s.rhymeRate; sumBreak += s.breakRate; for (const k in tail) tail[k] += (s.tailDist[k] || 0); });
    const avgAvg = Math.round(sumAvg / n * 10) / 10, avgRhyme = Math.round(sumRhyme / n), avgBreak = Math.round(sumBreak / n);
    const bars = [1, 2, 3, 4, 0].map(function (k) {
      return '<div class="pm-bar"><span class="pm-bar-l">' + PM_TONES[k] + '</span><span class="pm-bar-track"><i style="width:' + (tail[k] / n) + '%"></i></span><span class="pm-bar-v">' + (tail[k] / n) + '%</span></div>';
    }).join('');
    el.innerHTML = '<div class="pm-sum"><b>' + n + '</b> 首样本 · 平均句长 <b>' + avgAvg + '</b> 字 · 主辙率 <b>' + avgRhyme + '%</b> · 断句率 <b>' + avgBreak + '%</b></div>'
      + '<div class="pm-h">句尾四声分布（跨样本平均）</div>' + bars;
  }
  function runPopMetric() {
    const ta = $('#popmetric-input'); const genre = $('#popmetric-genre') ? $('#popmetric-genre').value : '';
    const res = analyzePopLyrics(ta ? ta.value : '', genre);
    const out = $('#popmetric-result'); if (!out) return;
    if (res.error) { out.innerHTML = '<div class="pm-err">' + esc(res.error) + '</div>'; return; }
    const d = res.tailDist;
    out.innerHTML =
      '<div class="pm-grid">'
      + '<div class="pm-cell"><b>' + res.nLines + '</b><span>有效句</span></div>'
      + '<div class="pm-cell"><b>' + res.avg + '</b><span>平均字/句</span></div>'
      + '<div class="pm-cell"><b>' + res.median + '</b><span>中位字/句</span></div>'
      + '<div class="pm-cell"><b>' + res.min + '–' + res.max + '</b><span>最短–最长</span></div>'
      + '<div class="pm-cell"><b>' + res.rhymeRate + '%</b><span>主辙率(' + esc(res.domZhe) + ')</span></div>'
      + '<div class="pm-cell"><b>' + res.breakRate + '%</b><span>句内断句率</span></div>'
      + '</div>'
      + '<div class="pm-h">句尾四声分布</div>'
      + [1, 2, 3, 4, 0].map(function (k) { const v = d[k] || 0; return '<div class="pm-bar"><span class="pm-bar-l">' + PM_TONES[k] + '</span><span class="pm-bar-track"><i style="width:' + v + '%"></i></span><span class="pm-bar-v">' + v + '%</span></div>'; }).join('')
      + '<button id="popmetric-save" class="primary sm">＋ 记入累积</button>';
    const sv = $('#popmetric-save');
    if (sv) sv.addEventListener('click', function () {
      const arr = getPopMetrics();
      arr.push({ ts: Date.now(), genre: genre, source: ($('#popmetric-source') ? $('#popmetric-source').value : ''), nLines: res.nLines, avg: res.avg, rhymeRate: res.rhymeRate, breakRate: res.breakRate, tailDist: res.tailDist, domZhe: res.domZhe });
      try { localStorage.setItem(POP_METRIC_KEY, JSON.stringify(arr)); } catch (e) {}
      toast('已记入累积（共 ' + arr.length + ' 首）');
      renderPopDashboard();
    });
  }
  function clearPopMetrics() { try { localStorage.removeItem(POP_METRIC_KEY); } catch (e) {} renderPopDashboard(); toast('已清空累积'); }
  function openPopMetric() { const m = $('#popmetric-modal'); if (m) { m.classList.remove('hidden'); renderPopDashboard(); } }
  function popMetricFillSample() {
    const ta = $('#popmetric-input'); if (!ta) return;
    ta.value = '我把夜色喝成了光\n空座位看城市打烊\n手机安静得像空巷\n我领自己走向天亮\n路灯把影子拉得很长\n风替我说完没说的话';
    toast('已填入示例歌词，点「分析」试跑');
  }


  // ---------- 启动 ----------
  function init() {
    const saved = localStorage.getItem(LS_KEY);
    if (saved) { try { state = normalizeDoc(JSON.parse(saved)); } catch {} }
    renderAll();
    bind();
    renderMoodRhyme();
    checkAiStatus();
    ensureLex().then(() => refreshInlineAll());
    loadRules().then(() => refreshAnalysisAll()); // 气口预算按曲风生效，加载后重渲染分析
    $('#save-flag') && ($('#save-flag').textContent = '草稿已就绪 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false }));
  }

  if (!window.Pinyin) document.addEventListener('DOMContentLoaded', () => toast('拼音引擎未加载', 'err'));
  else init();
})();
