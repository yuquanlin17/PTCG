// 生成按名字查卡用的词典 names.json（网页「输入名字查卡」用；偶尔跑一次就行，出了新宝可梦 / 新训练家再跑）：
//   npm i --no-save opencc-js@1.0.5 pinyin-pro@3.26.0 && node tools/build-names.mjs
// 1. 宝可梦名（PokeAPI）：英文 / 日文片假名 / 繁中 / 简中
// 2. 卡名（训练家、道具、「莉莉艾的皮皮ex」这类）：同一张日版卡在 TCGplayer 上是英文名、在 TCGdex 上有日文名和繁中名，
//    按「系列代码 + 编号」对起来；简中由繁中转换（OpenCC）
// 3. 汉字 → 拼音（不带声调）：输入同音字也能找到（烈空坐 / 裂空座 / 列空座）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as OpenCC from "opencc-js";
import { pinyin } from "pinyin-pro";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TCGDEX = "https://api.tcgdex.net/v2";
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
async function getJSON(u) {
  for (let k = 0; k < 4; k++) {
    try { const r = await fetch(u); if (r.ok) return await r.json(); if (r.status === 404) return null; } catch {}
    await sleep(1500 * (k + 1));
  }
  return null;
}
async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}
const toHans = OpenCC.Converter({ from: "tw", to: "cn" });
const baseEn = (s) => String(s || "").replace(/\s*\(.*?\)\s*/g, " ").replace(/\s+/g, " ").trim().replace(/\s*-\s*[\w/-]*\d[\w/-]*$/, "").trim();

// ---------- 1. 宝可梦 ----------
const list = await getJSON("https://pokeapi.co/api/v2/pokemon-species?limit=3000");
const species = (await pool(list.results, 8, async (s) => {
  const j = await getJSON(s.url);
  if (!j) return null;
  const nm = (code) => (j.names.find((x) => x.language.name === code) || {}).name || "";
  return [nm("en"), nm("ja-hrkt") || nm("ja"), nm("zh-hant"), nm("zh-hans"), 1];
})).filter((x) => x && x[0]);
console.log(`宝可梦：${species.length}`);

// ---------- 2. 卡名：日版 TCGplayer 英文名 ↔ TCGdex 日文 / 繁中 ----------
const meta = JSON.parse(fs.readFileSync(path.join(ROOT, "vis/meta.json"), "utf8"));
const enByKey = new Map(); // "SV8A|236" → 英文名
for (const it of meta.items) {
  const s = meta.sets[it[1]];
  if (s[1] !== "ja") continue;
  const code = s[0].includes(":") ? s[0].split(":")[0].trim().toUpperCase() : s[0].replace(/ Promotional cards$/i, "").trim().toUpperCase();
  const n = parseInt(String(it[2]).split("/")[0], 10);
  if (code && n) enByKey.set(code + "|" + n, baseEn(it[3]));
}
const tcgdexNames = async (lang) => {
  const sets = (await getJSON(`${TCGDEX}/${lang}/sets`)) || [];
  const m = new Map();
  await pool(sets, 6, async (s) => {
    const d = await getJSON(`${TCGDEX}/${lang}/sets/${encodeURIComponent(s.id)}`);
    for (const c of (d && d.cards) || []) { const n = parseInt(c.localId, 10); if (n) m.set(String(s.id).toUpperCase() + "|" + n, c.name); }
  });
  return m;
};
const [ja, tw] = [await tcgdexNames("ja"), await tcgdexNames("zh-tw")];
console.log(`TCGdex 日版 ${ja.size} 张，繁中 ${tw.size} 张，TCGplayer 日版英文名 ${enByKey.size} 张`);
// TCGdex 繁中有的系列代码和日版同名但内容不同：按宝可梦名核对，一套里对不上的多就整套不用
const spJa = species.map((s) => [s[1], s[2]]).filter((x) => x[0] && x[1]).sort((a, b) => b[0].length - a[0].length);
const setCheck = new Map(); // 系列 → [对上, 总数]
for (const [key, tn] of tw) {
  const jn = ja.get(key); if (!jn) continue;
  const sp = spJa.find(([j]) => jn.includes(j)); if (!sp) continue;
  const code = key.split("|")[0], c = setCheck.get(code) || [0, 0];
  c[1]++; if (tn.includes(sp[1])) c[0]++;
  setCheck.set(code, c);
}
const badTw = new Set([...setCheck].filter(([, [a, b]]) => b >= 3 && a / b < 0.7).map(([k]) => k));
for (const key of [...tw.keys()]) if (badTw.has(key.split("|")[0]) || !ja.has(key)) tw.delete(key);
console.log(`繁中系列对不上日版、不用：${[...badTw].join(" ") || "无"}`);
// 同一个英文名可能对到几个日文名（翻译 / 读错）：取出现最多的
const votes = new Map(); // en → { ja: Map, tw: Map }
const vote = (m, k) => k && m.set(k, (m.get(k) || 0) + 1);
for (const [key, en] of enByKey) {
  if (!en || /^\d+$/.test(en)) continue;
  const v = votes.get(en) || { ja: new Map(), tw: new Map() };
  vote(v.ja, ja.get(key)); vote(v.tw, tw.get(key));
  votes.set(en, v);
}
// 只要能对上日文或繁中的、不是单纯宝可梦名的（宝可梦名已经有了）
const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
const spEn = new Set(species.map((s) => s[0].toLowerCase()));
const cards = [];
for (const [en, v] of votes) {
  if (spEn.has(en.toLowerCase())) continue;
  const j = top(v.ja), t = top(v.tw);
  if (!j && !t) continue;
  cards.push([en, j, t, t ? toHans(t) : "", 0]);
}
// 训练家名：从「Lillie's Clefairy ex / リーリエのピッピex / 莉莉艾的皮皮ex」拆出「Lillie / リーリエ / 莉莉艾」
const owners = new Map(); // en → { ja: Map, tw: Map }
for (const [en, j, t] of cards) {
  const m = en.match(/^(.+?)['’]s\s/);
  if (!m || /\s/.test(m[1].replace(/^(Team|Professor|Rocket)\s/, ""))) continue;
  const v = owners.get(m[1]) || { ja: new Map(), tw: new Map() };
  if (j.includes("の")) vote(v.ja, j.split("の")[0]);
  if (t.includes("的")) vote(v.tw, t.split("的")[0]);
  owners.set(m[1], v);
}
const haveEn = new Set(cards.map((c) => c[0].toLowerCase()));
for (const [en, v] of owners) {
  if (haveEn.has(en.toLowerCase()) || spEn.has(en.toLowerCase())) continue;
  const j = top(v.ja), t = top(v.tw);
  if (j || t) cards.push([en, j, t, t ? toHans(t) : "", 0]);
}
console.log(`卡名：${cards.length}`);

// ---------- 3. 拼音表 ----------
// 常用汉字：GB2312（简体）+ Big5（繁体），再加上词典里出现的字
const chars = new Set();
const dec = (enc, hi, lo) => { const d = new TextDecoder(enc); for (let a = hi[0]; a <= hi[1]; a++) for (let b = lo[0]; b <= lo[1]; b++) { const s = d.decode(new Uint8Array([a, b])); if (/^[一-鿿]$/.test(s)) chars.add(s); } };
dec("gbk", [0xb0, 0xf7], [0xa1, 0xfe]);
dec("big5", [0xa4, 0xf9], [0x40, 0xfe]);
for (const e of [...species, ...cards]) for (const ch of (e[2] + e[3]).match(/[一-鿿]/g) || []) chars.add(ch);
const bySyl = new Map();
for (const ch of chars) {
  const p = pinyin(ch, { toneType: "none", type: "array" })[0];
  if (!p || !/^[a-zü]+$/.test(p)) continue;
  bySyl.set(p, (bySyl.get(p) || "") + ch);
}
const py = [...bySyl.entries()].map(([s, c]) => s + ":" + c).join("|");
console.log(`拼音：${chars.size} 个字，${bySyl.size} 个音`);

const out = { v: 1, built: new Date().toISOString().slice(0, 10), n: [...species, ...cards], py };
fs.writeFileSync(path.join(ROOT, "names.json"), JSON.stringify(out));
console.log(`names.json：${(fs.statSync(path.join(ROOT, "names.json")).size / 1024).toFixed(0)} KB`);
