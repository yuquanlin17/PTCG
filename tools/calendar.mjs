// 发售日历的简中部分（Worker 做不了：官网图片在 Cloudflare 上下载不了），GitHub Actions 每天跑一次（.github/workflows/calendar.yml）：
// 简中官网商品资讯 → cal-cn.json：发售日写在宣传图上（艺术字，一般的文字识别认不出来），
// 下载图片（压缩后存进 cal-img/，官网图片链接会过期），再交给价格服务器上的看图模型读日期（POST /caldate）
// （日版官网和 TCGplayer 预售由 Worker 每天更新；美版周边手动整理在 cal-en.json）
// 本地跑：npm i sharp && node tools/calendar.mjs
import sharp from "sharp";
import fs from "node:fs";

const ROOT = new URL("../", import.meta.url);
const API = "https://api.ptcgprice.com";
const KEEP_DAYS = 7;
const ymd = (d) => d.toISOString().slice(0, 10);
const keepFrom = ymd(new Date(Date.now() - KEEP_DAYS * 864e5));
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(new URL(f, ROOT), "utf8")); } catch { return { items: [] }; } };
const decodeHtml = (s) => String(s || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&lsquo;/g, "'")
  .replace(/&ldquo;|&rdquo;/g, '"').replace(/&mdash;/g, "—").replace(/&ndash;/g, "–").replace(/&eacute;/g, "é").replace(/&hellip;/g, "…").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/\s+/g, " ").trim();
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const CN_LIST = "https://www.pokemon.cn/tcg/product/";
const CN_HEADERS = { "user-agent": UA, "accept-language": "zh-CN,zh;q=0.9", referer: CN_LIST };

function parseCnList(html) {
  const out = [];
  for (const m of html.matchAll(/<li class="card__element[^"]*card__category--product[^"]*">([\s\S]*?)<\/li>/g)) {
    const b = m[1], id = (b.match(/\/tcg\/product\/(\d+)\.html/) || [])[1];
    if (!id) continue;
    out.push({ id, title: decodeHtml(((b.match(/card__products-title">([\s\S]*?)<\/div>/) || [])[1] || "").replace(/<\/?br\s*\/?>/gi, " ")),
      posted: (b.match(/card__footer--date">([\d-]+)</) || [])[1] || "", thumb: ((b.match(/<img[^>]+src="([^"]+)"/) || [])[1] || "").replace(/&amp;/g, "&") });
  }
  return out;
}
function parseCnArticle(html) {
  const i = html.indexOf("article-detail");
  const body = i > 0 ? html.slice(i) : html;
  const stop = body.search(/最新资讯/);
  const main = stop > 0 ? body.slice(0, stop) : body;
  return [...new Set([...main.matchAll(/<img[^>]+src="(https:\/\/image\.pokemon\.com\.cn\/wp-content\/uploads\/[^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&")))];
}
// 慢一点、失败重试：请求太密集时官网会临时断开连接
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
async function get(url, headers) {
  for (let k = 0; ; k++) {
    await sleep(800);
    try { const r = await fetch(url, { headers }); if (r.ok || k >= 3) return r; } catch (e) { if (k >= 3) throw e; }
    await sleep(3000 * (k + 1));
  }
}
// 问看图模型这张图上的发售日。只认公布日之后、半年以内的日期（防止它乱编）
async function askDate(jpeg, posted) {
  try {
    const r = await fetch(`${API}/caldate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image: jpeg.toString("base64") }) });
    const m = String((await r.json()).text || "").match(/(20\d\d)-(\d{1,2})-(\d{1,2})/);
    if (!m) return null;
    const d = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    const max = ymd(new Date(Date.parse(posted) + 183 * 864e5));
    return d >= posted && d <= max ? d : null;
  } catch { return null; }
}

const old = readJson("cal-cn.json"), known = new Map(old.items.map((x) => [x.id, x]));
const list = parseCnList(await (await get(CN_LIST, CN_HEADERS)).text());
if (!list.length) throw new Error("读不到简中商品资讯列表");
fs.mkdirSync(new URL("cal-img/", ROOT), { recursive: true });
// 只看最近 60 天公布的；读不出日期的只在公布后 30 天内显示「发售日待定」（再久多半已经发售）
const recent = ymd(new Date(Date.now() - 60 * 864e5)), tbdFrom = ymd(new Date(Date.now() - 30 * 864e5));
const items = [];
for (const e of list) {
  if (e.posted < recent) continue;
  const id = "cn:" + e.id, prev = known.get(id);
  // 日期和图都齐了的不再读；缺一样的每次再试
  if (prev && prev.date && prev.img) { items.push(prev); continue; }
  const item = { id, src: "cn", region: "zh-cn", name: e.title, type: "", date: null, img: "", imgs: [], price: "", desc: "", contents: [],
    link: `https://www.pokemon.cn/tcg/product/${e.id}.html`, from: "简中官网", posted: e.posted };
  try {
    // 缩略图上一般就写着「xxxx年x月x日发售」；没有的话再看文章里的图（最多 8 张）。存前 4 张用来显示（压成宽 900 的 JPEG）
    const pics = [e.thumb, ...parseCnArticle(await (await get(item.link, CN_HEADERS)).text())].filter(Boolean).slice(0, 8);
    let saved = 0, asked = 0;
    for (const pic of pics) {
      if (item.date && saved >= 4) break;
      const r = await get(pic, { ...CN_HEADERS, accept: "image/*" });
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      const img = sharp(buf).flatten({ background: "#fff" });
      if (saved < 4) {
        const file = `cal-img/cn-${e.id}-${saved}.jpg`;
        fs.writeFileSync(new URL(file, ROOT), await img.clone().resize({ width: 900, withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer());
        if (saved === 0) item.img = file; else item.imgs.push(file);
        saved++;
      }
      if (!item.date && asked < 4) {
        asked++;
        item.date = await askDate(await img.clone().resize({ width: 1024, height: 1400, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer(), e.posted);
      }
    }
  } catch (err) { console.warn(e.id, String(err)); }
  // 这次没读到的，保留上次读到的部分
  if (prev) { item.date = item.date || prev.date; if (!item.img && prev.img) { item.img = prev.img; item.imgs = prev.imgs; } }
  items.push(item);
}
const out = items.filter((x) => (x.date ? x.date >= keepFrom : x.posted >= tbdFrom));
// 不再用到的图片删掉
const used = new Set(out.flatMap((x) => [x.img, ...x.imgs]));
for (const f of fs.readdirSync(new URL("cal-img/", ROOT))) if (!used.has("cal-img/" + f)) fs.unlinkSync(new URL("cal-img/" + f, ROOT));
fs.writeFileSync(new URL("cal-cn.json", ROOT), JSON.stringify({ at: Date.now(), items: out }));
console.log(`简中：${out.length} 件，读出日期 ${out.filter((x) => x.date).length} 件，有图 ${out.filter((x) => x.img).length} 件`);
