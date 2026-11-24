// 图鉴的简中卡表 cn-dex.json：简中没有公开的卡牌数据库（官方卡表只在微信小程序里），用 PriceCharting 的简中系列（卡名、编号、卡图、裸卡价，美元）。
// 系列中文名和发售日用 TCGdex 的简中系列表。每天跟着发售日历一起更新（价格每天变）；本地：node tools/build-cn.mjs
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
const sets = [], cards = [];
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
fs.writeFileSync(path.join(ROOT, "cn-dex.json"), JSON.stringify({ at: Date.now(), src: "PriceCharting", sets, cards }));
console.log(`简中卡表：${sets.length} 个系列，${cards.length} 张`);
