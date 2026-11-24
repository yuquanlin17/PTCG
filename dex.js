// 图鉴：简中 / 繁中 / 日版 / 美版 所有卡，按系列分类；可以搜索（中文 / 拼音 / 英文 / 日文 / 编号）、排序、按稀有度筛选，每张卡标价格。
// 资料：日版 / 美版 = 卡图库（vis/meta.json，TCGplayer 全部单卡）+ 系列表 vis/sets.json，价格用价格服务器的 ?set=（一套一次）；
//       繁中 = TCGdex 繁中卡表（卡名、卡图），价格用同编号的日版；简中 = cn-dex.json（PriceCharting 的简中系列，含裸卡价）。
// index.html 把要用的函数（价格格式、卡片详情、加入收藏…）通过 initDex(ctx) 传进来。

let ctx = null, root = null, base = null;
const st = { lang: "ja", kind: "pack", set: null, sort: "num-asc", rar: new Set(), q: "", shown: 0, hideVar: false };
const PAGE = 60;
const LANGS = { "zh-cn": "简中", "zh-tw": "繁中", ja: "日版", en: "美版" };
const CN_ORDER = { "30thC": "2026-10", CBB7C: "2026-10", CBB6C: "2026-08", CSV10C: "2026-08", "151C": "2025-01" };
const KINDS = { pack: "扩充包", deck: "卡组 & 礼盒", promo: "特典卡" };
const RAR = { "Special Art Rare": "SAR", "Special Illustration Rare": "SIR", "Art Rare": "AR", "Illustration Rare": "IR", "Super Rare": "SR", "Ultra Rare": "UR",
  "Hyper Rare": "HR", "Double Rare": "RR", "Triple Rare": "RRR", "Rare": "R", "Holo Rare": "R", "Uncommon": "U", "Common": "C", "Character Rare": "CHR",
  "Character Super Rare": "CSR", "Shiny Rare": "S", "Shiny Holo Rare": "S", "Shiny Super Rare": "SSR", "Shiny Secret Rare": "SSR", "Shiny Ultra Rare": "SUR",
  "ACE SPEC Rare": "ACE", "Promo": "PR", "Mega Hyper Rare": "MUR", "Mega Ultra Rare": "MUR", "Mega Attack Rare": "MA", "Secret Rare": "SR", "Black White Rare": "BWR",
  "Amazing Rare": "A", "Radiant Rare": "K", "Prism Rare": "PR☆", "Classic Collection": "CC", "Trainer Rare": "TR" };
const VARS = { "master ball pattern": "大师球闪", "master ball": "大师球闪", "poke ball pattern": "精灵球闪", "poke ball": "精灵球闪", "love ball": "甜蜜球闪", "friend ball": "友友球闪",
  "energy symbol pattern": "能量标志闪", "mirror holofoil": "镜面闪", "mirror holo": "镜面闪", "reverse holofoil": "反闪", "reverse holo": "反闪", reverse: "反闪", "cosmos holo": "宇宙闪", holo: "闪" };
const varOf = (name) => { const m = String(name).match(/\(([^)]+)\)|\[([^\]]+)\]/); const v = m && (m[1] || m[2]); return v ? VARS[v.toLowerCase()] || "" : ""; };
const baseEn = (s) => String(s || "").replace(/\s*\(.*?\)|\s*\[.*?\]/g, "").replace(/\s*-\s*[\w/-]*\d[\w/-]*\s*$/, "").trim();
const numOf = (n) => { const m = String(n || "").match(/(\d+)/); return m ? +m[1] : 0; };
const tdx = (u) => ctx.getJSON(u, "dex." + u, 7 * 86400e3);

const CSS = `
.dex-top { display: grid; gap: 8px; margin: 2px 0 8px; }
.dex-lang { display: grid; grid-template-columns: repeat(4, 1fr); }
.dex-lang button { font-family: var(--font); font-size: 13.5px; padding: 7px 4px; font-weight: 600; }
.dex-search { display: flex; gap: 6px; }
.dex-search input { flex: 1; min-width: 0; border: 1px solid var(--line); background: var(--surface); border-radius: 10px; padding: 9px 11px; }
.dex-kinds { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; margin-bottom: 8px; }
.dex-kinds button { flex: none; border: 1px solid var(--line); background: var(--surface); border-radius: 999px; padding: 6px 13px; font-size: 13.5px; font-weight: 600; color: var(--muted); }
.dex-kinds button[aria-pressed="true"] { background: var(--fg); color: var(--bg); border-color: var(--fg); }
.dex-sets { display: flex; gap: 10px; overflow-x: auto; scrollbar-width: none; padding: 2px 2px 8px; scroll-snap-type: x proximity; }
.dex-sets::-webkit-scrollbar, .dex-kinds::-webkit-scrollbar { display: none; }
.dex-set { flex: none; width: 78px; text-align: center; background: none; border: 0; padding: 0; scroll-snap-align: start; }
.dex-set .ic { width: 64px; height: 64px; border-radius: 50%; margin: 0 auto 4px; overflow: hidden; background: var(--surface); border: 2px solid var(--line); display: flex; align-items: center; justify-content: center; position: relative; }
.dex-set .ic img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: 50% 22%; transform: scale(1.6); opacity: 0; }
.dex-set .ic b { font-size: 11px; color: var(--muted); }
.dex-set .ic.pk { background: #fff; }
.dex-set .ic.pk b { display: none; }
.dex-set .ic.pk img { object-fit: contain; object-position: center; transform: none; padding: 5px; }
.dex-hv { display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; color: var(--fg); white-space: nowrap; user-select: none; }
.dex-hv input { width: 16px; height: 16px; accent-color: var(--accent); margin: 0; }
.dex-set[aria-pressed="true"] .ic { border-color: var(--accent); }
.dex-set .nm { font-size: 12px; font-weight: 600; line-height: 1.25; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.dex-set[aria-pressed="true"] .nm { color: var(--accent); }
.dex-set .cd { font-size: 10.5px; color: var(--muted); font-family: var(--mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dex-head { background: #1b1e26; color: #fff; border-radius: 14px; padding: 12px 14px; margin: 4px 0 8px; display: grid; gap: 2px; }
.dex-head .t { font-weight: 700; font-size: 16px; }
.dex-head .s { font-size: 12.5px; opacity: .75; font-family: var(--mono); }
.dex-tools { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 4px 2px 8px; font-size: 13px; color: var(--muted); }
.dex-tools select, .dex-tools button { border: 1px solid var(--line); background: var(--surface); color: var(--fg); border-radius: 9px; padding: 6px 9px; font-size: 13px; }
.dex-tools button[data-on="1"] { border-color: var(--accent); color: var(--accent); }
.dex-filter { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 10px; }
.dex-filter button { border: 1px solid var(--line); background: var(--surface); border-radius: 10px; padding: 6px 10px; font-size: 12.5px; line-height: 1.25; text-align: center; }
.dex-filter button small { display: block; color: var(--muted); font-size: 11px; }
.dex-filter button[aria-pressed="true"] { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, var(--surface)); }
.dex-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.dex-card { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 6px; display: flex; flex-direction: column; gap: 3px; min-width: 0; position: relative; cursor: pointer; }
.dex-card .im { aspect-ratio: 63 / 88; border-radius: 6px; overflow: hidden; background: var(--line); display: flex; align-items: center; justify-content: center; position: relative; }
.dex-card .im img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0; transition: opacity .2s; }
.dex-card .im img.ok, .dex-set .ic img.ok { opacity: 1; }
.dex-card .im { flex-direction: column; gap: 3px; text-align: center; padding: 4px; }
.dex-card .im b { font-size: 12.5px; color: var(--muted); font-weight: 600; }
.dex-card .rf { position: absolute; left: 10px; top: 10px; z-index: 1; background: rgba(0,0,0,.6); color: #fff; font-size: 10px; padding: 1px 5px; border-radius: 5px; pointer-events: none; }
.dex-card .im small { font-size: 10.5px; color: var(--muted); font-family: var(--mono); opacity: .8; overflow-wrap: anywhere; }
.dex-card .im[data-none] { background: repeating-linear-gradient(135deg, var(--line) 0 8px, transparent 8px 16px), var(--line); }
.dex-card .nm { font-weight: 700; font-size: 13px; line-height: 1.25; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dex-card .sb { font-size: 11px; color: var(--muted); font-family: var(--mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dex-card .pr { font-family: var(--mono); font-weight: 700; font-size: 13.5px; color: var(--bad); }
.dex-card .pr.na { color: var(--muted); font-weight: 500; font-size: 11.5px; font-family: var(--font); }
.dex-card .add { position: absolute; right: 8px; top: 8px; width: 26px; height: 26px; border-radius: 50%; border: 0; background: rgba(0,0,0,.55); color: #fff; font-size: 17px; line-height: 26px; padding: 0; }
.dex-more { width: 100%; margin: 10px 0; }
.dex-note { color: var(--muted); font-size: 12px; margin: 10px 2px; line-height: 1.55; }
`;

export async function initDex(c) {
  ctx = c;
  if (!root) build();
  await render();
}

function build() {
  const s = document.createElement("style"); s.textContent = CSS; document.head.appendChild(s);
  root = ctx.$("pageDex");
  st.lang = ctx.store.get("ptcg.dexLang", "ja");
  root.innerHTML = `
    <div class="dex-top">
      <div class="seg dex-lang" role="group" aria-label="版本">${Object.entries(LANGS).map(([k, v]) => `<button data-l="${k}">${v}</button>`).join("")}</div>
      <form class="dex-search"><input type="search" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="搜卡名 / 拼音 / 编号：皮卡丘、pkq、月伊、151 25"><button class="btn small" type="submit">搜索</button></form>
    </div>
    <div class="dex-kinds" data-kinds></div>
    <div class="dex-sets" data-sets></div>
    <div data-head></div>
    <div class="dex-tools"><span style="display:flex;flex-direction:column;gap:3px;min-width:0"><span data-count></span>
      <label class="dex-hv"><input type="checkbox" data-hv>隐藏特殊版本</label></span><span style="display:flex;gap:6px">
      <select data-sort aria-label="排序"></select><button type="button" data-filt>筛选</button></span></div>
    <div class="dex-filter" data-filter hidden></div>
    <div class="dex-grid" data-grid></div>
    <button class="btn dex-more" data-more hidden>显示更多</button>
    <div class="dex-note" data-note></div>`;
  root.querySelectorAll("[data-l]").forEach((b) => (b.onclick = () => { st.lang = b.dataset.l; ctx.store.set("ptcg.dexLang", st.lang); st.set = null; st.q = ""; root.querySelector("input").value = ""; st.rar.clear(); render(); }));
  root.querySelector("form").onsubmit = (e) => { e.preventDefault(); st.q = root.querySelector("input").value.trim(); st.rar.clear(); root.querySelector("input").blur(); render(); };
  root.querySelector("input").oninput = (e) => { if (!e.target.value.trim() && st.q) { st.q = ""; render(); } };
  root.querySelector("[data-sort]").onchange = (e) => { st.sort = e.target.value; showCards(); };
  // 隐藏特殊版本（大师球 / 精灵球 / 镜面 / 反闪 / 宇宙闪…），记住选择
  st.hideVar = !!ctx.store.get("ptcg.dexHideVar", false);
  const hv = root.querySelector("[data-hv]"); hv.checked = st.hideVar;
  hv.onchange = () => { st.hideVar = hv.checked; ctx.store.set("ptcg.dexHideVar", st.hideVar); buildFilter(); showCards(); };
  root.querySelector("[data-filt]").onclick = () => { const f = root.querySelector("[data-filter]"); f.hidden = !f.hidden; };
  root.querySelector("[data-more]").onclick = () => paint(false);
}

// ---------- 资料 ----------
async function loadBase() {
  if (!base) base = (async () => {
    const L = await ctx.searchLib();
    const [, sets, noimg] = await Promise.all([
      ctx.loadImgRefs ? ctx.loadImgRefs() : null,
      fetch("vis/sets.json").then((r) => r.json()).catch(() => ({ sets: [] })),
      fetch("vis/noimg.json").then((r) => r.json()).catch(() => ({})),
    ]);
    // TCGplayer 上还没有卡图的卡（很多球纹版、新预售）也列出来：先用「暂无图片」占位，价格、收藏照常
    const meta = { sets: L.meta.sets.slice(), items: L.meta.items.slice() }, nImg = L.meta.items.length;
    const setIx = new Map(meta.sets.map((s, i) => [s[1] + "|" + s[0], i]));
    for (const [id, v] of Object.entries(noimg)) {
      const [k, , n, name, r, rel] = v; if (!k || !name) continue;
      if (!setIx.has(k)) { const bar = k.indexOf("|"); setIx.set(k, meta.sets.length); meta.sets.push([k.slice(bar + 1), k.slice(0, bar)]); }
      meta.items.push([+id, setIx.get(k), n || "", name, r || "", rel || ""]);
    }
    // 卡图库按系列分组
    const bySet = new Map();
    // 线上用的兑换码卡（Code Card）不是实体卡，不列
    meta.items.forEach((it, i) => { if (/^Code Card/i.test(it[3])) return; const s = meta.sets[it[1]], k = s[1] + "|" + s[0]; if (!bySet.has(k)) bySet.set(k, []); bySet.get(k).push(i); });
    return { ...L, meta, nImg, sets: sets.sets || [], bySet, cn: null, tw: null };
  })().catch((e) => { base = null; throw e; });
  return base;
}
async function loadCn(B) {
  if (!B.cn) B.cn = await fetch("cn-dex.json").then((r) => r.json()).catch(() => ({ sets: [], cards: [] }));
  return B.cn;
}
async function loadTw(B) {
  if (!B.tw) B.tw = ((await tdx("https://api.tcgdex.net/v2/zh-tw/sets").catch(() => [])) || []).slice().reverse();
  return B.tw;
}
// 中文显示名：词典里的简体名（皮卡丘），没有就原名
const REGION = { alolan: "阿罗拉", galarian: "伽勒尔", hisuian: "洗翠", paldean: "帕底亚", mega: "超级", dark: "暗之", radiant: "光辉", shining: "闪耀的" };
function zhName(B, en) {
  const b = baseEn(en), v = varOf(en);
  const tail = v ? `（${v.replace(/闪$/, "")}）` : "";
  const e = B.dict.byEn.get(b.toLowerCase());
  if (e && (e.hans || e.hant)) return (e.hans || e.hant) + tail;
  // 词典里没有整个卡名：拆成「地区 / Mega + 宝可梦 + ex / V…」分别翻（Alolan Exeggutor → 阿罗拉椰蛋树、Pikachu ex → 皮卡丘ex）
  const m = b.match(/^((?:Alolan|Galarian|Hisuian|Paldean|Mega|Dark|Radiant|Shining)\s+)?(.+?)(\s+(?:ex|EX|GX|V|VMAX|VSTAR|V-UNION|BREAK|LV\.X|Star|☆|δ|[XY]\s+ex|[XY]))*$/);
  if (m) {
    const core = B.dict.byEn.get(m[2].toLowerCase());
    if (core && (core.hans || core.hant)) return (m[1] ? REGION[m[1].trim().toLowerCase()] || "" : "") + (core.hans || core.hant) + b.slice((m[1] || "").length + m[2].length).replace(/\s+/g, "") + tail;
  }
  return b + tail;
}
// 价格服务器：整套一次（TCGplayer 市价）
const priceCache = new Map();
function setPrices(slug, line) {
  const k = line + "|" + slug;
  if (!priceCache.has(k)) {
    const base = ctx.proxyUrl();
    priceCache.set(k, base ? ctx.getJSON(`${base}?set=${encodeURIComponent(slug)}&line=${line}`, `dexset.${k}`, 6 * 3600e3)
      .then((j) => new Map((j.items || []).map((x) => [x.id, x])))
      .catch(() => { priceCache.delete(k); return new Map(); }) : Promise.resolve(new Map()));
  }
  return priceCache.get(k);
}

// ---------- 系列列表 ----------
async function setList(B) {
  if (st.lang === "ja" || st.lang === "en") {
    const tw = st.lang === "ja" ? await loadTw(B).catch(() => []) : [];
    // 美版没有商品图的系列用 TCGdex 的系列 logo
    const enLogo = new Map();
    if (st.lang === "en") for (const x of (await tdx("https://api.tcgdex.net/v2/en/sets").catch(() => [])) || []) if (x.logo) enLogo.set(baseSet(x.name), x.logo + ".webp");
    const twName = new Map(tw.map((s) => [String(s.id).toUpperCase(), s.name]));
    return B.sets.filter((s) => s.l === st.lang && B.bySet.has(s.l + "|" + s.name)).map((s) => {
      const code = s.name.includes(":") ? s.name.split(":")[0].trim() : "";
      return { key: s.l + "|" + s.name, name: twName.get(code.toUpperCase()) || (s.name.includes(":") ? s.name.split(":").slice(1).join(":").trim() : s.name), code: code || s.name, rel: s.rel, kind: s.kind, slug: s.slug,
        pic: s.pack ? `https://tcgplayer-cdn.tcgplayer.com/product/${s.pack}_200w.jpg` : enLogo.get(baseSet(s.name)) || "" };
    });
  }
  if (st.lang === "zh-cn") {
    const cn = await loadCn(B);
    return cn.sets.map((s, i) => ({ ...s, i })).filter((s) => s.lang === "zh-cn").map((s) => ({ key: "cn|" + s.slug, name: s.name, code: s.code, rel: s.rel, kind: s.kind || (/promo/i.test(s.slug) ? "promo" : "pack"), i: s.i,
        pic: s.cover ? cn.img + s.cover + ".png" : "" }))
      // 排新旧：TCGdex 没写发售日的几套按大概时间排（只用来排序，不显示）；其他没日期的零散系列排最后
      .sort((a, b) => (b.rel || CN_ORDER[b.code] || "0").localeCompare(a.rel || CN_ORDER[a.code] || "0"));
  }
  const tw = await loadTw(B);
  // 繁中系列的发售时间：用同代码日版系列的（TCGdex 繁中系列表没写日期），用来排新旧
  const jpRel = new Map(B.sets.filter((x) => x.l === "ja" && x.name.includes(":")).map((x) => [x.name.split(":")[0].trim().toUpperCase(), x.rel]));
  // 繁中系列图：同代码日版的补充包图
  const jpPack = new Map(B.sets.filter((x) => x.l === "ja" && x.pack && x.name.includes(":")).map((x) => [x.name.split(":")[0].trim().toUpperCase(), x.pack]));
  return tw.map((s) => ({ key: "tw|" + s.id, name: s.name, code: s.id, rel: jpRel.get(String(s.id).toUpperCase()) || "", pic: jpPack.has(String(s.id).toUpperCase()) ? `https://tcgplayer-cdn.tcgplayer.com/product/${jpPack.get(String(s.id).toUpperCase())}_200w.jpg` : "", kind: /-P$/i.test(s.id) ? "promo" : /組合|牌組|禮盒|起始|特別組合|高級|對戰組合/.test(s.name) ? "deck" : "pack", id: s.id })).sort((a, b) => (b.rel || "").localeCompare(a.rel || ""));
}

// ---------- 一张卡 = 一个对象（tile 显示 + 点开看价格曲线 + 加入收藏） ----------
function jaEnCard(B, i, set) {
  const it = B.meta.items[i], s = B.meta.sets[it[1]], line = s[1] === "en" ? "pokemon" : "pokemon-japan";
  const [n, total] = String(it[2]).split("/");
  // TCGplayer 没有卡图的：用卡图对照表借的图（同一张卡的普通版 / 原版 / 官网卡图），~ 是参考图
  const rf = ctx.refImg ? ctx.refImg(it[0]) : null, noImg = i >= B.nImg && !rf;
  const c = { lang: s[1], tpOnly: true, tpId: it[0], id: "tp" + it[0], name: zhName(B, it[3]), enName: it[3], setName: s[0], setId: set ? set.code : s[0].split(":")[0],
    localId: n || "", official: parseInt(total, 10) || null, tpNum: it[2], rel: it[5] || null, rar: RAR[it[4]] || "", var: varOf(it[3]), num: numOf(it[2]),
    img: rf ? rf.thumb : noImg ? "" : `https://tcgplayer-cdn.tcgplayer.com/product/${it[0]}_200w.jpg`, img2: rf && rf.thumb !== rf.full ? rf.full : "", refPic: !!(rf && rf.ref), noImg, slug: (set && set.slug) || slugFor(B, s), line, price: undefined, _i: i };
  c.goSet = () => goSet(s[1], s[1] + "|" + s[0]);
  c.versions = () => versionsJaEn(B, c);
  c.loadPrices = priceList;
  return c;
}
function slugFor(B, s) { const x = B.sets.find((y) => y.l === s[1] && y.name === s[0]); return x && x.slug; }
// 卡片详情：还没查到价格的（本卡、其他版本）一起查
const priceList = (list) => fillPrices(list.filter((v) => v.price === undefined), { cur: false });
// 从卡片详情跳到它那一套
function goSet(lang, key) {
  st.lang = lang; ctx.store.set("ptcg.dexLang", lang); st.q = ""; st.set = key; st.goKind = true; st.rar.clear();
  if (root) { const inp = root.querySelector("input"); if (inp) inp.value = ""; }
  ctx.go("dex"); render();
}
// 其他版本（日版 / 美版）：同名、卡图特征很像的（同一张画：日美版、球纹、镜面、复刻、印章版）
async function versionsJaEn(B, c) {
  const base = baseEn(c.enName).toLowerCase(), same = [];
  B.meta.items.forEach((it, i) => { if (baseEn(it[3]).toLowerCase() === base && !/^Code Card/i.test(it[3])) same.push(i); });
  let pick;
  if (c.noImg) {
    // 没卡图就没有特征：同名同编号的（日版 / 美版、各种版本）
    pick = same.filter((i) => numOf(B.meta.items[i][2]) === c.num && c.num != null);
  } else {
    const X = await ctx.getVecIndex();
    if (!X.pos) { X.pos = new Map(); X.meta.items.forEach((it, j) => X.pos.set(it[0], j)); }
    const a = X.pos.get(c.tpId);
    if (a == null) pick = [c._i];
    else {
      const { vecs, inv, D } = X, cos = (b) => { let t = 0; for (let k = 0; k < D; k++) t += vecs[a * D + k] * vecs[b * D + k]; return t * inv[a] * inv[b]; };
      const sc = new Map();
      for (const i of same) { const it = B.meta.items[i], b = X.pos.get(it[0]); if (i === c._i) sc.set(i, 2); else if (b != null) { const v = cos(b); if (v >= 0.78) sc.set(i, v); } else if (numOf(it[2]) === c.num) sc.set(i, 0.5); }
      pick = [...sc.keys()].sort((x, y) => sc.get(y) - sc.get(x));
    }
  }
  if (!pick.includes(c._i)) pick.unshift(c._i);
  return pick.slice(0, 16).map((i) => (i === c._i ? c : jaEnCard(B, i, null)));
}

// ---------- 画面 ----------
let curCards = [], curSets = [];
async function render() {
  root.querySelectorAll("[data-l]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.l === st.lang)));
  const grid = root.querySelector("[data-grid]");
  grid.innerHTML = `<div class="dex-note" style="grid-column:1/-1">载入中…</div>`;
  let B;
  try { B = await loadBase(); } catch (e) { grid.innerHTML = `<div class="dex-note" style="grid-column:1/-1">载入失败：${ctx.esc(e.message)}</div>`; return; }
  curSets = await setList(B).catch(() => []);
  if (st.goKind) { st.goKind = false; const w = curSets.find((s) => s.key === st.set); if (w) st.kind = w.kind; }
  const kinds = [...new Set(curSets.map((s) => s.kind))];
  if (!kinds.includes(st.kind)) st.kind = kinds[0] || "pack";
  root.querySelector("[data-kinds]").innerHTML = st.q ? "" : Object.entries(KINDS).filter(([k]) => kinds.includes(k)).map(([k, v]) => `<button data-k="${k}" aria-pressed="${k === st.kind}">${v}</button>`).join("");
  root.querySelectorAll("[data-k]").forEach((b) => (b.onclick = () => { st.kind = b.dataset.k; st.set = null; st.rar.clear(); render(); }));
  const list = curSets.filter((s) => s.kind === st.kind);
  if (!st.q && (!st.set || !list.some((s) => s.key === st.set))) st.set = list[0] && list[0].key;
  // 系列一排：图标用这套第一张卡
  const sets = root.querySelector("[data-sets]");
  sets.hidden = !!st.q;
  sets.innerHTML = "";
  for (const s of list.slice(0, 120)) {
    const b = document.createElement("button"); b.className = "dex-set"; b.setAttribute("aria-pressed", String(s.key === st.set));
    b.innerHTML = `<div class="ic"><b>${ctx.esc(String(s.code).slice(0, 6))}</b></div><div class="nm">${ctx.esc(s.name)}</div><div class="cd">${ctx.esc(s.code)}</div>`;
    setIcon(B, s, b.querySelector(".ic"));
    b.onclick = () => { st.set = s.key; st.rar.clear(); render(); };
    sets.appendChild(b);
  }
  const sel = sets.querySelector('[aria-pressed="true"]'); if (sel) sel.scrollIntoView({ inline: "nearest", block: "nearest" });
  // 排序选项
  const sorts = [["num-asc", "编号低→高"], ["num-desc", "编号高→低"], ["price-desc", "价格高→低"], ["price-asc", "价格低→高"]].concat(st.q ? [["rel-desc", "发售 新→旧"], ["rel-asc", "发售 旧→新"]] : []);
  if (!sorts.some(([k]) => k === st.sort)) st.sort = st.q ? "rel-desc" : "num-asc";
  root.querySelector("[data-sort]").innerHTML = sorts.map(([k, v]) => `<option value="${k}"${k === st.sort ? " selected" : ""}>${v}</option>`).join("");
  // 卡
  curCards = st.q ? await searchCards(B) : await setCards(B, curSets.find((s) => s.key === st.set));
  const head = root.querySelector("[data-head]");
  const cs = curSets.find((s) => s.key === st.set);
  head.innerHTML = st.q ? "" : cs ? `<div class="dex-head"><div class="t">${ctx.esc(cs.name)}</div><div class="s">${ctx.esc(cs.code)}${cs.rel ? " · 发售日期 " + ctx.esc(cs.rel) : ""} · ${curCards.length} 张</div></div>` : "";
  root.querySelector("[data-note]").innerHTML = {
    "zh-cn": "简中卡表和卡图来自官方小程序卡表（社区整理的 PTCG-CHS-Datasets）；价格来自 PriceCharting（裸卡价，美元换算），PriceCharting 没收录的卡暂无价格。",
    "zh-tw": "繁中卡表来自 TCGdex；价格参考同编号的日版卡（TCGplayer 市价）。",
    ja: "日版卡表和价格来自 TCGplayer（市价）。卡名显示中文译名。",
    en: "美版卡表和价格来自 TCGplayer（市价）。卡名显示中文译名。",
  }[st.lang];
  buildFilter();
  showCards();
  loadPrices();
}
const baseSet = (n) => String(n || "").replace(/^[^:]*:\s*/, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function setIcon(B, s, el) {
  let src = "", alt = "";
  // 有系列图（补充包 / 礼盒商品图、系列 logo）就用它，没有再用这套第一张卡
  if (s.pic) {
    el.classList.add("pk");
    const big = s.pic.includes("PTCG-CHS"), im = document.createElement("img"); im.loading = "lazy"; im.alt = "";
    im.onload = () => im.classList.add("ok");
    im.onerror = () => { if (big && im.src !== s.pic) im.src = s.pic; else { im.remove(); el.classList.remove("pk"); s.pic = ""; setIcon(B, s, el); } };
    im.src = big ? `https://wsrv.nl/?url=${encodeURIComponent(s.pic)}&w=140&output=webp` : s.pic; el.appendChild(im);
    return;
  }
  if (s.key.includes("|") && (st.lang === "ja" || st.lang === "en")) { const idx = B.bySet.get(s.key); if (idx && idx.length) { const i = idx.reduce((a, b) => ((numOf(B.meta.items[b][2]) || 1e6) < (numOf(B.meta.items[a][2]) || 1e6) ? b : a), idx[0]); src = `https://tcgplayer-cdn.tcgplayer.com/product/${B.meta.items[i][0]}_200w.jpg`; } }
  else if (st.lang === "zh-cn" && B.cn) { const c = B.cn.cards.find((x) => x[1] === s.i && x[5]); if (c) [src, alt] = cnImgs(B.cn, B.cn.sets[s.i], c[5]); }
  else if (st.lang === "zh-tw") src = `https://assets.tcgdex.net/zh-tw/${s.code}/logo.webp`;
  if (!src) return;
  const im = document.createElement("img"); im.loading = "lazy"; im.alt = "";
  im.onload = () => im.classList.add("ok"); im.onerror = () => { if (alt && im.src !== alt) im.src = alt; else im.remove(); }; im.src = src; el.appendChild(im);
}

async function setCards(B, s) {
  if (!s) return [];
  if (st.lang === "ja" || st.lang === "en") return (B.bySet.get(s.key) || []).map((i) => jaEnCard(B, i, s));
  if (st.lang === "zh-cn") {
    const cn = await loadCn(B);
    return cn.cards.filter((c) => c[1] === s.i).map((c) => cnCard(B, c, cn.sets[c[1]]));
  }
  const d = await tdx(`https://api.tcgdex.net/v2/zh-tw/sets/${encodeURIComponent(s.id)}`).catch(() => null);
  const jp = B.sets.find((x) => x.l === "ja" && x.name.toUpperCase().startsWith(String(s.id).toUpperCase() + ":"));
  return ((d && d.cards) || []).map((c) => twCard(c, s, jp));
}
// 简中卡图：官方卡图（PTCG-CHS-Datasets，300×419 PNG；列表用 wsrv.nl 缩小成 webp，不行就用原图），或 PriceCharting 的照片
function cnImgs(cn, set, img) {
  if (!img) return [];
  if (set.src === "o") { const full = cn.img + img + ".png"; return [`https://wsrv.nl/?url=${encodeURIComponent(full)}&w=240&output=webp&q=82`, full]; }
  return [`https://storage.googleapis.com/images.pricecharting.com/${img}/240.jpg`];
}
// 宝石包编号「01 07/09」= 第 1 组第 7 张（排序用）
const cnKey = (num) => { const g = String(num).match(/^(\d+)\s+(\d+)\/\d+$/); return g ? +g[1] * 100 + +g[2] : numOf(num); };
function cnCard(B, c, set) {
  if (set.src === "o") return cnOfficial(B, c, set);
  const [id, si, num, name, variant, img, price, g9, psa10] = c;
  const o = { lang: "zh-cn", id: "pc" + id, name: zhName(B, name) + (variant ? `（${VARS[variant.toLowerCase()] ? VARS[variant.toLowerCase()].replace(/闪$/, "") : variant}）` : ""), enName: name,
    setName: set.name, setId: set.code, localId: String(num).padStart(3, "0"), num: numOf(num), rar: "", var: variant ? VARS[variant.toLowerCase()] || variant : "",
    pcq: `${set.slug.replace(/-/g, " ")} ${name}${variant ? ` [${variant}]` : ""} #${num}`, pcImg: img ? `https://storage.googleapis.com/images.pricecharting.com/${img}/240.jpg` : "",
    img: img ? `https://storage.googleapis.com/images.pricecharting.com/${img}/240.jpg` : "", rel: set.rel || null, price: price != null ? { usd: price, src: "PriceCharting" } : null,
    graded: g9 || psa10 ? { g9, psa10 } : null };
  o.goSet = () => goSet("zh-cn", "cn|" + set.slug);
  // 其他版本：同一套同编号（普通 / 闪 / 镜面 / 印章…）
  o.versions = async () => B.cn.cards.filter((x) => x[1] === si && numOf(x[2]) === numOf(num)).map((x) => (x === c ? o : cnCard(B, x, set)));
  return o;
}
// 官方卡表的简中卡：官方卡名、稀有度、版本（精灵球 / 大师球 / 镜面…）、官图；价格是对上的 PriceCharting 价
function cnOfficial(B, c, set) {
  const [id, si, num, name, variant, img, price, g9, psa10, rar, pcRef, pcNum] = c;
  const [thumb, full] = cnImgs(B.cn, set, img), std = /^\d+\/\S+$/.test(num);
  const o = { lang: "zh-cn", id: "cn" + id, name: name + (variant ? `（${variant}）` : ""), setName: set.name, setId: set.code, localId: std ? num.split("/")[0] : num, tpNum: num,
    num: cnKey(num), rar: rar || "", var: variant || "", img: thumb || "", img2: full || "", pcImg: full || "", image: "",
    pcq: pcRef && set.pcSlug ? `${set.pcSlug.replace(/-/g, " ")} ${pcRef} #${pcNum}` : null, pcNum: pcNum || null,
    rel: set.rel || null, price: price != null ? { usd: price, src: "PriceCharting" } : null, graded: g9 || psa10 ? { g9, psa10 } : null };
  o.goSet = () => goSet("zh-cn", "cn|" + set.slug);
  // 其他版本：同一套同编号（普通 / 精灵球 / 大师球 / 镜面）；宝石包是同一组
  o.versions = async () => B.cn.cards.filter((x) => x[1] === si && numOf(x[2]) === numOf(num)).map((x) => (x === c ? o : cnCard(B, x, set)));
  return o;
}
function twCard(c, s, jp) {
  const o = { lang: "zh-tw", id: c.id, name: String(c.name).replace(/^<([^>]+)>/, "$1"), setName: s.name, setId: s.code, localId: c.localId, num: numOf(c.localId), rar: "", var: "",
    image: c.image || "", img: c.image ? c.image + "/low.webp" : "", jpSlug: jp && jp.slug, rel: null, price: undefined };
  o.goSet = () => goSet("zh-tw", "tw|" + s.code);
  // 其他版本：同代码同编号的日版卡（繁中和日版是同一套）
  if (jp) o.versions = async () => {
    const B = await loadBase(), idx = B.bySet.get("ja|" + jp.name) || [];
    const ja = idx.filter((i) => numOf(B.meta.items[i][2]) === o.num).map((i) => jaEnCard(B, i, { code: s.code, slug: jp.slug }));
    const more = ja[0] ? (await ja[0].versions().catch(() => ja)) : [];
    const list = [o, ...more.filter((v) => !ja.some((x) => x.id === v.id)), ...ja];
    const seen = new Set();
    return list.filter((v) => !seen.has(v.id) && seen.add(v.id));
  };
  o.loadPrices = priceList;
  return o;
}

// ---------- 搜索 ----------
async function searchCards(B) {
  const q = B.S.parseQuery(st.q);
  const names = q.name ? B.S.matchNames(B.dict, q.name) : [];
  if (st.lang === "ja" || st.lang === "en") {
    q.langs = new Set([st.lang]);
    const slugOf = new Map(B.sets.map((s) => [s.l + "|" + s.name, s]));
    return B.S.findCards(B.meta, q, names, 300).filter((h) => !/^Code Card/i.test(B.meta.items[h.i][3])).map((h) => { const it = B.meta.items[h.i], s = B.meta.sets[it[1]], ss = slugOf.get(s[1] + "|" + s[0]); return jaEnCard(B, h.i, ss && { code: s[0].split(":")[0], slug: ss.slug }); });
  }
  if (st.lang === "zh-cn") {
    const cn = await loadCn(B);
    const want = new Set(names.map((h) => h.e.en.toLowerCase()));
    // 官方卡是中文名：和词典里的简体 / 繁体名比（皮卡丘、皮卡丘ex、莉莉艾的皮皮…），词典没找到就直接看卡名里有没有输入的字
    const zh = [...new Set(names.flatMap((h) => [h.e.hans, h.e.hant]).filter(Boolean))];
    const raw = /[\u4e00-\u9fff]/.test(q.name || "") ? q.name.replace(/\s+/g, "") : "";
    const SUF = /^(ex|EX|GX|V|VMAX|VSTAR|V-UNION|BREAK|\s)*$/;
    const zhHit = (nm) => zh.some((w) => nm === w || (nm.startsWith(w) && SUF.test(nm.slice(w.length))) || nm.endsWith("的" + w) || nm.includes("的" + w + "ex")) || (raw && nm.includes(raw));
    return cn.cards.filter((c) => { const s = cn.sets[c[1]]; if (s.lang !== "zh-cn") return false;
        const nameOk = !q.name || (s.src === "o" ? zhHit(c[3]) : want.size && want.has(baseEn(c[3]).toLowerCase()));
        return nameOk && (q.num == null || numOf(c[2]) === q.num); })
      .slice(0, 300).map((c) => cnCard(B, c, cn.sets[c[1]]));
  }
  // 繁中：TCGdex 按繁中名搜
  const out = [];
  for (const h of names.slice(0, 3)) {
    const nm = h.e.hant || h.e.hans; if (!nm) continue;
    const list = (await tdx(`https://api.tcgdex.net/v2/zh-tw/cards?name=${encodeURIComponent(nm)}`).catch(() => [])) || [];
    for (const c of list) {
      const sid = c.id.slice(0, c.id.lastIndexOf("-"));
      if (q.num != null && numOf(c.localId) !== q.num) continue;
      const jp = B.sets.find((x) => x.l === "ja" && x.name.toUpperCase().startsWith(sid.toUpperCase() + ":"));
      if (!out.some((o) => o.id === c.id)) out.push(twCard(c, { name: sid, code: sid }, jp));
    }
  }
  return out.slice(0, 300);
}

// ---------- 价格 ----------
let priceToken = 0;
async function loadPrices() {
  const my = ++priceToken;
  await fillPrices(curCards, { cur: true, my });
  if (my === priceToken && st.sort.startsWith("price")) showCards();
}
async function fillPrices(list, { cur, my }) {
  const groups = new Map();
  for (const c of list) {
    if (c.price !== undefined) continue;
    const k = c.lang === "zh-tw" ? c.jpSlug && "pokemon-japan|" + c.jpSlug : c.slug && c.line + "|" + c.slug;
    if (!k) { c.price = null; continue; }
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  let i = 0;
  for (const [k, cards] of groups) {
    if (++i > 25) { cards.forEach((c) => (c.price = null)); continue; } // 搜索结果跨很多系列时只查前 25 套
    const [line, slug] = k.split("|");
    const m = await setPrices(slug, line);
    if (cur && my !== priceToken) return;
    if (cards[0].lang === "zh-tw") {
      const byNum = new Map(); for (const x of m.values()) { const n = numOf(x.number); if (n && !byNum.has(n) && !/\(|\[/.test(x.name)) byNum.set(n, x); }
      for (const c of cards) { const x = byNum.get(c.num); c.price = x && x.price != null ? { usd: x.price, src: "TCGplayer（日版参考）" } : null; if (x) c.tpId = x.id; }
    } else for (const c of cards) { const x = m.get(c.tpId); c.price = x && x.price != null ? { usd: x.price, src: "TCGplayer" } : null; }
    if (cur) updatePrices(cards);
  }
}
function updatePrices(cards) {
  for (const c of cards) {
    const el = c._el && c._el.querySelector(".pr");
    if (!el) continue;
    const usd = c.price && c.price.usd;
    if (usd != null) { el.className = "pr"; el.dataset.usd = usd; el.textContent = ctx.fmt(usd); } else { el.className = "pr na"; el.textContent = "暂无价格"; }
  }
}

// ---------- 筛选、排序、网格 ----------
const rarKey = (c) => (c.rar && c.var ? `${c.rar}(${c.var})` : c.rar || c.var || "");
function buildFilter() {
  const f = root.querySelector("[data-filter]"), cnt = new Map();
  for (const c of curCards.filter(keepVar)) { const k = rarKey(c); if (k) cnt.set(k, (cnt.get(k) || 0) + 1); }
  const order = ["SAR", "SIR", "MUR", "UR", "HR", "SR", "AR", "IR", "CHR", "CSR", "RRR", "RR", "SSR", "SUR", "S", "ACE", "K", "A", "R", "U", "C", "PR", "BWR", "MA", "CC", "TR"];
  const keys = [...cnt.keys()].sort((a, b) => { const ia = order.indexOf(a.split("(")[0]), ib = order.indexOf(b.split("(")[0]); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b); });
  f.innerHTML = keys.length ? keys.map((k) => `<button data-r="${ctx.esc(k)}" aria-pressed="${st.rar.has(k)}">${ctx.esc(k)}<small>${cnt.get(k)}种</small></button>`).join("") + `<button data-reset>重置</button>` : `<span class="dex-note" style="margin:0">这套卡没有稀有度资料</span>`;
  f.querySelectorAll("[data-r]").forEach((b) => (b.onclick = () => { const k = b.dataset.r; if (st.rar.has(k)) st.rar.delete(k); else st.rar.add(k); b.setAttribute("aria-pressed", String(st.rar.has(k))); showCards(); }));
  const rs = f.querySelector("[data-reset]"); if (rs) rs.onclick = () => { st.rar.clear(); buildFilter(); showCards(); };
}
let viewCards = [];
const keepVar = (c) => !st.hideVar || !c.var;
function showCards() {
  let list = curCards.filter((c) => keepVar(c) && (!st.rar.size || st.rar.has(rarKey(c))));
  const pr = (c) => (c.price && c.price.usd != null ? c.price.usd : null);
  const cmp = {
    "num-asc": (a, b) => (a.num || 1e6) - (b.num || 1e6), "num-desc": (a, b) => b.num - a.num,
    "price-desc": (a, b) => (pr(b) ?? -1) - (pr(a) ?? -1), "price-asc": (a, b) => (pr(a) ?? 1e9) - (pr(b) ?? 1e9),
    "rel-desc": (a, b) => String(b.rel || "").localeCompare(String(a.rel || "")), "rel-asc": (a, b) => String(a.rel || "9").localeCompare(String(b.rel || "9")),
  }[st.sort];
  list = list.slice().sort(cmp);
  viewCards = list;
  root.querySelector("[data-count]").textContent = st.q ? `「${st.q}」：${list.length >= 300 ? "300+" : list.length} 张` : `${list.length} 张${st.rar.size ? "（已筛选）" : ""}${st.hideVar && list.length < curCards.length && !st.rar.size ? `（另有 ${curCards.length - list.length} 张特殊版本）` : ""}`;
  root.querySelector("[data-filt]").dataset.on = st.rar.size ? "1" : "0";
  st.shown = 0;
  root.querySelector("[data-grid]").innerHTML = list.length ? "" : `<div class="dex-note" style="grid-column:1/-1">${st.q ? "没找到。试试别的写法（中文、拼音、英文名），或者换个版本。" : "这套卡还没有资料。"}</div>`;
  paint(true);
}
function paint() {
  const grid = root.querySelector("[data-grid]");
  for (const c of viewCards.slice(st.shown, st.shown + PAGE)) grid.appendChild(tile(c));
  st.shown += PAGE;
  const more = root.querySelector("[data-more]");
  more.hidden = st.shown >= viewCards.length;
  more.textContent = `显示更多（还有 ${Math.max(0, viewCards.length - st.shown)} 张）`;
}
function tile(c) {
  const el = document.createElement("div"); el.className = "dex-card";
  const usd = c.price && c.price.usd;
  el.innerHTML = `${c.refPic ? '<span class="rf">参考图</span>' : ""}<div class="im"${c.img ? "" : ' data-none="1"'}><b>${c.img ? "" : "暂无图片"}</b><small>${ctx.esc(c.setId)} ${ctx.esc(c.localId)}</small></div><div class="nm">${ctx.esc(c.name)}</div>
    <div class="sb">${ctx.esc((c.tpNum || c.localId || "") + (rarKey(c) ? " · " + rarKey(c) : ""))}</div>
    <div class="${usd != null ? "pr" : "pr na"}"${usd != null ? ` data-usd="${usd}"` : ""}>${usd != null ? ctx.fmt(usd) : c.price === undefined ? "查价格中…" : "暂无价格"}</div>
    <button class="add" aria-label="加入收藏" title="加入收藏">+</button>`;
  // 图片直接放进格子（lazy 的图要在页面上才会开始下载），没有图 / 下载失败就显示「暂无图片」
  if (c.img) { const b = el.querySelector(".im"), im = document.createElement("img"); im.loading = "lazy"; im.alt = "";
    im.onload = () => im.classList.add("ok"); im.onerror = () => { if (c.img2 && im.src !== c.img2) { im.src = c.img2; return; } im.remove(); c.noImg = true; b.dataset.none = "1"; b.querySelector("b").textContent = "暂无图片"; }; im.src = c.img; b.appendChild(im); }
  el.onclick = (e) => { if (e.target.closest(".add")) return; ctx.openHistory(c); };
  el.querySelector(".add").onclick = () => { ctx.addToLib({ ...c, price: c.price || null }, 1); ctx.toast(`已加入收藏：${c.name}`); };
  c._el = el;
  return el;
}
