// 补卡图（美版复刻）：训练家套装（XY / SM Trainer Kit）、世界赛卡组（World Championship Decks）等全是复刻卡，TCGplayer 没放卡图。
// 同一时期（XY 套装 → XY 系列；2022 年世界赛卡组 → 剑&盾系列…）同名的普通卡如果只有一种卡图，就借用它的特征（世界赛卡组多了金边和签名，图案一样）。
// 同名有好几种卡图的不借（宁可补不上，不补错）。本地跑：node tools/fill-en-reprints.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const F = (f) => path.join(ROOT, f);
const meta = JSON.parse(fs.readFileSync(F("vis/meta.json"), "utf8"));
let vecAll = fs.readFileSync(F("vis/vec.bin"));
const noimg = JSON.parse(fs.readFileSync(F("vis/noimg.json"), "utf8"));
const D = meta.D;
const base = (s) => String(s || "").replace(/\s*\(.*?\)|\s*\[.*?\]/g, "").replace(/\s*-\s*[\w/-]*\d[\w/-]*\s*$/, "").replace(/\s*-\s*\d{4}\b.*$/, "").replace(/\s+/g, " ").trim().toLowerCase();

// 时期 → 系列名的规律（TCGplayer 美版系列名）
const ERA = [
  [/^(EX |Ruby|Sandstorm|Dragon$|Team Magma|Hidden Legends|FireRed|Team Rocket Returns|Deoxys|Emerald|Unseen Forces|Delta Species|Legend Maker|Holon|Crystal Guardians|Dragon Frontiers|Power Keepers)/i, 2003, 2007],
  [/^(Diamond and Pearl|DP|Mysterious Treasures|Secret Wonders|Great Encounters|Majestic Dawn|Legends Awakened|Stormfront|Platinum|Rising Rivals|Supreme Victors|Arceus|HeartGold|HGSS|Unleashed|Undaunted|Triumphant|Call of Legends)/i, 2007, 2011],
  [/^(Black and White|BW)/i, 2011, 2013],
  [/^XY/i, 2014, 2016],
  [/^SM/i, 2017, 2019],
  [/^SWSH/i, 2020, 2022],
  [/^SV/i, 2023, 2026],
];
function eraFor(set, name, rel) {
  if (/XY Trainer Kit/i.test(set)) return ERA[3][0];
  if (/SM Trainer Kit/i.test(set)) return ERA[4][0];
  const y = +((String(name).match(/\b(19|20)\d\d\b/) || [])[0] || String(rel || "").slice(0, 4));
  if (!y) return null;
  const e = ERA.find(([, a, b]) => y >= a && y <= b);
  return e ? e[0] : null;
}
const special = (it) => /Full Art|Secret|Alternate|Rainbow|Gold|Shiny|Prerelease|Staff|Jumbo|Cosmos|Holo\)|Reverse/i.test(it[3]) || /Ultra Rare|Secret Rare|Hyper Rare|Rainbow/i.test(it[4]);
const vec = (i) => { const v = new Float32Array(D); let n = 0; for (let j = 0; j < D; j++) { v[j] = vecAll.readInt8(i * D + j); n += v[j] * v[j]; } n = Math.sqrt(n) || 1; for (let j = 0; j < D; j++) v[j] /= n; return v; };
const cos = (a, b) => { let s = 0; for (let j = 0; j < D; j++) s += a[j] * b[j]; return s; };

const byName = new Map();
meta.items.forEach((it, i) => { if (meta.sets[it[1]][1] !== "en" || special(it)) return; const k = base(it[3]); if (!byName.has(k)) byName.set(k, []); byName.get(k).push(i); });
const setIdx = new Map(meta.sets.map((s, i) => [s[1] + "|" + s[0], i]));
let ok = 0, ambiguous = 0, none = 0;
const add = [];
for (const [pid, v] of Object.entries(noimg)) {
  if (v.length < 6 || !v[0].startsWith("en|")) continue;
  const set = v[0].slice(3), era = eraFor(set, v[3], v[5]);
  if (!era) { none++; continue; }
  const cands = (byName.get(base(v[3])) || []).filter((i) => era.test(meta.sets[meta.items[i][1]][0]));
  if (!cands.length) { none++; continue; }
  // 只有一种卡图（特征彼此都很像）才借
  const vs = cands.slice(0, 30).map(vec), reps = [];
  vs.forEach((x, k) => { if (!reps.some((r) => cos(vs[r], x) > 0.9)) reps.push(k); });
  if (reps.length !== 1) { ambiguous++; continue; }
  const src = cands[0];
  if (!setIdx.has(v[0])) { setIdx.set(v[0], meta.sets.length); meta.sets.push([set, "en"]); }
  meta.items.push([+pid, setIdx.get(v[0]), v[2], String(v[3]).replace(/\s*-\s*[\w/]+$/, ""), v[4], v[5] || ""]);
  add.push(Buffer.from(vecAll.subarray(src * D, (src + 1) * D)));
  delete noimg[pid];
  ok++;
}
vecAll = Buffer.concat([vecAll, ...add]);
fs.writeFileSync(F("vis/vec.bin"), vecAll);
fs.writeFileSync(F("vis/meta.json"), JSON.stringify(meta));
fs.writeFileSync(F("vis/noimg.json"), JSON.stringify(noimg));
console.log(`美版复刻：借用了 ${ok} 张；同名有几种卡图没借 ${ambiguous} 张；找不到原版 ${none} 张。还没有卡图 ${Object.keys(noimg).length} 张`);
