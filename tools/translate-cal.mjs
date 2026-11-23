// 发售日历的翻译（提前做好，网页上直接切换，不是在线翻译）：每个商品翻成另外两种语言（简体中文 / 日文 / 英文），存进 cal-tr.json。
// GitHub Actions 每天跑（.github/workflows/calendar.yml）。只翻新的或内容改过的（按内容算指纹），翻过的不再翻。
// 本地跑：node tools/translate-cal.mjs
//
// 翻译用 Google 翻译的免费接口；专有名词不交给它，先换成占位符，翻完再换回来：
// · 稀有度 / 规则名（SAR、SIR、AR、ex、VMAX、VSTAR…）原样保留
// · 地区特有的商品类型有公认叫法的翻过来、括号里注明原文（精英训练家箱（ETB）、迷你铁盒（Mini Tin））；没有公认叫法的原样保留
// · 宝可梦名、训练家名、卡名换成目标语言的官方名字（names.json，和「按名字查卡」用的是同一份词典）
import fs from "node:fs";
import crypto from "node:crypto";

const ROOT = new URL("../", import.meta.url);
const API = "https://api.ptcgprice.com";
const MAX_PER_RUN = +process.env.MAX_PER_RUN || 60;
const LANG = { "zh-cn": "zh", "zh-tw": "zh", ja: "ja", en: "en" };
const GT = { zh: "zh-CN", ja: "ja", en: "en" };
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(new URL(f, ROOT), "utf8")); } catch { return d; } };
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---------- 专有名词 ----------
// 稀有度、规则名：不翻（前后不能紧挨着英文字母，免得把单词里的 V 之类换掉）
const KEEP = ["ACE SPEC", "SAR", "SIR", "CHR", "CSR", "AR", "IR", "SR", "UR", "HR", "VMAX", "VSTAR", "V-UNION", "GX", "EX", "ex", "BREAK", "V"];
// 地区特有、别的地区没有对应叫法的商品类型：原样保留
const KEEP_PRODUCTS = ["Build & Battle Box Display", "Build & Battle Box", "Build & Battle Stadium", "Booster Bundle", "Sleeved Booster", "Premium Checklane Blister",
  "Checklane Blister", "3-Pack Blister", "Single Pack Blister", "Ultra-Premium Collection", "Ultra Premium Collection", "Super-Premium Collection", "Premium Collection",
  "Booster Display", "UPC", "SPC"];
// 地区特有的商品类型：有公认叫法的写在这里（目标语言没写的就保留原文）。match 是各种写法；bracket: false 表示是普通用词，翻过来就行，不用括号
const GLOSSARY = [
  { match: ["Pokémon Center Elite Trainer Box", "Pokemon Center Elite Trainer Box", "Pokémon Center ETB", "Pokemon Center ETB", "PC ETB"],
    zh: "宝可梦中心限定精英训练家箱", ja: "ポケモンセンター限定エリートトレーナーボックス", en: "Pokémon Center Elite Trainer Box" },
  { match: ["Elite Trainer Box", "ETB", "エリートトレーナーボックス", "精英训练家箱", "精英訓練家箱"], zh: "精英训练家箱", ja: "エリートトレーナーボックス", en: "Elite Trainer Box" },
  { match: ["Mini Tin", "ミニ缶", "迷你铁盒"], zh: "迷你铁盒", ja: "ミニ缶", en: "Mini Tin" },
  { match: ["ハイクラスパック"], en: "High Class Pack" },
  { match: ["強化拡張パック"], en: "Enhanced Expansion Pack", zh: "强化扩充包" },
  { match: ["スタートデッキ"], en: "Start Deck" },
  { match: ["デッキシールド"], en: "Deck Shield", zh: "卡套" },
  { match: ["30th Celebration", "30th CELEBRATION", "30周年庆典"], zh: "30周年庆典", ja: "30th CELEBRATION", en: "30th Celebration", bracket: false },
  { match: ["Scarlet & Violet", "スカーレット&バイオレット", "スカーレット＆バイオレット", "朱&紫", "朱＆紫"], zh: "朱&紫", ja: "スカーレット&バイオレット", en: "Scarlet & Violet", bracket: false },
  { match: ["Sword & Shield", "ソード&シールド", "ソード＆シールド", "剑&盾", "剑＆盾"], zh: "剑&盾", ja: "ソード&シールド", en: "Sword & Shield", bracket: false },
  { match: ["Mega Evolution", "メガシンカ", "超级进化"], zh: "超级进化", ja: "メガシンカ", en: "Mega Evolution", bracket: false },
  { match: ["皮卡"], ja: "ピカ", en: "Pika", bracket: false }, // 简中宣传常用「皮卡」当皮卡丘的昵称（皮卡璀璨），Google 会翻成「皮卡车」
];
// 普通用词不挡住（挡住了 Google 的句子会不通顺），翻完再改 Google 的固定错误
const FIX = {
  zh: [[/甲板(盒|箱)/g, "卡盒"], [/甲板/g, "卡组"], [/(助推器|增强器|增压)盒/g, "补充包盒"], [/(助推器|增强器|增压)包|增强包|扩展包/g, "补充包"],
    [/促销卡|宣传卡|推广卡/g, "特典卡"], [/游戏桌?垫/g, "桌垫"], [/活页夹/g, "卡册"], [/袖子|套筒/g, "卡套"], [/巨型(?=[\u4e00-\u9fff])/g, "超级"],
    [/训练师/g, "训练家"], [/神奇宝贝|口袋妖怪|精灵宝可梦/g, "宝可梦"], [/箔片?卡/g, "闪卡"], [/箔/g, "闪"]],
  ja: [[/甲板/g, "デッキ"]],
  en: [[/\bexpansion pack\b/gi, "Booster Pack"]],
};
// 宝可梦 / 训练家 / 卡名：names.json → 各语言的写法
const names = readJson("names.json", { n: [] }).n;
const NAME_FORMS = { zh: [], ja: [], en: [] };
for (const [en, ja, hant, hans] of names) {
  const e = { en, ja, zh: hans || hant };
  if (en && en.length >= 3) NAME_FORMS.en.push([en, e]);
  if (ja && ja.length >= 2) NAME_FORMS.ja.push([ja, e]);
  for (const z of new Set([hans, hant])) if (z && z.length >= 2) NAME_FORMS.zh.push([z, e]);
}
for (const k in NAME_FORMS) NAME_FORMS[k].sort((a, b) => b[0].length - a[0].length);

// 把一段文字里的专有名词换成 ⟦n⟧，记下换回来时用什么。keep：这个商品要原样保留的词（英文系列名等）
function protect(text, from, to, slots, keep = []) {
  const put = (out) => { slots.push(out); return `⟦${slots.length}⟧`; };
  const br = (tr, orig) => `${tr}${to === "en" ? ` (${orig})` : `（${orig}）`}`;
  let t = text;
  for (const k of [...keep, ...KEEP_PRODUCTS].filter(Boolean).sort((a, b) => b.length - a.length))
    t = t.replace(new RegExp(`(?<![A-Za-z])${escRe(k)}s?(?![A-Za-z])`, "gi"), (orig) => put(orig));
  for (const g of GLOSSARY) for (const m of [...g.match].sort((a, b) => b.length - a.length)) {
    const latin = /^[\x00-\x7f]+$/.test(m);
    const re = new RegExp(`(?<![A-Za-z])${escRe(m)}${latin ? "s?" : ""}(?![A-Za-z${m === "皮卡" ? "丘" : ""}])`, latin ? "gi" : "g");
    t = t.replace(re, (orig) => put(!g[to] || g[to] === orig ? orig : g.bracket === false ? g[to] : br(g[to], orig)));
  }
  for (const k of KEEP) t = t.replace(new RegExp(`(?<![A-Za-z])${escRe(k)}(?![A-Za-z])`, "g"), (orig) => put(orig));
  // 名字：最长的先换；英文要整词
  const lat = from === "en";
  for (const [form, e] of NAME_FORMS[from]) {
    if (!t.includes(form)) continue;
    const re = new RegExp(lat ? `(?<![A-Za-z])${escRe(form)}(?![A-Za-z])` : escRe(form), "g");
    t = t.replace(re, () => put(e[to] || form));
  }
  return t;
}
// 换回来；Google 会吃掉占位符之间的空格（Flowing Fists⟦1⟧ → Flowing FistsBuild），两边都是英文 / 数字时补一个空格
const restore = (t, slots) => {
  let out = "", last = 0;
  for (const m of t.matchAll(/⟦\s*(\d+)\s*⟧/g)) {
    const v = slots[+m[1] - 1] ?? m[0];
    out += t.slice(last, m.index);
    if (/[A-Za-z0-9)\]]$/.test(out) && /^[A-Za-z0-9(\[]/.test(v)) out += " ";
    out += v; last = m.index + m[0].length;
    if (/[A-Za-z0-9)\]]$/.test(v) && /^[A-Za-z0-9(\[]/.test(t.slice(last))) out += " ";
  }
  return out + t.slice(last);
};

// ---------- Google 翻译 ----------
async function gt(text, from, to) {
  if (!text.trim()) return text;
  for (let k = 0; k < 4; k++) {
    try {
      const r = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=${GT[from]}&tl=${GT[to]}`, {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" }, body: "q=" + encodeURIComponent(text),
      });
      if (r.ok) { const j = await r.json(); return (j[0] || []).map((s) => s[0] || "").join(""); }
      console.log(`  翻译 HTTP ${r.status}`);
    } catch (e) { console.log("  翻译出错：", String(e).slice(0, 120)); }
    await sleep(3000 * (k + 1));
  }
  throw new Error("翻译失败");
}
const SEP = "\n⟦0⟧\n"; // 几个字段拼成一次请求，翻完按它切开
// 引号里的商品名 / 系列名（「ハドウシーカー」“璀璨晶耀 皮卡丘专属礼盒”）：单独翻，后面括号注明原文
async function quoted(text, from, to, slots, keep) {
  const re = /([「『“"])([^」』”"]{2,40})([」』”"])/g, segs = [...text.matchAll(re)];
  let t = text;
  for (const m of segs) {
    const inner = m[2], s2 = [], tr = restore((await gt(protect(inner, from, to, s2, keep), from, to)).trim(), s2);
    slots.push(tr && tr !== inner ? `${m[1]}${tr}${m[3]}${to === "en" ? ` (${inner})` : `（${inner}）`}` : m[0]);
    t = t.replace(m[0], `⟦${slots.length}⟧`);
  }
  return t;
}
async function translateItem(x, from, to) {
  const parts = [x.name || "", x.type || "", x.price || "", x.desc || "", ...(x.contents || [])].map(String);
  // 美版系列名（「ME07: Flowing Fists」里的 Flowing Fists）没有公认的中日文名：原样保留
  const keep = x.src === "tcgp" && x.type ? [x.type, String(x.type).replace(/^[^:]*:\s*/, "")] : [];
  const slots = [];
  const pre = [];
  for (const p of parts) pre.push(await quoted(p, from, to, slots, keep));
  const src = pre.map((p) => protect(p, from, to, slots, keep)).join(SEP);
  const out = (await gt(src, from, to)).split(/\n?\s*⟦\s*0\s*⟧\s*\n?/);
  if (out.length !== parts.length) throw new Error(`字段数对不上（${out.length}/${parts.length}）`);
  const fix = (s) => {
    for (const [re, v] of FIX[to]) s = s.replace(re, v);
    return to === "zh" ? s.replace(/([A-Za-z0-9])(?=[\u4e00-\u9fff])/g, "$1 ") : s; // 中文里英文和汉字之间空一格
  };
  const r = out.map((s, i) => (parts[i].trim() ? fix(restore(s.trim(), slots)) : ""));
  // 美版官网的商品名：翻过来，括号里留原名（好对照、好搜）
  if (from === "en" && x.src !== "tcgp" && r[0] && r[0] !== parts[0]) r[0] = `${r[0]}（${parts[0]}）`;
  return { name: r[0], type: r[1], price: r[2], desc: r[3], contents: r.slice(4) };
}

// ---------- 主流程 ----------
// 三份来源：简中官网（cal-cn.json）、美版官网（cal-en.json，手动）、价格服务器上的日版官网 + TCGplayer 预售
const srv = await fetch(`${API}?calendar=1`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
const items = [];
for (const src of [readJson("cal-cn.json", {}), readJson("cal-en.json", {}), srv || {}]) for (const x of src.items || []) if (!items.some((y) => y.id === x.id)) items.push(x);
const old = readJson("cal-tr.json", { items: {} });
const out = { at: Date.now(), items: {} };
const fields = (x) => ({ name: x.name || "", type: x.type || "", price: x.price || "", desc: x.desc || "", contents: x.contents || [] });
// 翻译规则改了就把 RULES 加 1：所有商品会按新规则重翻一遍
const RULES = 8;
const hash = (x) => crypto.createHash("sha1").update(RULES + JSON.stringify(fields(x))).digest("hex").slice(0, 12);

let done = 0, kept = 0, failed = 0;
for (const x of items) {
  const from = LANG[x.region] || "en", targets = ["zh", "ja", "en"].filter((t) => t !== from), h = hash(x), prev = old.items[x.id];
  if (prev && prev.h === h && targets.every((t) => prev[t])) { out.items[x.id] = prev; kept++; continue; }
  if (done >= MAX_PER_RUN) { if (prev) out.items[x.id] = prev; continue; }
  done++;
  try {
    const tr = { h };
    for (const t of targets) { tr[t] = await translateItem(x, from, t); await sleep(800); }
    out.items[x.id] = tr;
    console.log(`  ✓ ${x.id} ${String(x.name).slice(0, 30)} → ${targets.map((t) => tr[t].name.slice(0, 30)).join(" / ")}`);
  } catch (e) {
    failed++; console.log(`  ✗ ${x.id}：${e.message}`);
    if (prev) out.items[x.id] = prev;
    if (done === 3 && failed === 3) { console.log("前 3 个都失败，这次先停下"); for (const y of items) if (!out.items[y.id] && old.items[y.id]) out.items[y.id] = old.items[y.id]; break; }
  }
}
// 价格服务器这次没连上：它那部分（日版官网、TCGplayer 预售）的旧翻译照留
if (!srv) for (const [id, v] of Object.entries(old.items || {})) if (!out.items[id] && /^(ja|tp):/.test(id)) out.items[id] = v;
fs.writeFileSync(new URL("cal-tr.json", ROOT), JSON.stringify(out));
console.log(`翻译：新翻 ${done - failed} 个，沿用 ${kept} 个，失败 ${failed} 个，共 ${Object.keys(out.items).length} 个`);
