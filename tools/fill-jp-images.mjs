// 补卡图（日版）：TCGplayer 上没有卡图的日版卡（vis/noimg.json 里记着的），去宝可梦卡牌官网（pokemon-card.com）的卡牌检索找同一张卡的官方卡图，
// 算特征加进卡图库。官网收录 DP 时代（2006）以后的卡；更老的卡组（PCG / ADV 时代）官网没有，补不了。
// 怎么认是同一张：英文卡名 → 日文名（names.json）在官网搜，候选卡的详细页上「编号 / 总数」要和 TCGplayer 的一模一样，才算。
// 用法：npm i --no-save playwright && npx playwright install chromium && node tools/fill-jp-images.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const F = (f) => path.join(ROOT, f);
const SITE = "https://www.pokemon-card.com";
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const LIMIT = +process.env.LIMIT || 0;

async function get(url, as = "text") {
  for (let k = 0; k < 4; k++) {
    try { const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (PTCG price app catalog builder)" } }); if (r.ok) return as === "json" ? r.json() : as === "buf" ? Buffer.from(await r.arrayBuffer()) : r.text(); if (r.status === 404) return null; } catch {}
    await sleep(1500 * (k + 1));
  }
  return null;
}

const meta = JSON.parse(fs.readFileSync(F("vis/meta.json"), "utf8"));
let vecAll = fs.readFileSync(F("vis/vec.bin"));
const noimg = JSON.parse(fs.readFileSync(F("vis/noimg.json"), "utf8"));
const names = JSON.parse(fs.readFileSync(F("names.json"), "utf8")).n;

// ---------- 英文名 → 日文名 ----------
const en2ja = new Map();
for (const [en, ja] of names) if (en && ja && !en2ja.has(en.toLowerCase())) en2ja.set(en.toLowerCase(), ja);
const ENERGY = { grass: "草", fire: "炎", water: "水", lightning: "雷", psychic: "超", fighting: "闘", darkness: "悪", metal: "鋼", fairy: "フェアリー" };
// 搜索用的日文关键词：去掉编号、括号、规则后缀（ex / GX / LV.X / G…），找到宝可梦或训练家的日文名
function jaKeyword(enName) {
  let s = String(enName).replace(/\s*\(.*?\)|\s*\[.*?\]/g, "").replace(/\s*-\s*[\w/-]*\d[\w/-]*\s*$/, "").trim();
  const en = s.match(/^(Grass|Fire|Water|Lightning|Psychic|Fighting|Darkness|Metal|Fairy) Energy$/i);
  if (en) return `基本${ENERGY[en[1].toLowerCase()]}エネルギー`;
  if (en2ja.has(s.toLowerCase())) return en2ja.get(s.toLowerCase());
  const base = s.replace(/\s+(ex|EX|GX|V|VMAX|VSTAR|LV\.X|G|GL|FB|C|E4|BREAK|Star|☆|δ|Prime|LEGEND)$/i, "").replace(/^(Mega|M|Dark|Light|Shining|Radiant|Alolan|Galarian|Hisuian|Paldean)\s+/i, "").trim();
  return en2ja.get(base.toLowerCase()) || null;
}

// ---------- 官网检索 ----------
const searchCache = new Map();
async function search(kw) {
  if (searchCache.has(kw)) return searchCache.get(kw);
  const out = [];
  for (let page = 1; page <= 15; page++) {
    const j = await get(`${SITE}/card-search/resultAPI.php?` + new URLSearchParams({ keyword: kw, regulation_sidebar_form: "all", pg: "", illust: "", sm_and_keyword: "true", page }), "json");
    if (!j || !j.cardList) break;
    for (const c of j.cardList) out.push({ id: c.cardID, img: c.cardThumbFile, folder: c.cardThumbFile.split("/").slice(-2, -1)[0], name: c.cardNameAltText });
    if (page >= j.maxPage) break;
    await sleep(300);
  }
  searchCache.set(kw, out);
  return out;
}
const detailCache = new Map();
async function detail(id) {
  if (detailCache.has(id)) return detailCache.get(id);
  const h = (await get(`${SITE}/card-search/details.php/card/${id}/regu/all`)) || "";
  const txt = h.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
  const m = txt.match(/(\d{1,3})\s*\/\s*([A-Za-z0-9-]{1,6})\s+イラストレーター/) || txt.match(/(\d{1,3})\s*\/\s*(\d{1,3})/);
  const mark = (h.match(/class="img-regulation"[^>]*alt="([^"]*)"/) || [])[1] || "";
  const d = m ? { n: parseInt(m[1], 10), total: m[2], mark } : null;
  detailCache.set(id, d);
  await sleep(120);
  return d;
}
const codeOf = (set) => (set.includes(":") ? set.split(":")[0].trim() : { "World Champions Pack": "WCP" }[set] || "");

// ---------- 找同一张卡 ----------
// 先按系列：官网检索能按「商品」筛（pg = 卡图文件夹名，例如 SVM、WCP、L1-Bss），一次拿到整套卡，再按编号对。
// 文件夹名不知道时：先猜 TCGplayer 的系列代码，猜不中就用卡名搜这套里的一两张卡，从对上的那张学到文件夹名。
async function product(pg) {
  const out = [];
  for (let page = 1; page <= 40; page++) {
    const j = await get(`${SITE}/card-search/resultAPI.php?` + new URLSearchParams({ keyword: "", regulation_sidebar_form: "all", pg, illust: "", sm_and_keyword: "true", page }), "json");
    if (!j || !j.cardList || !j.hitCnt) break;
    for (const c of j.cardList) out.push({ id: c.cardID, img: c.cardThumbFile, folder: c.cardThumbFile.split("/").slice(-2, -1)[0] });
    if (page >= j.maxPage) break;
    await sleep(300);
  }
  return out;
}
async function findByName(v) {
  const [key, , n, name] = v, code = codeOf(key.slice(3)).toUpperCase(), [num, total] = String(n).split("/"), N = parseInt(num, 10);
  const kw = jaKeyword(name);
  if (!kw || !N) return null;
  let cands = await search(kw);
  const byFolder = code ? cands.filter((c) => c.folder.toUpperCase() === code || c.folder.toUpperCase().startsWith(code + "-")) : [];
  if (byFolder.length) cands = byFolder;
  for (const c of cands.slice(0, byFolder.length ? 20 : 12)) {
    const d = await detail(c.id);
    if (!d || d.n !== N) continue;
    if (total && /^\d+$/.test(total) && /^\d+$/.test(d.total) && parseInt(total, 10) !== parseInt(d.total, 10)) continue;
    if (!byFolder.length && code && d.mark && d.mark.toUpperCase() !== code) continue;
    return c;
  }
  return null;
}
const todo = Object.entries(noimg).filter(([, v]) => v.length >= 6 && v[0].startsWith("ja|"));
console.log(`日版没有卡图：${todo.length} 张`);
const bySet = new Map();
for (const [pid, v] of LIMIT ? todo.slice(0, LIMIT) : todo) { if (!bySet.has(v[0])) bySet.set(v[0], []); bySet.get(v[0]).push([pid, v]); }
const found = [];
const add1 = (pid, v, img) => found.push({ pid: +pid, key: v[0], set: v[0].slice(3), n: v[2], name: v[3], r: v[4], rel: v[5], img: SITE + img });
for (const [key, list] of bySet) {
  const code = codeOf(key.slice(3));
  let folder = null, cards = [];
  for (const g of [...new Set([code, code.toUpperCase()].filter(Boolean))]) { cards = await product(g); if (cards.length) { folder = g; break; } }
  if (!folder) for (const [, v] of list.slice(0, 4)) { const c = await findByName(v); if (c) { folder = c.folder; cards = await product(folder); break; } }
  // 只缺一两张：先按卡名找（比扫整套快）
  if (list.length <= 3) {
    const rest = [];
    for (const [pid, v] of list) { const c = await findByName(v); if (c) add1(pid, v, c.img); else rest.push([pid, v]); }
    console.log(`  ${key}：按卡名找到 ${list.length - rest.length}/${list.length}`);
    if (!rest.length) continue;
    list.splice(0, list.length, ...rest);
  }
  if (!folder || !cards.length) {
    // 不知道是哪套：一张一张按卡名找
    let k = 0;
    for (const [pid, v] of list) { const c = await findByName(v); if (c) { add1(pid, v, c.img); k++; } }
    console.log(`  ${key}：没找到对应的商品，按卡名找到 ${k}/${list.length}`);
    continue;
  }
  // 整套卡的编号（详细页上的「编号 / 总数」）：4 张一起查，要的编号都找到了就停
  const need = new Set(list.map(([, v]) => parseInt(String(v[2]).split("/")[0], 10)).filter(Boolean));
  const byNum = new Map();
  for (let i = 0; i < cards.length && [...need].some((n) => !byNum.has(n)); i += 4) {
    const ds = await Promise.all(cards.slice(i, i + 4).map((c) => detail(c.id)));
    ds.forEach((d, j) => { if (d && !byNum.has(d.n)) byNum.set(d.n, cards[i + j]); });
  }
  let k = 0;
  for (const [pid, v] of list) {
    const N = parseInt(String(v[2]).split("/")[0], 10), c = N && byNum.get(N);
    if (c) { add1(pid, v, c.img); k++; }
  }
  console.log(`  ${key} → 官网 ${folder}（${cards.length} 张）：对上 ${k}/${list.length}`);
}
console.log(`找到 ${found.length} 张`);
if (process.env.DRY) { fs.writeFileSync(process.env.DRY, JSON.stringify(found, null, 1)); process.exit(0); }
if (!found.length) process.exit(0);

// ---------- 算特征（无界面 Chrome，网页同一份 vis.js；图片在这边下载好再交给网页，避免跨域） ----------
const { chromium } = await import(process.env.PLAYWRIGHT || "playwright");
const browser = await chromium.launch();
const page = await browser.newPage();
const TYPES = { ".js": "text/javascript", ".json": "application/json", ".onnx": "application/octet-stream" };
await page.route("http://site.local/**", (route) => {
  const f = path.join(ROOT, decodeURIComponent(new URL(route.request().url()).pathname));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: "" });
  return route.fulfill({ status: 200, contentType: TYPES[path.extname(f)] || "application/octet-stream", body: fs.readFileSync(f) });
});
await page.goto("http://site.local/manifest.json");
await page.evaluate(async () => {
  window.V = await import("/vis.js"); await V.loadModel();
  window.embedData = async (src) => {
    const im = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
    return Array.from(V.quantize(await V.embed(V.cardCanvas(im, 0, 0, im.naturalWidth, im.naturalHeight))));
  };
});
const setIdx = new Map(meta.sets.map((s, i) => [s[1] + "|" + s[0], i]));
const stripNo = (s) => String(s || "").replace(/\s*-\s*[\w/]+$/, "");
const add = [];
let ok = 0;
for (const c of found) {
  const buf = await get(c.img, "buf");
  if (!buf) continue;
  let v;
  try { v = await page.evaluate((d) => embedData(d), "data:image/jpeg;base64," + buf.toString("base64")); } catch { continue; }
  if (!setIdx.has(c.key)) { setIdx.set(c.key, meta.sets.length); meta.sets.push([c.set, "ja"]); }
  meta.items.push([c.pid, setIdx.get(c.key), c.n, stripNo(c.name), c.r, c.rel || ""]);
  add.push(Buffer.from(Int8Array.from(v).buffer));
  delete noimg[c.pid];
  ok++;
  if (ok % 50 === 0) console.log(`  已算 ${ok}/${found.length}`);
  await sleep(150);
}
await browser.close();
vecAll = Buffer.concat([vecAll, ...add]);
fs.writeFileSync(F("vis/vec.bin"), vecAll);
fs.writeFileSync(F("vis/meta.json"), JSON.stringify(meta));
fs.writeFileSync(F("vis/noimg.json"), JSON.stringify(noimg));
console.log(`卡图库：用官网卡图补了 ${ok} 张，共 ${meta.items.length} 张；还没有卡图 ${Object.keys(noimg).length} 张`);
