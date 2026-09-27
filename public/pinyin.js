// 韵律分析引擎：依赖全局 window.PINYIN_DATA（由 pinyin-data.json 加载）
// 提供：取字拼音、提取韵母(韵脚)、十三辙归类、平仄判定
(function () {
  const DATA = (typeof window !== 'undefined' && window.PINYIN_DATA) || {};

  // 声母（长声母放前面，优先匹配）
  const INITIALS = ['zh', 'ch', 'sh', 'b', 'p', 'm', 'f', 'd', 't', 'n', 'l',
    'g', 'k', 'h', 'j', 'q', 'x', 'z', 'c', 's', 'r'];

  // 十三辙（按韵母归类）
  const ZHE = {
    a: '发花', ia: '发花', ua: '发花',
    o: '梭波', e: '梭波', uo: '梭波',
    ie: '乜斜', 'üe': '乜斜',
    u: '姑苏',
    i: '衣期', 'ü': '衣期', er: '衣期', 'ê': '衣期',
    ai: '怀来', uai: '怀来',
    ei: '灰堆', ui: '灰堆',
    ao: '遥条', iao: '遥条',
    ou: '由求', iu: '由求',
    an: '言前', ian: '言前', uan: '言前', 'üan': '言前',
    en: '人辰', in: '人辰', uen: '人辰', 'ün': '人辰',
    ang: '江阳', iang: '江阳', uang: '江阳',
    eng: '中东', ing: '中东', ueng: '中东', ong: '中东', iong: '中东',
  };

  // 标点（用于剔除韵脚判定）
  const PUNCT = /[\s，。、！？；：""''（）()【】\[\]《》〈〉…—·,.!?;:'"~\-]/;

  function isHan(ch) {
    const c = ch.codePointAt(0);
    return c >= 0x4e00 && c <= 0x9fff;
  }

  // 取字的拼音（含数字声调），如 "zhong1"
  function getPinyin(ch) {
    return DATA[ch] || null;
  }

  // 从带数字声调的拼音提取韵母（韵脚），如 "zhong1" -> "ong"
  function getFinal(py) {
    if (!py) return '';
    let base = py.replace(/[0-9]$/, ''); // 去掉声调数字
    for (const ini of INITIALS) {
      if (base.startsWith(ini)) { base = base.slice(ini.length); break; }
    }
    return base;
  }

  // 韵脚 -> 十三辙名
  function getZhe(final) {
    return ZHE[final] || (final ? '其他' : '');
  }

  // 平仄：1/2 声为平，3/4 声为仄，5 声(轻声)为轻
  function getTone(py) {
    if (!py) return 0;
    const t = parseInt(py.slice(-1), 10);
    if (t === 1 || t === 2) return 1; // 平
    if (t === 3 || t === 4) return 2; // 仄
    return 3; // 轻
  }

  // 分析一行：返回 { chars:[{ch,py,tone}], rhyme:{final,zhe,py}, }
  function analyzeLine(line) {
    const chars = [];
    let rhymeCh = null, rhymePy = null;
    for (const ch of line) {
      if (PUNCT.test(ch)) { chars.push({ ch, py: null, tone: 0, punct: true }); continue; }
      const py = getPinyin(ch);
      const tone = getTone(py);
      chars.push({ ch, py, tone, punct: false });
      if (isHan(ch) || /[a-zA-Z]/.test(ch)) { rhymeCh = ch; rhymePy = py; }
    }
    const final = getFinal(rhymePy);
    return {
      chars,
      rhyme: { ch: rhymeCh, py: rhymePy, final, zhe: getZhe(final) },
    };
  }

  // 稳定颜色：根据 final 字符串哈希选色
  const PALETTE = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4',
    '#42d4f4', '#f032e6', '#bfef45', '#fabed4', '#469990', '#dcbeff', '#9a6324'];
  function rhymeColor(final) {
    if (!final) return '#bbb';
    let h = 0;
    for (const c of final) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }

  window.Pinyin = { getPinyin, getFinal, getZhe, getTone, analyzeLine, rhymeColor, isHan, hasData: Object.keys(DATA).length > 0 };
})();
