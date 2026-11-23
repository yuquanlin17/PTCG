// 更新整卡比对的卡图库（vis/vec.bin + vis/meta.json），只算新卡。GitHub Actions 每周跑一次（.github/workflows/index.yml），也可以本地跑：
//   npm i --no-save playwright && npx playwright install chromium && node tools/update-index.mjs
// 做的事和原来电脑上的三步一样（build-catalog.ps1 → add-originals.ps1 → build-index.html），合成一个：
// 1. 问 TCGplayer 每个系列有几张单卡，比卡图库里多的系列才去一页一页列（2020 年以后发售的日版 / 美版）
// 2. 复刻卡（Classic Collection）按「卡名 + 编号」找原版一起加进去（扫描时原版和复刻一起列出来让你选）
// 3. 在无界面的 Chrome 里用网页同一份 vis.js 算特征（保证和手机上扫描时的算法完全一样），接在卡图库后面
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SINCE = process.env.SINCE || "2020-01-01";
const LIMIT = +process.env.LIMIT || 0; // 测试用：最多算几张
const API = "https://mp-search-api.tcgplayer.com/v1/search/request?isList=false&q=";
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const day = (s) => String(s || "").slice(0, 10);
const stripNo = (s) => String(s || "").replace(/\s*-\s*[\w/]+$/, "");

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
const meta = JSON.parse(fs.readFileSync(path.join(ROOT, "vis/meta.json"), "utf8"));
const vecOld = fs.readFileSync(path.join(ROOT, "vis/vec.bin"));
if (vecOld.length !== meta.items.length * meta.D) throw new Error("vec.bin 和 meta.json 对不上");
const have = new Set(meta.items.map((x) => x[0]));
const perSet = new Map(); // "l|set" → 卡图库里有几张
for (const it of meta.items) { const s = meta.sets[it[1]], k = s[1] + "|" + s[0]; perSet.set(k, (perSet.get(k) || 0) + 1); }
const fresh = [];
for (const [line, l] of [["pokemon-japan", "ja"], ["pokemon", "en"]]) {
  // 只要有 2020 年以后发售的卡的系列（按发售日筛，几百个老系列不用一个一个看）
  const RECENT = { releaseDate: { gte: SINCE } };
  const sets = (await search({ productLineName: [line], productTypeName: ["Cards"] }, 0, 1, "", false, RECENT)).aggregations.setName;
  let looked = 0;
  for (const s of sets) {
    // TCGplayer 的张数比卡图库多才需要看（有的卡没有编号 / 没有图，所以差一点点的也会每次看一下，不费事）
    if ((perSet.get(l + "|" + s.value) || 0) >= s.count) continue;
    const got = [];
    for (let from = 0; from < 1500; from += 50) {
      const page = await search({ productLineName: [line], setName: [s.urlValue], productTypeName: ["Cards"] }, from, 50, "", false, RECENT);
      for (const p of page.results) if (/\d/.test(String(p.customAttributes?.number || ""))) got.push(toItem(p, l));
      if (page.results.length < 50 || from + 50 >= page.totalResults) break;
      await sleep(250);
    }
    looked++;
    const add = got.filter((x) => !have.has(x.id) && (!x.rel || x.rel >= SINCE));
    for (const x of add) have.add(x.id);
    if (add.length) { fresh.push(...add); console.log(`  ${l} ${s.value}: +${add.length}`); }
  }
  console.log(`${line}：${sets.length} 个系列，看了 ${looked} 个`);
}
// ---------- 2. 复刻卡的原版 ----------
for (const c of fresh.filter((x) => /Classic Collection/.test(x.set))) {
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
const todo = LIMIT ? fresh.slice(0, LIMIT) : fresh;
console.log(`新卡 ${fresh.length} 张${LIMIT ? `（这次只算 ${todo.length} 张）` : ""}`);
if (process.env.DRY) { fs.writeFileSync(process.env.DRY, JSON.stringify(fresh, null, 1)); process.exit(0); } // 只看清单不算
if (!todo.length) process.exit(0);

// ---------- 3. 算特征（无界面 Chrome，网页同一份 vis.js） ----------
const { chromium } = await import(process.env.PLAYWRIGHT || "playwright");
const browser = await chromium.launch();
const page = await browser.newPage();
page.on("console", (m) => m.type() === "error" && console.log("  [网页]", m.text()));
// 网站文件直接从仓库里读（模型在 models/ 下面，和网站上一样）
const TYPES = { ".js": "text/javascript", ".json": "application/json", ".onnx": "application/octet-stream", ".html": "text/html" };
await page.route("http://site.local/**", (route) => {
  const f = path.join(ROOT, decodeURIComponent(new URL(route.request().url()).pathname));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: "" });
  return route.fulfill({ status: 200, contentType: TYPES[path.extname(f)] || "application/octet-stream", body: fs.readFileSync(f) });
});
await page.goto("http://site.local/manifest.json");
await page.evaluate(async () => {
  window.V = await import("/vis.js");
  const m = await V.loadModel();
  window.loadImg = (u) => new Promise((ok, no) => {
    const i = new Image(), t = setTimeout(() => { i.src = ""; no(u); }, 20000);
    i.crossOrigin = "anonymous"; i.onload = () => { clearTimeout(t); ok(i); }; i.onerror = () => { clearTimeout(t); no(u); }; i.src = u;
  });
  window.embedId = async (id) => {
    let im = null;
    for (const u of [`https://tcgplayer-cdn.tcgplayer.com/product/${id}_200w.jpg`, `https://tcgplayer-cdn.tcgplayer.com/product/${id}_in_400x400.jpg`]) {
      try { im = await loadImg(u); break; } catch {}
    }
    if (!im) return null;
    return Array.from(V.quantize(await V.embed(V.cardCanvas(im, 0, 0, im.naturalWidth, im.naturalHeight))));
  };
  return m.device;
}).then((d) => console.log("模型：", d));

const setIdx = new Map(meta.sets.map((s, i) => [s[1] + "|" + s[0], i]));
const vecs = [];
let ok = 0, fail = 0;
for (let i = 0; i < todo.length; i += 8) {
  const batch = todo.slice(i, i + 8);
  const out = await page.evaluate((ids) => Promise.all(ids.map((id) => embedId(id).catch(() => null))), batch.map((c) => c.id));
  batch.forEach((c, j) => {
    if (!out[j]) { fail++; return; } // 还没有卡图（预售）：下次再试
    const key = c.l + "|" + c.set;
    if (!setIdx.has(key)) { setIdx.set(key, meta.sets.length); meta.sets.push([c.set, c.l]); }
    meta.items.push([c.id, setIdx.get(key), c.n, stripNo(c.name), c.r, c.rel || ""]);
    vecs.push(Int8Array.from(out[j]));
    ok++;
  });
  if ((i / 8) % 25 === 0) console.log(`  ${Math.min(i + 8, todo.length)}/${todo.length}`);
}
await browser.close();
if (!ok) { console.log(`没有算出新卡（没有卡图 ${fail} 张）`); process.exit(0); }
const add = new Int8Array(vecs.length * meta.D);
vecs.forEach((v, i) => add.set(v, i * meta.D));
fs.writeFileSync(path.join(ROOT, "vis/vec.bin"), Buffer.concat([vecOld, Buffer.from(add.buffer)]));
meta.built = new Date().toISOString().slice(0, 10);
fs.writeFileSync(path.join(ROOT, "vis/meta.json"), JSON.stringify(meta));
console.log(`卡图库：加了 ${ok} 张（没有卡图 ${fail} 张），共 ${meta.items.length} 张`);
