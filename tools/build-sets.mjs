// 图鉴用的系列表 vis/sets.json（日版 / 美版）：系列名、TCGplayer 的系列网址名（价格服务器 ?set= 一次拿整套价格用）、张数、发售日、分类。
// 每周跟着「更新卡图库」跑；本地：node tools/build-sets.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const F = (f) => path.join(ROOT, f);
const API = "https://mp-search-api.tcgplayer.com/v1/search/request?isList=false&q=";
async function aggs(line) {
  const body = { algorithm: "sales_synonym_v2", from: 0, size: 1, filters: { term: { productLineName: [line], productTypeName: ["Cards"] }, range: {}, match: {} },
    listingSearch: { context: { cart: {} }, filters: { term: {}, range: {}, exclude: { channelExclusion: 0 } } }, context: { cart: {}, shippingCountry: "US" }, settings: { useFuzzySearch: false, didYouMean: {} }, sort: {} };
  for (let k = 0; k < 4; k++) {
    try { const r = await fetch(API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); if (r.ok) return (await r.json()).results[0].aggregations.setName; } catch {}
    await new Promise((ok) => setTimeout(ok, 2000 * (k + 1)));
  }
  throw new Error("TCGplayer 搜索失败");
}
// 分类：扩充包 / 卡组 & 礼盒 / 特典卡
function kind(name) {
  if (/promo|-P\b|-P:|black star|prerelease|staff|mcdonald|championship|league|play!|player placement|trainer promos|jumbo|world champ/i.test(name)) return "promo";
  if (/deck|starter|start|trainer kit|kit\b|box|gift|collection|bundle|tin|set\b|battle academy|half deck|quarter|pack \(|my first battle|build/i.test(name)) return "deck";
  return "pack";
}
const meta = JSON.parse(fs.readFileSync(F("vis/meta.json"), "utf8"));
// 发售日：卡图库里这套卡最早的发售日
const rel = new Map();
for (const it of meta.items) { const s = meta.sets[it[1]], k = s[1] + "|" + s[0]; if (it[5] && (!rel.has(k) || it[5] < rel.get(k))) rel.set(k, it[5]); }
const out = [];
for (const [line, l] of [["pokemon-japan", "ja"], ["pokemon", "en"]]) {
  for (const s of await aggs(line)) out.push({ l, name: s.value, slug: s.urlValue, count: s.count, rel: rel.get(l + "|" + s.value) || "", kind: kind(s.value) });
}
out.sort((a, b) => (b.rel || "").localeCompare(a.rel || ""));
fs.writeFileSync(F("vis/sets.json"), JSON.stringify({ at: new Date().toISOString().slice(0, 10), sets: out }));
console.log(`系列表：日版 ${out.filter((s) => s.l === "ja").length}，美版 ${out.filter((s) => s.l === "en").length}`);
