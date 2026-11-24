// 图鉴的简中卡表 cn-dex.json，两个来源：
// 1. 卡表和官图：PTCG-CHS-Datasets（github.com/duanxr/PTCG-CHS-Datasets，社区整理的官方小程序卡表：官方卡名、编号、稀有度、精灵球 / 大师球等版本、官方卡图）。
//    卡图不复制，网页直接链到该仓库（jsDelivr），按数据集的说明只做非商业用途。
// 2. 价格：PriceCharting 的简中系列（裸卡价、Grade 9、PSA 10，美元），按「系列代码 + 编号 + 版本」对到官方卡上；
//    官方卡表里没有的系列（PriceCharting 独有的）照旧用 PriceCharting 的卡名和照片。
// 官方卡一行：[官方 id, 系列, 编号, 卡名, 版本, 卡图, 裸卡价, Grade 9, PSA 10, 稀有度, PriceCharting 卡名 [版本], PriceCharting 编号, PriceCharting 商品号]
// 每天跟着发售日历一起更新（价格每天变）；本地：node tools/build-cn.mjs（调试：CN_PC=旧的 PriceCharting 卡表 node tools/build-cn.mjs --reuse，不重新抓 PriceCharting）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PC = "https://www.pricecharting.com";
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
async function get(url, json) {
  for (let k = 0; k < 4; k++) {
    try { const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (PTCG price app)", accept: json ? "application/json" : "text/html" } }); if (r.ok) return json ? r.json() : r.text(); if (r.status === 404) return null; } catch {}
    await sleep(2000 * (k + 1));
  }
  return null;
}
const slugOf = (consoleName) => String(consoleName).toLowerCase().replace(/\./g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const REUSE = process.argv.includes("--reuse");
let sets = [], cards = [];
if (REUSE) {
  // 用以前只有 PriceCharting 的 cn-dex.json（CN_PC=文件路径）
  const old = JSON.parse(fs.readFileSync(process.env.CN_PC || path.join(ROOT, "cn-dex.json"), "utf8"));
  const keep = new Map();
  old.sets.forEach((s, i) => { if (s.src !== "o") { keep.set(i, sets.length); sets.push(s); } });
  for (const c of old.cards) if (keep.has(c[1])) cards.push([c[0], keep.get(c[1]), ...c.slice(2, 9)]);
} else await scrapePC();
async function scrapePC() {
// ---------- 有哪些简中系列 ----------
const slugs = new Set();
const cat = (await get(`${PC}/category/pokemon-cards`)) || "";
for (const m of cat.matchAll(/\/console\/(pokemon-chinese[\w-]*)/g)) slugs.add(m[1]);
for (const q of ["pokemon chinese", "pokemon chinese csv", "pokemon chinese cs", "pokemon chinese csm", "pokemon chinese gem pack", "pokemon chinese promo", "pokemon chinese pikachu", "pokemon chinese charizard", "pokemon chinese eevee", "pokemon chinese mew"]) {
  const j = await get(`${PC}/search-products?type=prices&q=${encodeURIComponent(q)}`, true);
  for (const p of (j && j.products) || []) if (/^Pokemon Chinese/i.test(p.consoleName)) slugs.add(slugOf(p.consoleName));
  await sleep(400);
}
// 中文系列名、发售日：TCGdex 简中系列表（代码去掉点对上：CSV9.5C → csv95c）
const tcgdex = (await get("https://api.tcgdex.net/v2/zh-cn/sets", true)) || [];
const tdx = new Map();
for (const s of tcgdex) tdx.set(String(s.id).toLowerCase().replace(/\./g, ""), s);
const EXTRA = { "151-collect": ["151C", "宝可梦卡牌151"], "30th-celebration": ["30thC", "30周年庆典"], promo: ["PROMO", "简中特典卡"],
  csv105c: ["CSV10.5C", "黑雷奔流", "2026-11-06"], csv106c: ["CSV10.6C", "白焰进涌", "2026-11-06"] };
async function setInfo(slug) {
  const k = slug.replace(/^pokemon-chinese-?/, "");
  const gem = k.match(/^gem-pack(?:-(\d+))?$/);
  const key = gem ? `cbb${gem[1] || 1}c` : k;
  const t = tdx.get(key);
  if (t) {
    let rel = "";
    const d = await get(`https://api.tcgdex.net/v2/zh-cn/sets/${encodeURIComponent(t.id)}`, true);
    rel = (d && d.releaseDate) || "";
    return { code: t.id, name: t.name, rel };
  }
  if (gem) return { code: `CBB${gem[1] || 1}C`, name: `宝石包 Vol.${gem[1] || 1}`, rel: "" };
  if (EXTRA[k]) return { code: EXTRA[k][0], name: EXTRA[k][1], rel: EXTRA[k][2] || "" };
  return { code: k.toUpperCase(), name: k.toUpperCase(), rel: "" };
}

// ---------- 每个系列的卡 ----------
for (const slug of [...slugs].sort()) {
  const info = await setInfo(slug);
  const si = sets.length;
  let n = 0;
  for (let cursor = 0; cursor < 3000; cursor += 150) {
    const h = await get(`${PC}/console/${slug}${cursor ? `?cursor=${cursor}` : ""}`);
    if (!h) break;
    const rows = [...h.matchAll(/<tr id="product-(\d+)"[\s\S]*?<\/tr>/g)];
    for (const [row, id] of rows) {
      const title = ((row.match(/<td class="title"[^>]*>\s*<a[^>]*>([^<]*)<\/a>/) || [])[1] || "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").trim();
      const tm = title.match(/^(.*?)\s*(?:\[(.*?)\])?\s*#\s*([\w-]+)\s*$/);
      const img = (row.match(/images\.pricecharting\.com\/([\w-]+)\/\d+\.jpg/) || [])[1] || "";
      // 三栏价格：裸卡（Ungraded）、Grade 9、PSA 10
      const col = (cls) => parseFloat(((row.match(new RegExp(cls + '">\\s*<span class="js-price">\\s*\\$?([\\d,.]+)')) || [])[1] || "").replace(/,/g, "")) || null;
      const price = col("used_price"), g9 = col("cib_price"), psa10 = col("new_price");
      if (!tm) continue; // 补充包、卡盒等不是单卡的商品
      cards.push([+id, si, tm[3], tm[1], tm[2] || "", img, price, g9, psa10]);
      n++;
    }
    if (rows.length < 150) break;
    await sleep(600);
  }
  // PriceCharting 的 Chinese 里也有繁中系列（M2、SV4a F、Start Deck 100…）：简中的商品代码以 C 结尾（CSV8C、CBB5C、151C、30thC）
  const lang = /C$/i.test(info.code) || info.code === "PROMO" ? "zh-cn" : "zh-tw";
  sets.push({ slug, ...info, lang, count: n });
  console.log(`  ${slug}（${info.name}）：${n} 张`);
  await sleep(500);
}
sets.forEach((s) => (s.rel = s.rel || ""));
}
console.log(`PriceCharting：${sets.length} 个系列，${cards.length} 张`);

// ---------- 官方卡表（PTCG-CHS-Datasets） ----------
const DS = "duanxr/PTCG-CHS-Datasets";
const head = await get(`https://api.github.com/repos/${DS}/commits/main`, true);
const rev = (head && head.sha) || "main";
const ds = (await get(`https://raw.githubusercontent.com/${DS}/${rev}/ptcg_chs_infos.json`, true)) || (await get(`https://cdn.jsdelivr.net/gh/${DS}@${rev}/ptcg_chs_infos.json`, true));
const out = { at: Date.now(), src: "PTCG-CHS-Datasets + PriceCharting", img: `https://cdn.jsdelivr.net/gh/${DS}@${rev.slice(0, 12)}/img/`, sets: [], cards: [] };
const numOf = (s) => { const m = String(s || "").match(/\d+/); return m ? +m[0] : null; };
const PB = /^(poke ?ball|reverse( holo)?)$/i, MB = /^(m(a|s)?s?ter ?ball|masterball|msater ball)$/i;
if (ds && ds.collections) {
  // PriceCharting 的卡按「系列代码 | 编号」分组（151 的旅 / 望 / 惊 / 聚四个盒子都对到 PriceCharting 的 151C）
  const pcBy = new Map(), pcSet = new Map();
  sets.forEach((s, i) => { if (s.lang === "zh-cn") pcSet.set(s.code.toUpperCase(), i); });
  for (const c of cards) { const k = c[1] + "|" + numOf(c[2]); if (!pcBy.has(k)) pcBy.set(k, []); pcBy.get(k).push(c); }
  const used = new Set();
  const kindOf = (col) => col.goodsType === "1" ? "pack" : col.goodsType === "2" ? "deck" : /PROMO|MISSION|-P-|ML\d|GIFT|EVENT/i.test(col.commodityCode) ? "promo" : "deck";
  let matched = 0, total = 0;
  for (const col of ds.collections) {
    const code = String(col.commodityCode).trim();
    const pcI = pcSet.get(code.toUpperCase()) ?? (/^151C\d$/i.test(code) ? pcSet.get("151C") : undefined);
    const si = out.sets.length;
    // 有 ★★ 的系列：★ = 精灵球、★★ = 大师球；只有 ★ 的（老系列）：★ = 镜面
    const balls = col.cards.some((k) => k.details && k.details.special_shiny_type === 2);
    out.sets.push({ slug: "o" + col.id, code, name: String(col.name).trim(), rel: col.salesDate || "", lang: "zh-cn", kind: kindOf(col), src: "o", pcSlug: pcI != null ? sets[pcI].slug : "", count: col.cards.length,
      cover: String(col.image || "").replace(/^img\//, "").replace(/\.png$/, "") }); // 商品封面（补充包 / 礼盒的图）
    for (const k of col.cards) {
      const d = k.details || {}, t = d.special_shiny_type || 0, num = d.collectionNumber || "";
      const label = t === 1 ? (balls ? "精灵球" : "镜面") : t === 2 ? "大师球" : t >= 3 ? "特殊闪" + String(d.rarityText || "").replace(/^[^✦✧◇]*/, "") : "";
      // 稀有度：字母（C / U / R / SAR…，去掉版本记号 ★）；宝石包只有记号（● ◆ ★ ★★ ★★★）就保留记号
      const rt = String(d.rarityText || "").replace(/无标记/g, "").trim(), rar = /^[A-Z]/.test(rt) ? rt.replace(/[^A-Z]/g, "") : t ? "" : rt;
      let pc = null;
      if (pcI != null) {
        // 宝石包编号：官方「01 07/09」（第 1 组第 7 张）= PriceCharting「107」
        const g = String(num).match(/^(\d+)\s+(\d+)\/\d+$/), key = g ? +g[1] * 100 + +g[2] : numOf(num);
        const list = (pcBy.get(pcI + "|" + key) || []).filter((c) => !used.has(c));
        const ex = /ex$/i.test(k.name || ""), pref = (a) => a.sort((x, y) => (/ex$/i.test(y[3]) === ex) - (/ex$/i.test(x[3]) === ex));
        if (t === 0) { const plain = pref(list.filter((c) => !c[4] || /^holo$/i.test(c[4]))); pc = plain[0] || (list.length === 1 && !PB.test(list[0][4]) && !MB.test(list[0][4]) ? list[0] : null); }
        else pc = t === 1 ? list.find((c) => PB.test(c[4])) : t === 2 ? list.find((c) => MB.test(c[4])) : null;
        if (pc && !/^151C\d$/i.test(code)) used.add(pc);
      }
      total++; if (pc) matched++;
      const img = String(k.image || "").replace(/^img\//, "").replace(/\.png$/, "");
      out.cards.push([k.id, si, num, k.name || d.cardName || "", label, img, pc ? pc[6] : null, pc ? pc[7] : null, pc ? pc[8] : null, rar, pc ? `${pc[3]}${pc[4] ? ` [${pc[4]}]` : ""}` : "", pc ? pc[2] : "", pc ? pc[0] : 0]);
    }
  }
  console.log(`官方卡表：${ds.collections.length} 个商品，${total} 张；对上 PriceCharting 价格 ${matched} 张`);
  // PriceCharting 独有的简中系列（官方卡表里没有的）和繁中系列照旧
  const offSet = new Set(ds.collections.map((c) => String(c.commodityCode).trim().toUpperCase()));
  sets.forEach((s, i) => {
    if (s.lang === "zh-cn" && (offSet.has(s.code.toUpperCase()) || (s.code === "151C" && offSet.has("151C1")))) return;
    const si = out.sets.length; out.sets.push({ ...s, src: "pc" });
    for (const c of cards) if (c[1] === i) out.cards.push([c[0], si, ...c.slice(2, 9)]);
  });
} else {
  console.log("官方卡表下载失败，只用 PriceCharting");
  out.sets = sets.map((s) => ({ ...s, src: "pc" })); out.cards = cards;
}
fs.writeFileSync(path.join(ROOT, "cn-dex.json"), JSON.stringify(out));
console.log(`简中卡表：${out.sets.length} 个系列，${out.cards.length} 张`);
