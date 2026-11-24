// 补卡图（借图）：TCGplayer 上没有卡图的日版 / 美版卡（vis/noimg.json），找同一张画的卡借用。宁可补不上，不补错：
//   1. 同一套、同编号、同名的普通版（球纹 / 镜面 / 印章版借普通版）
//   2. 同语言、同时期（发售前 3 年到后 1 年）同名的卡只有一种卡图（卡组 / 套装里的复刻卡借原版）；
//      卡名里写了原编号的（世界赛卡组「Toxicroak G (DP41)」）按编号找
//   1、2 借到的特征加进卡图库（扫描也能认），卡图对照表由 tools/img-refs.mjs 算
//      同名有几种卡图：取发售前最近一年的，那一年只有一种卡图就借（标成参考图）
//   3. 还找不到：另一种语言（日版 ↔ 美版）同时期同名只有一种卡图的，只给图鉴当参考图（不加进卡图库）
// 卡名、编号没记下来的（很早以前记的）先用 TCGplayer 的商品资料补上。本地：node tools/fill-borrow.mjs，然后 node tools/img-refs.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const F = (f) => path.join(ROOT, f);
const meta = JSON.parse(fs.readFileSync(F("vis/meta.json"), "utf8"));
let vecAll = fs.readFileSync(F("vis/vec.bin"));
const noimg = JSON.parse(fs.readFileSync(F("vis/noimg.json"), "utf8"));
const imgRef = fs.existsSync(F("vis/img.json")) ? JSON.parse(fs.readFileSync(F("vis/img.json"), "utf8")) : {};
const D = meta.D;
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

// ---------- 0. 补卡名、编号 ----------
for (const [id, v] of Object.entries(noimg)) {
  if (v.length >= 6 && v[3]) continue;
  let d = null;
  for (let k = 0; k < 3 && !d; k++) { try { const r = await fetch(`https://mp-search-api.tcgplayer.com/v1/product/${id}/details`); if (r.ok) d = await r.json(); } catch {} if (!d) await sleep(1500); }
  if (!d || !d.productName) continue;
  const a = d.customAttributes || {};
  noimg[id] = [v[0], v[1], a.number || "", d.productName, d.rarityName || "", String(a.releaseDate || "").slice(0, 10)];
  await sleep(150);
}

const base = (s) => String(s || "").replace(/\s*\(.*?\)|\s*\[.*?\]/g, "").replace(/\s*-\s*[\w/-]*\d[\w/-]*\s*$/, "").replace(/\s*-\s*\d{4}\b.*$/, "").replace(/\s+/g, " ").trim().toLowerCase();
const special = (it) => /Full Art|Secret|Alternate|Rainbow|Gold|Shiny|Prerelease|Staff|Jumbo|Cosmos|Holo\)|Reverse|Ball|Pattern|Mirror|Stamp/i.test(it[3]) || /Ultra Rare|Secret Rare|Hyper Rare|Rainbow|Special Art|Illustration Rare|Art Rare|Super Rare/i.test(it[4]);
const vec = (i) => { const v = new Float32Array(D); let n = 0; for (let j = 0; j < D; j++) { v[j] = vecAll.readInt8(i * D + j); n += v[j] * v[j]; } n = Math.sqrt(n) || 1; for (let j = 0; j < D; j++) v[j] /= n; return v; };
const cos = (a, b) => { let s = 0; for (let j = 0; j < D; j++) s += a[j] * b[j]; return s; };
const numOf = (n) => { const m = String(n || "").match(/\d+/); return m ? +m[0] : null; };

// 每套的发售年（noimg 里没写发售日的用这套其他卡的）
const setYear = new Map();
meta.items.forEach((it) => { const s = meta.sets[it[1]], k = s[1] + "|" + s[0], y = +String(it[5] || "").slice(0, 4); if (y && (!setYear.has(k) || y < setYear.get(k))) setYear.set(k, y); });
for (const v of Object.values(noimg)) { const y = +String(v[5] || "").slice(0, 4); if (y && (!setYear.has(v[0]) || y < setYear.get(v[0]))) setYear.set(v[0], y); }
const yearOf = (i) => +String(meta.items[i][5] || "").slice(0, 4) || setYear.get(meta.sets[meta.items[i][1]][1] + "|" + meta.sets[meta.items[i][1]][0]) || 0;

// 索引：语言 + 卡名 → 卡；语言 + 套 + 编号 + 卡名 → 卡
const byName = new Map(), bySet = new Map();
meta.items.forEach((it, i) => {
  const s = meta.sets[it[1]], k = s[1] + "|" + base(it[3]);
  if (!special(it)) { if (!byName.has(k)) byName.set(k, []); byName.get(k).push(i); }
  const k2 = s[1] + "|" + s[0] + "|" + numOf(it[2]) + "|" + base(it[3]);
  if (!bySet.has(k2)) bySet.set(k2, i);
});
// 一组候选是不是只有一种卡图：特征两两都很像
function single(cands) {
  const vs = cands.slice(0, 40).map(vec), reps = [];
  vs.forEach((x, k) => { if (!reps.some((r) => cos(vs[r], x) > 0.9)) reps.push(k); });
  return reps.length === 1;
}
function pick(l, v) {
  const y = +String(v[5] || "").slice(0, 4) || setYear.get(v[0]) || 0;
  let c = (byName.get(l + "|" + base(v[3])) || []).filter((i) => { const yy = yearOf(i); return y && yy && yy >= y - 3 && yy <= y + 1; });
  // 卡名里写了原编号：Toxicroak G (DP41)、Pikachu (SWSH020)
  const orig = (String(v[3]).match(/\(([A-Z]{1,5}\d{1,3}[a-z]?)\)/) || [])[1];
  if (orig) { const o = c.filter((i) => String(meta.items[i][2]).replace(/^0+/, "").toUpperCase() === orig.replace(/^([A-Z]+)0*/, "$1") || String(meta.items[i][3]).includes(orig)); if (o.length) c = o; }
  if (!c.length) return { none: true };
  if (single(c)) return { i: c[0] };
  // 有几种卡图：取发售前最近一年的（卡组复刻一般用当时最新的卡图），那一年只有一种卡图才借，标成参考图
  const pre = c.filter((i) => yearOf(i) <= y), last = Math.max(0, ...pre.map(yearOf)), c2 = pre.filter((i) => yearOf(i) === last);
  if (c2.length && single(c2)) return { i: c2[0], guess: true };
  return { ambiguous: true };
}

const setIdx = new Map(meta.sets.map((s, i) => [s[1] + "|" + s[0], i]));
const add = [], stat = { sib: 0, era: 0, guess: 0, ref: 0, ambiguous: 0, none: 0 };
const addItem = (pid, v, src) => {
  const [l, set] = [v[0].slice(0, v[0].indexOf("|")), v[0].slice(v[0].indexOf("|") + 1)];
  if (!setIdx.has(v[0])) { setIdx.set(v[0], meta.sets.length); meta.sets.push([set, l]); }
  meta.items.push([+pid, setIdx.get(v[0]), v[2] || "", String(v[3]).replace(/\s*-\s*[\w/]+$/, ""), v[4] || "", v[5] || ""]);
  add.push(Buffer.from(vecAll.subarray(src * D, (src + 1) * D)));
  delete noimg[pid]; delete imgRef[pid];
};
for (const [pid, v] of Object.entries(noimg)) {
  if (!v[3]) { stat.none++; continue; }
  const l = v[0].slice(0, 2), set = v[0].slice(3);
  // 1. 同套同编号同名（普通版）
  const s1 = bySet.get(l + "|" + set + "|" + numOf(v[2]) + "|" + base(v[3]));
  if (s1 != null && numOf(v[2]) != null) { addItem(pid, v, s1); stat.sib++; continue; }
  // 2. 同语言同时期唯一卡图
  const p = pick(l, v);
  if (p.i != null) { const src = meta.items[p.i][0]; addItem(pid, v, p.i); if (p.guess) { imgRef[pid] = "~" + src; stat.guess++; } else stat.era++; continue; }
  // 3. 另一种语言：只当参考图
  const q = pick(l === "ja" ? "en" : "ja", v);
  if (q.i != null) { imgRef[pid] = "~" + meta.items[q.i][0]; stat.ref++; continue; }
  if (p.ambiguous || q.ambiguous) stat.ambiguous++; else stat.none++;
}
vecAll = Buffer.concat([vecAll, ...add]);
fs.writeFileSync(F("vis/vec.bin"), vecAll);
fs.writeFileSync(F("vis/meta.json"), JSON.stringify(meta));
fs.writeFileSync(F("vis/noimg.json"), JSON.stringify(noimg));
fs.writeFileSync(F("vis/img.json"), JSON.stringify(imgRef));
console.log(`借图：同一张卡的普通版 ${stat.sib}，同时期原版 ${stat.era}，同时期最近一年的（参考图）${stat.guess}，另一种语言当参考图 ${stat.ref}；同名有几种卡图没借 ${stat.ambiguous}，找不到 ${stat.none}。卡图库 ${meta.items.length} 张，还没有卡图 ${Object.keys(noimg).length} 张`);
