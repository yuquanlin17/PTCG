// 美版官网商品图库 → cal-en.json（发售日历的美版部分）
// 官网有反爬虫（要真的跑 JavaScript），所以用无界面 Chrome（Playwright）去读；GitHub Actions 每天跑一次（.github/workflows/cal-en.yml）
// 本地跑：npm i playwright && npx playwright install chromium && node tools/cal-en.mjs
import { chromium } from "playwright";
import fs from "node:fs";

const EN_GALLERY = "https://www.pokemon.com/us/pokemon-tcg/product-gallery";
const OUT = new URL("../cal-en.json", import.meta.url);
const KEEP_DAYS = 7;
const decodeHtml = (s) => String(s || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&lsquo;/g, "'")
  .replace(/&ldquo;|&rdquo;/g, '"').replace(/&mdash;/g, "—").replace(/&ndash;/g, "–").replace(/&eacute;/g, "é").replace(/&hellip;/g, "…").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/\s+/g, " ").trim();
const ymd = (d) => d.toISOString().slice(0, 10);

// 和 worker.js 里的 parseEnGallery / parseEnProduct 一样
function parseEnGallery(html) {
  const out = [];
  for (const m of html.matchAll(/href="\/us\/pokemon-tcg\/product-gallery\/([a-z0-9-]+)\/?"/g)) if (!/^\d{4}$/.test(m[1]) && !out.includes(m[1])) out.push(m[1]);
  return out;
}
function parseEnProduct(html, slug) {
  const h1 = html.match(/<h1[^>]*class="us-title"[^>]*>([\s\S]*?)<\/h1>/);
  if (!h1) return null;
  const dm = html.match(/Launch:\s*([A-Za-z]+\s+\d{1,2},\s*\d{4})/);
  const t = dm ? Date.parse(dm[1] + " UTC") : NaN;
  const og = (html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/) || [])[1] || "";
  const i = html.indexOf("full-article-body");
  const body = i > 0 ? html.slice(i, i + 12000) : "";
  const end = body.search(/<footer|class="(?:article-footer|related|share)/);
  const main = end > 0 ? body.slice(0, end) : body;
  const paras = [...main.matchAll(/<p(?![^>]*style)[^>]*>([\s\S]*?)<\/p>/g)].map((m) => decodeHtml(m[1])).filter((s) => s.length > 2);
  const incIdx = paras.findIndex((s) => /includes?:\s*$/i.test(s));
  const desc = (incIdx >= 0 ? paras.slice(0, incIdx) : paras).filter((s) => s.length > 30).join("\n");
  const contents = [...main.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => decodeHtml(m[1])).filter(Boolean).slice(0, 30);
  const abs = (u) => (/^https?:/.test(u) ? u : "https://www.pokemon.com" + u);
  const imgs = [...new Set([...main.matchAll(/<img[^>]+src="([^"]+\.(?:png|jpe?g|webp))"/gi)].map((m) => abs(m[1])))].slice(0, 8);
  return { id: "en:" + slug, src: "en", region: "en", name: decodeHtml(h1[1]).replace(/^Pok[eé]mon TCG:\s*/i, ""), type: "",
    date: isNaN(t) ? null : ymd(new Date(t)), img: og ? abs(og) : imgs[0] || "", imgs, price: "", desc, contents,
    link: `${EN_GALLERY}/${slug}`, from: "美版官网" };
}

const old = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { items: [] };
const known = new Map(old.items.map((x) => [x.id, x]));
const browser = await chromium.launch();
const page = await browser.newPage({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36", locale: "en-US" });
const open = async (url) => {
  for (let k = 0; k < 3; k++) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2500); // 反爬虫验证跑完会自动跳回原页面
    const html = await page.content();
    if (!/Pardon Our Interruption/i.test(html)) return html;
    await page.waitForTimeout(8000);
  }
  throw new Error("被反爬虫挡住：" + url);
};
const slugs = parseEnGallery(await open(EN_GALLERY));
if (!slugs.length) throw new Error("读不到商品列表");
const keepFrom = ymd(new Date(Date.now() - KEEP_DAYS * 864e5));
const items = [];
for (const slug of slugs) {
  const prev = known.get("en:" + slug);
  // 已经发售很久的不用再看
  if (prev && prev.date && prev.date < keepFrom) continue;
  try { const it = parseEnProduct(await open(`${EN_GALLERY}/${slug}`), slug); if (it) items.push(it); }
  catch (e) { console.warn(String(e)); if (prev) items.push(prev); }
  await page.waitForTimeout(1500);
}
await browser.close();
const out = items.filter((x) => !x.date || x.date >= keepFrom).sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"));
fs.writeFileSync(OUT, JSON.stringify({ at: Date.now(), items: out }));
console.log(`cal-en.json：${out.length} 件（共看了 ${slugs.length} 件商品）`);
