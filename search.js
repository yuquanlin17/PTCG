// 文字查卡：名字（英 / 日 / 繁中 / 简中，同音字、错字、绰号都行）+ 版本（日版 / 美版 / 简中 / 繁中）+ 编号 / promo
// 例：「rayquaza 日版」「裂空座 美版」「烈空坐」「莉莉艾的皮皮」「ナンジャモ」「085 promo」「swsh 85」「皮卡丘 sv-p 120」「侦探皮卡丘」
// 词典 names.json 由 tools/build-names.mjs 生成，绰号在 aliases.json（可以自己加）。不碰网页元素，方便单独测试。

// ---------- 查询拆解 ----------
const LANG_WORDS = [
  ["ja", /(^|\s)(日版|日文版?|日语版?|日本版?|日卡|jp|jpn|japan|japanese)(?=\s|$)/gi],
  ["en", /(^|\s)(美版|英文版?|英版|英语版?|美卡|国际版|en|eng|english|us)(?=\s|$)/gi],
  ["zh-cn", /(^|\s)(简中|简体中文|简体|国行|简中版|cn|s-?chinese)(?=\s|$)/gi],
  ["zh-tw", /(^|\s)(繁中|繁體中文|繁体中文|繁体|繁體|港版|台版|繁中版|tw|hk|t-?chinese)(?=\s|$)/gi],
];
// 版本词贴在名字后面也认（「裂空座美版」「rayquaza日版」）
const LANG_TAIL = [["ja", /(日版|日文版|日本版)$/], ["en", /(美版|英文版|英版)$/], ["zh-cn", /(简中|国行)$/], ["zh-tw", /(繁中|港版|台版)$/]];
const PROMO_WORDS = /(^|\s)(promos?|特典卡?|宣传卡?|推广卡?|プロモ(カード)?|black\s*star|黑星|pr)(?=\s|$)/gi;
// 卡名后缀（规则 / 形态）：从名字里拿掉，查到以后再按它筛
const SUFFIXES = [
  ["vmax", /(vmax)$/i], ["vstar", /(vstar)$/i], ["vunion", /(v-?union)$/i], ["gx", /(gx)$/i], ["ex", /(ex)$/i], ["v", /(?<![a-z])(v)$/i],
  ["break", /(break)$/i], ["prime", /(prime)$/i], ["lv.x", /(lv\.?x)$/i], ["star", /(☆|star)$/i],
];
const MEGA = /^(mega\s*|m\s+|超级|メガ|超級)/i;

export function parseQuery(text) {
  let t = " " + String(text || "").normalize("NFKC").replace(/[，,、;；]/g, " ").replace(/\s+/g, " ").trim() + " ";
  const langs = new Set();
  for (const [l, re] of LANG_WORDS) t = t.replace(re, (m, a) => { langs.add(l); return a + " "; });
  t = t.replace(/\s+/g, " ").trim();
  for (const [l, re] of LANG_TAIL) if (re.test(t)) { langs.add(l); t = t.replace(re, "").trim(); }
  // 系列名：「151」「30th」和名字一起出现时当作系列，不是编号（妙蛙种子 151）
  let setWord = null;
  const sw = t.match(/(^|\s)(151|30th|30周年)(?=\s|$)/i);
  if (sw && t.replace(sw[0], "").trim() && !/\d\s*\/\s*151/.test(t)) { setWord = sw[2].toLowerCase() === "151" ? "151" : "30th"; t = t.replace(sw[0], " ").trim(); }
  let promo = false;
  t = (" " + t + " ").replace(PROMO_WORDS, (m, a) => { promo = true; return a + " "; }).trim();
  // 编号：236/187、120/SV-P、SWSH085、SM60、XY17、SVP 085、MEP 070、单独的 1～3 位数
  let num = null, total = null, code = null;
  let m = t.match(/(\d{1,3})\s*\/\s*([A-Za-z]{1,4}-P)\b/i);
  if (m) { num = +m[1]; code = m[2].toUpperCase(); promo = true; t = t.replace(m[0], " "); }
  if (num == null && (m = t.match(/(^|\s)(\d{1,3})\s*\/\s*(\d{2,3})(?=\s|$)/))) { num = +m[2]; total = +m[3]; t = t.replace(m[0], " "); }
  if (num == null && (m = t.match(/(^|\s)(swsh|sm|xy|bw|dp|hgss|svp|mep|smp|swshp)\s*-?\s*(\d{1,3})(?=\s|$)/i))) {
    num = +m[3]; code = m[2].toUpperCase().replace(/P$/, "") === "SV" ? "SVP" : m[2].toUpperCase(); promo = true; t = t.replace(m[0], " ");
  }
  if (num == null && (m = t.match(/(^|\s)(s|sm|sv|m|xy|bw|dp|s8a)-p(?=\s|$)/i))) { code = m[2].toUpperCase() + "-P"; promo = true; t = t.replace(m[0], " "); }
  if (num == null && (m = t.match(/(^|\s)(\d{1,3})(?=\s|$)/))) { num = +m[2]; t = t.replace(m[0], " "); }
  t = t.replace(/\s+/g, " ").trim();
  // 后缀 / Mega
  let suffix = null, mega = false;
  const bare = t.replace(/\s+/g, "");
  for (const [k, re] of SUFFIXES) if (re.test(bare) && bare.replace(re, "").length) { suffix = k; t = t.replace(new RegExp(re.source.replace("$", "\\s*$"), "i"), "").trim(); break; }
  let megaXY = null;
  if (MEGA.test(t)) {
    mega = true; t = t.replace(MEGA, "").trim();
    const xy = t.match(/\s*([xy])$/i);
    if (xy && t.length > 1) { megaXY = xy[1].toLowerCase(); t = t.slice(0, -xy[0].length).trim(); }
  }
  return { langs, promo, num, total, code, suffix, mega, megaXY, set: setWord, name: t };
}

// ---------- 词典 ----------
const toKata = (s) => s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
const norm = (s) => toKata(String(s || "").normalize("NFKC").toLowerCase()).replace(/[\s'’`.\-_·・:：!！?？()（）「」『』]/g, "").replace(/[的の]/g, "");
const isCJK = (s) => /[぀-ヿ一-鿿]/.test(s);
let PY = null;
const pyOf = (s) => [...s].map((c) => PY.get(c) || c).join(" ");

export function makeDict(json, aliases = {}) {
  PY = new Map();
  for (const part of String(json.py || "").split("|")) { const [syl, chars] = part.split(":"); if (chars) for (const c of chars) if (!PY.has(c)) PY.set(c, syl); }
  const entries = json.n.map(([en, ja, hant, hans, kind]) => {
    const forms = [...new Set([en, ja, hant, hans].filter(Boolean).map(norm))];
    const py = [...new Set([hant, hans].filter(Boolean).map((s) => pyOf(norm(s))))];
    return { en, ja, hant, hans, kind, forms, py };
  });
  const byEn = new Map(entries.map((e) => [e.en.toLowerCase(), e]));
  const alias = new Map(Object.entries(aliases).filter(([k]) => !k.startsWith("_")).map(([k, v]) => [norm(k), v]));
  return { entries, byEn, alias };
}

function lev(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 99;
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; }
  }
  return d[b.length];
}
// 名字 → 词典里最像的几条（每条带分数）。返回的 en 是用来在卡图库（英文名）里找卡的
export function matchNames(dict, name, depth = 0) {
  const q = norm(name);
  if (!q) return [];
  // 绰号：整句或句子里包含绰号
  for (const [k, v] of dict.alias) if (q === k || (k.length >= 2 && q.includes(k))) {
    const rest = q.replace(k, "");
    const hits = [].concat(v).map((en) => ({ e: dict.byEn.get(en.toLowerCase()) || { en, forms: [norm(en)], py: [], kind: 0 }, s: 100, alias: true }));
    if (!rest) return hits;
    return hits.concat(matchNames(dict, rest).map((h) => ({ ...h, s: h.s - 30 })));
  }
  const cjk = isCJK(q), qpy = cjk ? pyOf(q) : "";
  const out = [];
  for (const e of dict.entries) {
    let s = 0;
    for (const f of e.forms) {
      if (f === q) { s = 100; break; }
      if (f.startsWith(q) && /^(ex|gx|v|vmax|vstar|vunion|break)$/.test(f.slice(q.length))) { s = Math.max(s, 97); continue; } // 莉莉艾的皮皮 = 莉莉艾的皮皮ex
      if (f.length >= 2 && q.includes(f)) s = Math.max(s, 70 + Math.min(20, f.length * 3)); // 句子里有这个名字（黄昏莉莉艾 → 莉莉艾）
      else if (q.length >= (cjk ? 2 : 3) && f.includes(q)) s = Math.max(s, 60 + 25 * (q.length / f.length)); // 名字的一部分（rayqu → Rayquaza）
      else if (!cjk && q.length >= 4 && !isCJK(f)) { const d = lev(q, f); if (d <= Math.max(1, Math.floor(q.length / 4))) s = Math.max(s, 75 - d * 8); } // 拼错
    }
    if (cjk && s < 90) for (const p of e.py) {
      if (p === qpy) s = Math.max(s, 92); // 同音字（裂空座 = 烈空坐）
      else if (qpy.length >= 5 && p.includes(qpy)) s = Math.max(s, 58 + 20 * (qpy.length / p.length));
      else if (p.length >= 5 && qpy.includes(p)) s = Math.max(s, 66);
    }
    if (s >= 55) out.push({ e, s: s + (e.kind ? 3 : 0) }); // 同分时宝可梦名优先
  }
  out.sort((a, b) => b.s - a.s || a.e.en.length - b.e.en.length);
  // 什么都没对上：去掉头尾的字再试（「黄昏莉莉艾」→「莉莉艾」，多打了形容词 / 绰号前缀）
  if (!out.length && depth < 3 && [...q].length > 2) {
    const a = matchNames(dict, [...q].slice(1).join(""), depth + 1), b = matchNames(dict, [...q].slice(0, -1).join(""), depth + 1);
    return (a.length && (!b.length || a[0].s >= b[0].s) ? a : b).map((h) => ({ ...h, s: h.s - 8 }));
  }
  // 只留和第一名差不多的
  return out.filter((x) => x.s >= out[0].s - 12).slice(0, 8);
}

// ---------- 在卡图库（vis/meta.json）里找卡 ----------
const cardBase = (s) => String(s || "").replace(/\s*\(.*?\)\s*/g, " ").replace(/\s*-\s*[\w/-]*\d[\w/-]*\s*$/, "").replace(/\s+/g, " ").trim().toLowerCase();
const numOf = (n) => { const m = String(n || "").match(/(\d+)/); return m ? +m[1] : null; };
const PROMO_SET = /promo|black star|-P\b|-P:|^P-|プロモ/i;
const SUF_RE = { vmax: /\bvmax\b/i, vstar: /\bvstar\b/i, vunion: /\bv-?union\b/i, gx: /\bgx\b/i, ex: /\bex\b/i, v: /\bv\b/i, break: /\bbreak\b/i, prime: /\bprime\b|\(prime\)/i, "lv.x": /lv\.?\s*x/i, star: /☆|\bstar\b/i };

// q：parseQuery 的结果；names：matchNames 的结果（可以为空：只按编号 / promo 找）。返回 [{ i, score }]
export function findCards(meta, q, names, max = 60) {
  const want = names.map((h) => ({ en: h.e.en.toLowerCase(), species: !!h.e.kind, s: h.s }));
  const langOk = (l) => !q.langs.size || q.langs.has(l === "en" ? "en" : "ja") || (l === "ja" && q.langs.has("zh-tw"));
  const out = [];
  for (let i = 0; i < meta.items.length; i++) {
    const it = meta.items[i], set = meta.sets[it[1]];
    if (!langOk(set[1])) continue;
    if (q.num != null && numOf(it[2]) !== q.num) continue;
    if (q.total != null && !String(it[2]).endsWith("/" + q.total) && !String(it[2]).endsWith("/" + String(q.total).padStart(3, "0"))) continue;
    if (q.promo && !PROMO_SET.test(set[0]) && !/[A-Z]{2,}\d/.test(it[2])) continue;
    if (q.code) {
      const c = q.code.toUpperCase(), n = String(it[2]).toUpperCase(), sn = set[0].toUpperCase();
      if (!(n.includes("/" + c) || n.startsWith(c.replace(/-P$/, "")) || sn.startsWith(c + ":") || sn.startsWith(c + " ") || (c === "SVP" && /SCARLET & VIOLET PROMO/.test(sn)) || (c === "MEP" && /MEGA EVOLUTION PROMO/.test(sn)))) continue;
    }
    const base = cardBase(it[3]);
    let s = 0;
    if (want.length) {
      for (const w of want) {
        let k = 0;
        const plain = base.replace(/\s+(ex|gx|v|vmax|vstar|v-union|break|☆)$/i, "");
        if (base === w.en) k = 100;
        else if (plain === w.en) k = 96;
        else if (w.species && new RegExp(`(^|[\\s'’&])${w.en.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[\\s'’,&])`).test(base)) k = 80; // 「Mega Rayquaza ex」「Rayquaza VMAX」
        else if (!w.species && base.startsWith(w.en)) k = 85;
        if (k === 80) k -= Math.min(8, 2 * (base.split(" ").length - w.en.split(" ").length)); // 名字里多出来的词越多越靠后（Mega …）
        if (k) s = Math.max(s, k + (w.s - 100) * 0.5 - (/\(/.test(it[3]) ? 2 : 0)); // 球纹 / 镜面等版本排在普通版后面
      }
      if (!s) continue;
    } else if (q.name) continue; // 有名字但词典里没找到：交给 TCGplayer 搜索
    if (q.suffix && !SUF_RE[q.suffix].test(it[3])) continue;
    if (q.mega && !/^(mega|m)\s/i.test(it[3])) continue;
    if (q.megaXY && !new RegExp(`\\s${q.megaXY}(\\s|$)`, "i").test(base)) continue;
    if (q.set === "151" && !/151/.test(set[0])) continue;
    if (q.set === "30th" && !/30th/i.test(set[0])) continue;
    out.push({ i, score: s, rel: it[5] || "" });
  }
  // 名字越准越前；同样准的，新卡在前
  out.sort((a, b) => b.score - a.score || b.rel.localeCompare(a.rel));
  return out.slice(0, max);
}
