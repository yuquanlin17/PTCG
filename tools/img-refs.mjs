// 卡图对照表 vis/img.json：TCGplayer 上没有卡图的卡，图鉴 / 扫描结果显示哪张图。
//   商品号 → 数字：用另一个 TCGplayer 商品的卡图（同一张卡的普通版 / 原版，特征也是借它的）
//   商品号 → "https://…"：官网卡图（tools/fill-jp-images.mjs 找到的）
//   0：查过，TCGplayer 上有自己的卡图（不用借，下次不用再查）
//   前面带 "~"：参考图（球纹 / 镜面等版本借普通版的图，或者借别的语言同一张画），图鉴上会标「参考图」
// 借图关系从卡图库里「特征一模一样」的卡算出来（借的特征是整份复制的），每次更新卡图库后重算；本地：node tools/img-refs.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const F = (f) => path.join(ROOT, f);
const meta = JSON.parse(fs.readFileSync(F("vis/meta.json"), "utf8"));
const vec = fs.readFileSync(F("vis/vec.bin"));
const noimg = JSON.parse(fs.readFileSync(F("vis/noimg.json"), "utf8"));
const old = fs.existsSync(F("vis/img.json")) ? JSON.parse(fs.readFileSync(F("vis/img.json"), "utf8")) : {};
const D = meta.D;

// 版本记号：括号里的（Master Ball Pattern、Reverse Holo…），去掉编号、年份、选手名这类
const tag = (name) => [...String(name || "").matchAll(/\(([^)]*)\)|\[([^\]]*)\]/g)].map((m) => (m[1] || m[2]).toLowerCase())
  .filter((t) => /ball|holo|reverse|mirror|pattern|foil|cosmos|stamp|staff|prerelease|cracked|galaxy|confetti/.test(t)).sort().join("|");

const out = {};
const inMeta = new Set(meta.items.map((it) => String(it[0])));
// 1. 留下官网网址（自己的卡图）和只给图鉴用的参考图（还在 noimg 里的卡）
for (const [id, r] of Object.entries(old)) {
  if (typeof r === "string" && /^~?https?:/.test(r) && (inMeta.has(id) || noimg[id])) out[id] = r;
  else if (noimg[id]) out[id] = r;
}
// 2. 特征一模一样的卡：最早的那张是原图，其他借它的
const groups = new Map();
meta.items.forEach((it, i) => { const k = vec.subarray(i * D, (i + 1) * D).toString("base64"); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); });
// 只给 TCGplayer 上真的没有卡图的卡借（有的卡特征一样只是因为卡图本来就一样）
const hasImg = new Map(Object.entries(old).filter(([, r]) => r === 0).map(([id]) => [id, true])); // 0 = 查过，有自己的图
async function check(ids) {
  const q = ids.filter((id) => !hasImg.has(id));
  for (let k = 0; k < q.length; k += 12) {
    await Promise.all(q.slice(k, k + 12).map(async (id) => {
      for (let t = 0; t < 3; t++) {
        try { const r = await fetch(`https://tcgplayer-cdn.tcgplayer.com/product/${id}_200w.jpg`, { method: "HEAD" }); if (r.status === 200 || r.status === 403 || r.status === 404) { hasImg.set(id, r.status === 200); return; } } catch {}
        await new Promise((ok) => setTimeout(ok, 1000 * (t + 1)));
      }
    }));
  }
}
const pairs = [];
for (const g of groups.values()) if (g.length > 1) for (const i of g.slice(1)) if (meta.items[i][0] !== meta.items[g[0]][0]) pairs.push([g[0], i]);
await check([...new Set(pairs.map(([, i]) => String(meta.items[i][0])))]);
let n = 0;
for (const [r, i] of pairs) {
  const root = meta.items[r], rootRef = typeof out[root[0]] === "string" ? out[root[0]].replace(/^~/, "") : root[0];
  const it = meta.items[i], id = String(it[0]);
  if (typeof out[id] === "string" && !out[id].startsWith("~")) continue; // 有自己的官网卡图
  if (hasImg.get(id) !== false) { if (hasImg.get(id)) out[id] = 0; continue; } // 有自己的图（或者查不到）
  // 版本记号不一样，或者借图时就标了参考图（tools/fill-borrow.mjs 猜的）→ 参考图
  out[id] = tag(it[3]) !== tag(root[3]) || String(old[id] || "").startsWith("~") ? "~" + rootRef : rootRef; n++;
}
fs.writeFileSync(F("vis/img.json"), JSON.stringify(out));
const urls = Object.values(out).filter((r) => typeof r === "string" && /https?:/.test(r)).length;
n = Object.values(out).filter((r) => r !== 0 && !/https?:/.test(String(r))).length;
const refs = Object.values(out).filter((r) => String(r).startsWith("~")).length;
console.log(`卡图对照表：${Object.keys(out).length} 张（借同一张卡的卡图 ${n}，官网卡图 ${urls}，其中参考图 ${refs}）`);
