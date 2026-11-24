// 更新整卡比对的卡图库（vis/vec.bin + vis/meta.json），只算新卡。GitHub Actions 每周跑一次（.github/workflows/index.yml），也可以本地跑：
//   npm i --no-save playwright && npx playwright install chromium && node tools/update-index.mjs
// 做的事和原来电脑上的三步一样（build-catalog.ps1 → add-originals.ps1 → build-index.html），合成一个：
// 1. 问 TCGplayer 每个系列有几张单卡，比卡图库里多的系列才去一页一页列（日版 / 美版，所有年份，包括各种特典卡）
// 2. 复刻卡（Classic Collection）按「卡名 + 编号」找原版一起加进去（扫描时原版和复刻一起列出来让你选）
// 3. 在无界面的 Chrome 里用网页同一份 vis.js 算特征（保证和手机上扫描时的算法完全一样），接在卡图库后面
// 卡很多时分几次做完：每算 1000 张存一次，到了时间（MINUTES，默认 80 分钟）就停，下次接着算。
// TCGplayer 上没有卡图的商品（很多球纹版、预售）记在 vis/noimg.json，60 天后再试，免得每周都白下载一遍。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SINCE = process.env.SINCE || "1996-01-01";
const LIMIT = +process.env.LIMIT || 0; // 测试用：最多算几张
const MINUTES = +process.env.MINUTES || 80;
const PAGES = +process.env.PAGES || 3; // 同时开几个网页算（CPU 核数 - 1 左右）
const NOIMG_RETRY_DAYS = 60;
const API = "https://mp-search-api.tcgplayer.com/v1/search/request?isList=false&q=";
const T0 = Date.now();
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const day = (s) => String(s || "").slice(0, 10);
const today = day(new Date().toISOString());
const stripNo = (s) => String(s || "").replace(/\s*-\s*[\w/]+$/, "");
const F = (f) => path.join(ROOT, f);

async function search(term, from, size, q = "", fuzzy = false, range = {}) {
  const body = {
    algorithm: "sales_synonym_v2", from, size,
    filters: { term, range, match: {} },
    listingSearch: { context: { cart: {} }, filters: { term: {}, range: {}, exclude: { channelExclusion: 0 } } },
    context: { cart: {}, shippingCountry: "US" },
    settings: { useFuzzySearch: fuzzy, didYouMean: {} }, sort: {},
  };
  for (let k = 0; k < 4; k++) {
    try {
      const r = await fetch(API + encodeURIComponent(q), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (r.ok) return (await r.json()).results[0];
    } catch {}
    await sleep(2000 * (k + 1));
  }
  throw new Error("TCGplayer 搜索失败");
}
const toItem = (p, l) => ({ id: +p.productId, l, set: p.setName, n: String(p.customAttributes?.number || ""), name: p.productName, r: String(p.rarityName || ""), rel: day(p.customAttributes?.releaseDate) });

// ---------- 1. 新卡清单 ----------
const meta = JSON.parse(fs.readFileSync(F("vis/meta.json"), "utf8"));
let vecAll = fs.readFileSync(F("vis/vec.bin"));
if (vecAll.length !== meta.items.length * meta.D) throw new Error("vec.bin 和 meta.json 对不上");
let noimg = {}; // 商品号 → [ "l|系列", 上次试的日期 ]
try { noimg = JSON.parse(fs.readFileSync(F("vis/noimg.json"), "utf8")); } catch {}
const stale = (d) => (Date.parse(today) - Date.parse(d)) / 864e5 >= NOIMG_RETRY_DAYS;
const have = new Set(meta.items.map((x) => x[0]));
const perSet = new Map(); // "l|set" → 卡图库里有几张（加上没有卡图、还不用再试的）
const bump = (k) => perSet.set(k, (perSet.get(k) || 0) + 1);
for (const it of meta.items) { const s = meta.sets[it[1]]; bump(s[1] + "|" + s[0]); }
for (const [, [k, d]] of Object.entries(noimg)) if (!stale(d)) bump(k);
// ---------- 没有卡图的版本用同一张卡的卡图代替 ----------
// 球纹 / 镜面 / 反闪等版本（TCGplayer 常常没放卡图）和普通版卡图几乎一样；世界赛卡组等复刻和原版同名同编号。
// 找到「同语言 + 同系列 + 同编号 + 同名」的卡（找不到再放宽到其他系列、但编号要带总数），用它的特征，扫描时会作为同一张卡的一个版本列出来
const baseNm = (s) => String(s || "").replace(/\s*\(.*?\)|\s*\[.*?\]/g, "").replace(/\s*-\s*[\w/-]*\d[\w/-]*\s*$/, "").replace(/\s+/g, " ").trim().toLowerCase();
const sib = new Map();
const sibKeys = (l, set, n, name) => [`${l}|${set}|${n}|${baseNm(name)}`].concat(/\d\/\d/.test(n) ? [`${l}||${n}|${baseNm(name)}`] : []);
meta.items.forEach((it, i) => { const st = meta.sets[it[1]]; for (const k of sibKeys(st[1], st[0], it[2], it[3])) if (!sib.has(k)) sib.set(k, i); });
const findSib = (c) => { for (const k of sibKeys(c.l, c.set, c.n, c.name)) if (sib.has(k)) return sib.get(k); return -1; };
const fresh = [];
const RANGE = SINCE > "1996" ? { releaseDate: { gte: SINCE } } : {};
for (const [line, l] of [["pokemon-japan", "ja"], ["pokemon", "en"]]) {
  const sets = (await search({ productLineName: [line], productTypeName: ["Cards"] }, 0, 1, "", false, RANGE)).aggregations.setName;
  let looked = 0;
  for (const s of sets) {
    // TCGplayer 的张数比卡图库多才需要看
    if ((perSet.get(l + "|" + s.value) || 0) >= s.count) continue;
    const got = [];
    for (let from = 0; from < 2000; from += 50) {
      const page = await search({ productLineName: [line], setName: [s.urlValue], productTypeName: ["Cards"] }, from, 50, "", false, RANGE);
      for (const p of page.results) got.push(toItem(p, l));
      if (page.results.length < 50 || from + 50 >= page.totalResults) break;
      await sleep(200);
    }
    looked++;
    const add = got.filter((x) => !have.has(x.id) && !(noimg[x.id] && !stale(noimg[x.id][1])));
    for (const x of add) have.add(x.id);
    if (add.length) { fresh.push(...add); console.log(`  ${l} ${s.value}: +${add.length}`); }
  }
  console.log(`${line}：${sets.length} 个系列，看了 ${looked} 个`);
}
// ---------- 2. 复刻卡的原版（老卡已经整套在库里了，这一步只在只收新卡时有用） ----------
if (SINCE > "1996") for (const c of fresh.filter((x) => /Classic Collection/.test(x.set))) {
  const name = stripNo(c.name).replace(/\s*\(.*?\)/g, "").trim(), num = c.n.split("/")[0].replace(/^0+/, "");
  let res;
  try { res = (await search({ productLineName: [c.l === "en" ? "pokemon" : "pokemon-japan"], productTypeName: ["Cards"] }, 0, 24, `${name} ${c.n}`, true)).results; } catch { continue; }
  for (const p of res) {
    const pn = String(p.customAttributes?.number || "");
    if (!pn || pn.split("/")[0].replace(/^0+/, "") !== num) continue;
    if (/Classic Collection|Jumbo/.test(p.setName) || have.has(+p.productId)) continue;
    if (stripNo(p.productName).replace(/\s*\(.*?\)/g, "").trim() !== name) continue;
    const x = toItem(p, c.l);
    have.add(x.id); fresh.push(x);
    console.log(`  原版 + ${x.set} ${x.n} ${x.name}`);
  }
  await sleep(250);
}
// 新出的卡先算（老卡多，分几次做完时新卡不用等）
fresh.sort((a, b) => (b.rel || "").localeCompare(a.rel || ""));
const todo = LIMIT ? fresh.slice(0, LIMIT) : fresh;
console.log(`新卡 ${fresh.length} 张${LIMIT ? `（这次只算 ${todo.length} 张）` : ""}`);
if (process.env.DRY) { fs.writeFileSync(process.env.DRY, JSON.stringify(fresh, null, 1)); process.exit(0); } // 只看清单不算
// 以前记下的「没有卡图」的：先试试能不能用同一张卡的卡图代替（不用浏览器）
{
  const setIdx0 = new Map(meta.sets.map((st, i) => [st[1] + "|" + st[0], i]));
  const add = [];
  for (const [id, v] of Object.entries(noimg)) {
    if (v.length < 6) continue; // 旧格式没记卡名编号
    const [key, , n, name, r, rel] = v, [l, ...rest] = key.split("|"), c = { l, set: rest.join("|"), n, name };
    const i = findSib(c);
    if (i < 0) continue;
    if (!setIdx0.has(key)) { setIdx0.set(key, meta.sets.length); meta.sets.push([c.set, l]); }
    meta.items.push([+id, setIdx0.get(key), n, stripNo(name), r, rel || ""]);
    add.push(vecAll.subarray(i * meta.D, (i + 1) * meta.D));
    delete noimg[id];
  }
  if (add.length) {
    vecAll = Buffer.concat([vecAll, ...add.map((v) => Buffer.from(v))]);
    fs.writeFileSync(F("vis/vec.bin"), vecAll); fs.writeFileSync(F("vis/meta.json"), JSON.stringify(meta)); fs.writeFileSync(F("vis/noimg.json"), JSON.stringify(noimg));
    console.log(`没有卡图的：${add.length} 张用同一张卡的卡图代替（球纹 / 镜面等版本、复刻）`);
  }
}
if (!todo.length) process.exit(0);

// ---------- 3. 算特征（无界面 Chrome，网页同一份 vis.js） ----------
const { chromium } = await import(process.env.PLAYWRIGHT || "playwright");
const browser = await chromium.launch();
const TYPES = { ".js": "text/javascript", ".json": "application/json", ".onnx": "application/octet-stream", ".html": "text/html" };
async function openPage() {
  const page = await browser.newPage();
  // 网站文件直接从仓库里读（模型在 models/ 下面，和网站上一样）
  await page.route("http://site.local/**", (route) => {
    const f = path.join(ROOT, decodeURIComponent(new URL(route.request().url()).pathname));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ status: 200, contentType: TYPES[path.extname(f)] || "application/octet-stream", body: fs.readFileSync(f) });
  });
  await page.goto("http://site.local/manifest.json");
  const device = await page.evaluate(async () => {
    window.V = await import("/vis.js");
    const m = await V.loadModel();
    window.loadImg = (u) => new Promise((ok, no) => {
      const i = new Image(), t = setTimeout(() => { i.src = ""; no(u); }, 20000);
      i.crossOrigin = "anonymous"; i.onload = () => { clearTimeout(t); ok(i); }; i.onerror = () => { clearTimeout(t); no(u); }; i.src = u;
    });
    // 一批：图片同时下载，特征一张一张算。没有图返回 null
    window.embedIds = (ids) => Promise.all(ids.map(async (id) => {
      for (const u of [`https://tcgplayer-cdn.tcgplayer.com/product/${id}_200w.jpg`, `https://tcgplayer-cdn.tcgplayer.com/product/${id}_in_400x400.jpg`]) {
        try { return await loadImg(u); } catch {}
      }
      return null;
    })).then(async (ims) => {
      const out = [];
      for (const im of ims) out.push(im ? Array.from(V.quantize(await V.embed(V.cardCanvas(im, 0, 0, im.naturalWidth, im.naturalHeight)))) : null);
      return out;
    });
    return m.device;
  });
  return { page, device };
}
const pages = [];
for (let i = 0; i < PAGES; i++) pages.push(await openPage());
console.log(`模型：${pages[0].device} × ${pages.length}`);

const setIdx = new Map(meta.sets.map((s, i) => [s[1] + "|" + s[0], i]));
let fresh8 = [], ok = 0, fail = 0, proxied = 0, sinceSave = 0, next = 0, stop = false;
function save() {
  if (fresh8.length) {
    const add = new Int8Array(fresh8.length * meta.D);
    fresh8.forEach((v, i) => add.set(v, i * meta.D));
    vecAll = Buffer.concat([vecAll, Buffer.from(add.buffer)]);
    fresh8 = [];
  }
  meta.built = today;
  fs.writeFileSync(F("vis/vec.bin"), vecAll);
  fs.writeFileSync(F("vis/meta.json"), JSON.stringify(meta));
  fs.writeFileSync(F("vis/noimg.json"), JSON.stringify(noimg));
  sinceSave = 0;
}
async function worker({ page }) {
  while (!stop && next < todo.length) {
    if ((Date.now() - T0) / 60e3 > MINUTES) { stop = true; break; }
    const batch = todo.slice(next, next + 8); next += 8;
    let out;
    try { out = await page.evaluate((ids) => embedIds(ids), batch.map((c) => c.id)); } catch (e) { console.log("  这批出错，下次再算：", String(e).slice(0, 120)); continue; }
    batch.forEach((c, j) => {
      const key = c.l + "|" + c.set;
      if (!out[j]) {
        // 没有卡图：同一张卡（普通版 / 原版）在库里就借用它的特征；不在就记下来（连卡名编号一起，下次还能再借）
        const si = findSib(c);
        if (si < 0) { fail++; noimg[c.id] = [key, today, c.n, c.name, c.r, c.rel || ""]; return; }
        const base = vecAll.length / meta.D;
        out[j] = Array.from(si < base ? vecAll.subarray(si * meta.D, (si + 1) * meta.D) : fresh8[si - base]);
        proxied++;
      }
      delete noimg[c.id];
      if (!setIdx.has(key)) { setIdx.set(key, meta.sets.length); meta.sets.push([c.set, c.l]); }
      // meta 和向量要一一对应：两边同时加
      meta.items.push([c.id, setIdx.get(key), c.n, stripNo(c.name), c.r, c.rel || ""]);
      fresh8.push(Int8Array.from(out[j]));
      for (const k of sibKeys(c.l, c.set, c.n, c.name)) if (!sib.has(k)) sib.set(k, meta.items.length - 1);
      ok++; sinceSave++;
    });
    if (sinceSave >= 1000) { save(); console.log(`  已算 ${ok + fail}/${todo.length}（${((Date.now() - T0) / 60e3).toFixed(0)} 分钟），已保存`); }
  }
}
await Promise.all(pages.map(worker));
await browser.close();
save();
console.log(`卡图库：加了 ${ok} 张（其中 ${proxied} 张借用同一张卡的卡图），没有卡图 ${fail} 张，共 ${meta.items.length} 张${stop ? `；时间到了，还剩 ${todo.length - next} 张下次接着算` : ""}`);
