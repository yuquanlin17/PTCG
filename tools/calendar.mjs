// 发售日历的简中部分（Worker 做不了：官网图片在 Cloudflare 上下载不了），GitHub Actions 每天跑一次（.github/workflows/calendar.yml）：
// 简中官网商品资讯 → cal-cn.json：发售日写在宣传图上，下载图片（存进 cal-img/，官网图片链接会过期）再用文字识别读日期
// （日版官网和 TCGplayer 预售由 Worker 每天更新；美版周边手动整理在 cal-en.json）
// 本地跑：npm i tesseract.js && node tools/calendar.mjs
import Tesseract from "tesseract.js";
import sharp from "sharp";
import fs from "node:fs";

const ROOT = new URL("../", import.meta.url);
const KEEP_DAYS = 7;
const ymd = (d) => d.toISOString().slice(0, 10);
const keepFrom = ymd(new Date(Date.now() - KEEP_DAYS * 864e5));
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(new URL(f, ROOT), "utf8")); } catch { return { items: [] }; } };
const decodeHtml = (s) => String(s || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&lsquo;/g, "'")
  .replace(/&ldquo;|&rdquo;/g, '"').replace(/&mdash;/g, "—").replace(/&ndash;/g, "–").replace(/&eacute;/g, "é").replace(/&hellip;/g, "…").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/\s+/g, " ").trim();
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

// ---------- 简中官网 ----------
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
// 从识别出的文字里找发售日：优先「发售 / 上市 / 开售」旁边的日期；没写年份的按公布日期推算
function findDate(text, posted) {
  const t = text.replace(/\s+/g, "");
  const py = +posted.slice(0, 4), pm = +posted.slice(5, 7);
  const cands = [];
  for (const m of t.matchAll(/(?:(20\d\d)年)?(\d{1,2})月(\d{1,2})日/g)) {
    let y = m[1] ? +m[1] : py;
    const mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
    if (!m[1] && mo < pm - 1) y++; // 12 月公布、写着「1 月 x 日」：是明年
    const near = /发售|上市|开售|发行/.test(t.slice(Math.max(0, m.index - 12), m.index + m[0].length + 8));
    cands.push({ date: `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`, near });
  }
  const ok = cands.filter((c) => c.date >= posted);
  return (ok.find((c) => c.near) || ok[0] || {}).date || null;
}
// 慢一点、失败重试：请求太密集时官网会临时断开连接
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
async function get(url, headers) {
  for (let k = 0; ; k++) {
    await sleep(800);
    try { const r = await fetch(url, { headers }); if (r.ok || k >= 2) return r; } catch (e) { if (k >= 2) throw e; }
    await sleep(3000 * (k + 1));
  }
}
async function updateCn() {
  const old = readJson("cal-cn.json"), known = new Map(old.items.map((x) => [x.id, x]));
  const list = parseCnList(await (await get(CN_LIST, CN_HEADERS)).text());
  if (!list.length) throw new Error("读不到简中商品资讯列表");
  fs.mkdirSync(new URL("cal-img/", ROOT), { recursive: true });
  // 只看最近 60 天公布的；读不出日期的只在公布后 30 天内显示「发售日待定」（再久多半已经发售）
  const recent = ymd(new Date(Date.now() - 60 * 864e5)), tbdFrom = ymd(new Date(Date.now() - 30 * 864e5));
  const worker = await Tesseract.createWorker("chi_sim");
  const items = [];
  try {
    for (const e of list) {
      if (e.posted < recent) continue;
      const id = "cn:" + e.id, prev = known.get(id);
      // 读过、而且读出了日期的不再读；没读出日期的每次再试
      if (prev && prev.date) { items.push(prev); continue; }
      const item = { id, src: "cn", region: "zh-cn", name: e.title, type: "", date: null, img: "", imgs: [], price: "", desc: "", contents: [],
        link: `https://www.pokemon.cn/tcg/product/${e.id}.html`, from: "简中官网", posted: e.posted };
      try {
        // 最多看 12 张图找日期（日期常在其中一张专门的图上）；存前 4 张用来显示（压成宽 900 的 JPEG，官网原图动辄好几 MB）
        const pics = [e.thumb, ...parseCnArticle(await (await get(item.link, CN_HEADERS)).text())].filter(Boolean).slice(0, 12);
        let text = "", saved = 0;
        for (const pic of pics) {
          if (item.date && saved >= 4) break;
          const r = await get(pic, { ...CN_HEADERS, accept: "image/*" });
          if (!r.ok) continue;
          const buf = Buffer.from(await r.arrayBuffer());
          if (saved < 4) {
            const file = `cal-img/cn-${e.id}-${saved}.jpg`;
            fs.writeFileSync(new URL(file, ROOT), await sharp(buf).flatten({ background: "#fff" }).resize({ width: 900, withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer());
            if (saved === 0) item.img = file; else item.imgs.push(file);
            saved++;
          }
          if (!item.date) {
            const small = await sharp(buf).flatten({ background: "#fff" }).resize({ width: 1400, withoutEnlargement: true }).png().toBuffer();
            text += " " + (await worker.recognize(small)).data.text;
            item.date = findDate(text, e.posted);
          }
        }
      } catch (err) { console.warn(e.id, String(err)); }
      items.push(item);
    }
  } finally { await worker.terminate(); }
  const out = items.filter((x) => (x.date ? x.date >= keepFrom : x.posted >= tbdFrom));
  // 不再用到的图片删掉
  const used = new Set(out.flatMap((x) => [x.img, ...x.imgs]));
  for (const f of fs.readdirSync(new URL("cal-img/", ROOT))) if (!used.has("cal-img/" + f)) fs.unlinkSync(new URL("cal-img/" + f, ROOT));
  fs.writeFileSync(new URL("cal-cn.json", ROOT), JSON.stringify({ at: Date.now(), items: out }));
  console.log(`简中：${out.length} 件，读出日期 ${out.filter((x) => x.date).length} 件`);
}

await updateCn();
