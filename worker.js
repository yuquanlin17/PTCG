// PTCG 卡价扫描 · 价格中转（Cloudflare Worker，免费版即可）
// 作用：替网页去 TCGplayer 搜卡、取市价，加上跨域许可，结果缓存 30 分钟。
// 用法：GET https://你的worker地址/?q=M1L%20065&line=pokemon-japan   （美版 line=pokemon）
const CACHE_SECONDS = 30 * 60;

export default {
  async fetch(request, env, ctx) {
    const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "content-type" };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    const url = new URL(request.url);
    // ptcgprice.com：网站本身（从 GitHub Pages 取来转发并缓存；GitHub Pages 在中国时好时坏，经 Cloudflare 更稳）
    // api.ptcgprice.com 和 workers.dev 地址：下面的价格服务器
    if (url.hostname === "ptcgprice.com" || url.hostname === "www.ptcgprice.com") return serveSite(request, url, ctx);
    // POST /read：网页自带的识别读不出卡底文字时，交给 Workers AI 的看图模型来读（需要绑定 Workers AI，变量名 AI）
    if (url.pathname === "/read" && request.method === "POST") return readCard(request, env, cors);
    if (url.pathname === "/caldate" && request.method === "POST") return readCard(request, env, cors, DATE_PROMPT);
    // POST /track {ids}：登记要每天记录价格的卡（收藏里的卡），需要绑定 KV，变量名 KV
    if (url.pathname === "/track" && request.method === "POST") return track(request, env, cors);
    // ?kv=商品id：读 Worker 每天记下的价格
    const kvId = (url.searchParams.get("kv") || "").replace(/\D/g, "").slice(0, 12);
    if (kvId) return kvHistory(kvId, env, cors);
    // ?pc=搜索词&n=编号：PriceCharting 的长期月度价格（3 年 / 5 年 / 全部）
    const pcq = (url.searchParams.get("pc") || "").trim().slice(0, 120);
    if (pcq) return pcHistory(pcq, (url.searchParams.get("n") || "").replace(/\D/g, ""), ctx, cors);
    // ?pcs=搜索词：PriceCharting 按名字搜，返回列表（简中 151 按卡名找卡用）
    const pcs = (url.searchParams.get("pcs") || "").trim().slice(0, 120);
    if (pcs) return pcSearch(pcs, ctx, cors);
    // ?calendar=1：发售日历里 Worker 负责的部分（日版官网、TCGplayer 美版预售）
    // ?calupdate=1：马上更新一次（平时由定时任务每天更新；距上次不到 10 分钟不重复做）
    if (url.searchParams.has("calendar")) return calendarGet(env, cors);
    if (url.searchParams.has("calupdate")) {
      const r = await updateCalendar(env, 600e3).catch((e) => ({ error: String(e && e.message || e) }));
      return jsonResp(r || { skipped: true }, cors);
    }
    const q = (url.searchParams.get("q") || "").trim().slice(0, 100);
    const line = url.searchParams.get("line") === "pokemon-japan" ? "pokemon-japan" : "pokemon";
    // ?set=m6-storm-emeralda：列出整个系列的卡（用来按卡图比对），缓存 1 天
    const set = (url.searchParams.get("set") || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 80);
    if (set) return listSet(set, line, ctx, cors);
    // ?history=商品id&range=month|quarter|annual：历史市价（画价格曲线用），缓存 6 小时
    const hist = (url.searchParams.get("history") || "").replace(/\D/g, "").slice(0, 12);
    if (hist) return priceHistory(hist, url.searchParams.get("range"), ctx, cors);
    if (!q) return new Response(JSON.stringify({ error: "missing q" }), { status: 400, headers: { "content-type": "application/json", ...cors } });

    const cache = caches.default;
    const key = new Request(`https://ptcg-cache.local/?q=${encodeURIComponent(q.toLowerCase())}&line=${line}`);
    const hit = await cache.match(key);
    if (hit) return hit;

    const body = {
      algorithm: "sales_synonym_v2", from: 0, size: 10,
      filters: { term: { productLineName: [line] }, range: {}, match: {} },
      listingSearch: { context: { cart: {} }, filters: { term: { sellerStatus: "Live", channelId: 0 }, range: { quantity: { gte: 1 } }, exclude: { channelExclusion: 0 } } },
      context: { cart: {}, shippingCountry: "US" },
      settings: { useFuzzySearch: true, didYouMean: {} },
      sort: {},
    };
    let items = [];
    try {
      const r = await fetch(`https://mp-search-api.tcgplayer.com/v1/search/request?q=${encodeURIComponent(q)}&isList=false`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const j = await r.json();
      items = ((j.results && j.results[0] && j.results[0].results) || []).map((p) => ({
        id: Math.round(p.productId),
        name: p.productName,
        set: p.setName,
        number: (p.customAttributes && p.customAttributes.number) || "",
        price: p.marketPrice == null ? null : p.marketPrice,
        rarity: p.rarityName || "",
        rel: ((p.customAttributes && p.customAttributes.releaseDate) || "").slice(0, 10),
      }));
    } catch (e) {
      return new Response(JSON.stringify({ error: "tcgplayer unreachable" }), { status: 502, headers: { "content-type": "application/json", ...cors } });
    }
    const resp = new Response(JSON.stringify({ at: Date.now(), items }), {
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": `public, max-age=${CACHE_SECONDS}`, ...cors },
    });
    ctx.waitUntil(cache.put(key, resp.clone()));
    return resp;
  },

  // 定时任务（Settings → Triggers → Cron，建议每小时 0 * * * *）：每次给一批登记的卡记今天的价格；
  // 日历超过 30 小时没更新时，这一次改为更新日历（免费版每次最多 50 个外部请求，两件事不放在同一次做）
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      const cal = env.KV && (await env.KV.get("cal", "json"));
      // 有来源上次失败（官网偶尔临时拦截）：2 小时后再试
      const age = cal ? Date.now() - cal.at : Infinity, failed = cal && cal.errors && Object.keys(cal.errors).length;
      if (env.KV && (age > CAL_STALE || (failed && age > 2 * 3600e3))) await updateCalendar(env, 0);
      else await snapshot(env);
    })());
  },
  // 测试用：日历的解析函数（Cloudflare 只认 fetch / scheduled，多出来的属性不影响）
  _cal: { parseJaApi, mergeCalendar },
};

// ---------- 网站：ptcgprice.com 转发 GitHub Pages 上的文件 ----------
// 网页、脚本、日历资料缓存 5 分钟（更新后很快生效）；识别模型、卡图库、图片缓存 1 天
const SITE_ORIGIN = "https://yuquanlin17.github.io/PTCG";
async function serveSite(request, url, ctx) {
  if (url.hostname === "www.ptcgprice.com") return Response.redirect("https://ptcgprice.com" + url.pathname + url.search, 301);
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method Not Allowed", { status: 405 });
  let path = url.pathname;
  if (path.endsWith("/")) path += "index.html";
  if (path.includes("..")) return new Response("Bad Request", { status: 400 });
  const cache = caches.default;
  const key = new Request("https://site-cache.local" + path);
  const hit = await cache.match(key);
  if (hit) return hit;
  const r = await fetch(SITE_ORIGIN + path);
  if (!r.ok) return new Response(r.status === 404 ? "Not Found" : "Upstream error", { status: r.status === 404 ? 404 : 502 });
  const short = /\.(html|js|json|webmanifest)$/i.test(path) && !/\/vis\/meta\.json$/.test(path);
  const headers = new Headers({ "content-type": r.headers.get("content-type") || "application/octet-stream", "cache-control": short ? "public, max-age=300" : "public, max-age=86400" });
  const len = r.headers.get("content-length");
  if (len) headers.set("content-length", len);
  const resp = new Response(r.body, { status: 200, headers });
  ctx.waitUntil(cache.put(key, resp.clone()));
  return resp;
}

// ---------- 浏览器一样的请求头（不然容易被当成机器人） ----------
const BROWSER_HEADERS = {
  "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  accept: "text/html,application/json,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
};
const jsonResp = (o, cors, status = 200, maxAge = 0) => new Response(JSON.stringify(o), {
  status, headers: { "content-type": "application/json; charset=utf-8", ...(maxAge ? { "cache-control": `public, max-age=${maxAge}` } : {}), ...cors },
});

// ---------- PriceCharting 长期价格（月度，最早到 2020 年底） ----------
// 注意 accept 只能要网页：带上 application/json 时，PriceCharting 会直接回 JSON 搜索结果，不会跳到卡片页面
const PC_HEADERS = { ...BROWSER_HEADERS, accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" };
async function pcHistory(q, n, ctx, cors) {
  const cache = caches.default;
  const key = new Request(`https://ptcg-cache.local/pc2?q=${encodeURIComponent(q.toLowerCase())}&n=${n}`);
  const hit = await cache.match(key);
  if (hit) return hit;
  try {
    let r = await fetch(`https://www.pricecharting.com/search-products?q=${encodeURIComponent(q)}&type=prices`, { headers: PC_HEADERS, redirect: "follow" });
    let html = await r.text(), url = r.url;
    // 取不到时带回状态码和网页标题，方便判断是不是被拦了
    const why = () => ({ status: r.status, page: (html.match(/<title>([^<]*)<\/title>/i) || [])[1] || "", url: String(url).split("?")[0] });
    if (!html.includes("VGPC.chart_data")) {
      // 搜索结果是列表：挑网址以编号结尾、又带卡名第一个词的那条
      const links = [...new Set([...html.matchAll(/href="(https:\/\/www\.pricecharting\.com\/game\/[^"#?]+)"/g)].map((m) => m[1]))];
      const word = q.toLowerCase().split(/\s+/)[0].replace(/[^a-z0-9]/g, "");
      const pick = links.find((l) => (!n || new RegExp(`-${parseInt(n, 10)}$`).test(l)) && l.toLowerCase().includes(word)) || (n ? null : links[0]);
      if (!pick) return jsonResp({ points: [], ...why() }, cors);
      url = pick;
      r = await fetch(url, { headers: PC_HEADERS });
      html = await r.text();
    }
    const i = html.indexOf("VGPC.chart_data");
    if (i < 0) return jsonResp({ points: [], ...why() }, cors);
    // 搜索直接跳到了卡片页：编号要对得上
    if (n && !new RegExp(`-${parseInt(n, 10)}$`).test(String(url).split("?")[0])) return jsonResp({ points: [], ...why() }, cors);
    const s = html.indexOf("{", i), e = html.indexOf("};", s);
    const data = JSON.parse(html.slice(s, e + 1));
    const t = html.indexOf('id="product_name"');
    const title = t > 0 ? html.slice(html.indexOf(">", t) + 1, html.indexOf("</h1>", t)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) : "";
    // used = 裸卡（Ungraded），单位是美分
    const points = (data.used || []).filter((x) => x[1] > 0).map(([ts, c]) => ({ d: new Date(ts).toISOString().slice(0, 10), p: c / 100, q: 0 }));
    // 现在的裸卡价和卡图（简中卡没有别的价格来源，直接用这里的）
    const u = html.indexOf('id="used_price"');
    const pm = u > 0 && html.slice(u, u + 400).match(/\$([\d,]+\.\d\d)/);
    const price = pm ? parseFloat(pm[1].replace(/,/g, "")) : null;
    const im = html.match(/https:\/\/storage\.googleapis\.com\/images\.pricecharting\.com\/[a-z0-9]+\/240\.jpg/);
    const resp = jsonResp({ at: Date.now(), url: url.split("?")[0], title, price, img: im ? im[0] : "", points }, cors, 200, 21600);
    ctx.waitUntil(cache.put(key, resp.clone()));
    return resp;
  } catch (e) {
    return jsonResp({ error: "pricecharting unreachable" }, cors, 502);
  }
}

// 按名字搜：要 JSON 时 PriceCharting 直接回搜索结果列表（卡名带编号「Jynx EX #183」、系列、卡图、裸卡价）
async function pcSearch(q, ctx, cors) {
  const cache = caches.default;
  const key = new Request(`https://ptcg-cache.local/pcs?q=${encodeURIComponent(q.toLowerCase())}`);
  const hit = await cache.match(key);
  if (hit) return hit;
  try {
    const r = await fetch(`https://www.pricecharting.com/search-products?q=${encodeURIComponent(q)}&type=prices`, { headers: { ...BROWSER_HEADERS, accept: "application/json" } });
    const j = await r.json();
    const items = (j.products || []).slice(0, 30).map((p) => ({ id: p.id, name: p.productName, set: p.consoleName, img: p.imageUri || "",
      price: parseFloat(String(p.price1 || "").replace(/[$,]/g, "")) || null }));
    const resp = jsonResp({ at: Date.now(), items }, cors, 200, 21600);
    ctx.waitUntil(cache.put(key, resp.clone()));
    return resp;
  } catch (e) {
    return jsonResp({ error: "pricecharting unreachable" }, cors, 502);
  }
}

// ---------- KV：Worker 每天自己记的价格 ----------
// tracked = 登记的商品 id（按登记顺序，只增不减）；每 40 个一组存在 h:组号 里：{ id: [[日期, 价格], …] }
const CHUNK = 40;
async function track(request, env, cors) {
  if (!env.KV) return jsonResp({ error: "KV 未绑定（Settings → Bindings → KV namespace，变量名 KV）" }, cors, 501);
  let ids = [];
  try { ids = ((await request.json()).ids || []).map((x) => parseInt(x, 10)).filter((x) => x > 0).slice(0, 3000); } catch {}
  const tracked = (await env.KV.get("tracked", "json")) || [];
  const set = new Set(tracked), add = ids.filter((id) => !set.has(id));
  if (add.length) { tracked.push(...add); await env.KV.put("tracked", JSON.stringify(tracked.slice(0, 5000))); }
  return jsonResp({ ok: true, count: tracked.length, added: add.length }, cors);
}
async function kvHistory(id, env, cors) {
  if (!env.KV) return jsonResp({ points: [] }, cors);
  const tracked = (await env.KV.get("tracked", "json")) || [];
  const pos = tracked.indexOf(parseInt(id, 10));
  if (pos < 0) return jsonResp({ points: [] }, cors);
  const hist = (await env.KV.get("h:" + Math.floor(pos / CHUNK), "json")) || {};
  return jsonResp({ points: (hist[id] || []).map(([d, p]) => ({ d, p, q: 0 })) }, cors);
}
async function snapshot(env) {
  if (!env.KV) return;
  const tracked = (await env.KV.get("tracked", "json")) || [];
  const today = new Date().toISOString().slice(0, 10);
  const state = (await env.KV.get("cron", "json")) || { day: "", next: 0 };
  if (state.day !== today) { state.day = today; state.next = 0; }
  const b = state.next;
  if (b * CHUNK >= tracked.length) return; // 今天这一轮已经全部记完
  const key = "h:" + b, hist = (await env.KV.get(key, "json")) || {};
  for (const id of tracked.slice(b * CHUNK, b * CHUNK + CHUNK)) {
    try {
      const arr = await (await fetch(`https://mpapi.tcgplayer.com/v2/product/${id}/pricepoints`, { headers: BROWSER_HEADERS })).json();
      const prices = (arr || []).map((x) => x.marketPrice).filter((p) => p > 0);
      if (!prices.length) continue;
      const p = Math.max(...prices); // 有普通 / 闪两种时取有成交的那个（一般是闪卡）
      const h = hist[id] || (hist[id] = []);
      if (h.length && h[h.length - 1][0] === today) h[h.length - 1][1] = p; else h.push([today, p]);
      if (h.length > 4000) h.shift(); // 最多留约 10 年
    } catch {}
  }
  await env.KV.put(key, JSON.stringify(hist));
  state.next = b + 1;
  await env.KV.put("cron", JSON.stringify(state));
}

async function priceHistory(id, range, ctx, cors) {
  range = ["month", "quarter", "annual"].includes(range) ? range : "quarter";
  const cache = caches.default;
  const key = new Request(`https://ptcg-cache.local/hist?id=${id}&r=${range}`);
  const hit = await cache.match(key);
  if (hit) return hit;
  let points = [], variant = "", status = 0;
  try {
    // 带上和浏览器一样的请求头，不然容易被当成机器人拦下
    const r = await fetch(`https://infinite-api.tcgplayer.com/price/history/${id}?range=${range}`, {
      headers: { ...BROWSER_HEADERS, accept: "application/json, text/plain, */*", origin: "https://www.tcgplayer.com", referer: "https://www.tcgplayer.com/" },
    });
    status = r.status;
    if (!r.ok) throw new Error("status " + r.status);
    const j = await r.json();
    const rows = (j && j.result) || [];
    // 一个商品可能有普通 / 闪等几种版本：取成交量最大的那种
    const vol = {};
    for (const r of rows) for (const v of r.variants || []) vol[v.variant] = (vol[v.variant] || 0) + (parseInt(v.quantity, 10) || 0) + 0.001;
    variant = Object.keys(vol).sort((a, b) => vol[b] - vol[a])[0] || "";
    for (const r of rows) {
      const v = (r.variants || []).find((x) => x.variant === variant);
      const p = v && parseFloat(v.marketPrice);
      if (p > 0) points.push({ d: r.date, p, q: parseInt(v.quantity, 10) || 0 });
    }
    points.sort((a, b) => (a.d < b.d ? -1 : 1));
  } catch (e) {
    // 把 TCGplayer 返回的状态码带回来，方便判断是不是被拦了（403 = 被拦）
    return new Response(JSON.stringify({ error: "tcgplayer unreachable", status }), { status: 502, headers: { "content-type": "application/json", ...cors } });
  }
  const resp = new Response(JSON.stringify({ at: Date.now(), variant, points }), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=21600", ...cors },
  });
  ctx.waitUntil(cache.put(key, resp.clone()));
  return resp;
}

const VISION_MODEL ="@cf/meta/llama-3.2-11b-vision-instruct";
// 不给具体的代码例子：AI 看不清时会照抄例子（把 s5R 读成例子里的「SV8a F」），所以只用占位符说明格式
const READ_PROMPT =
  "This image shows the bottom part of a Pokemon trading card. Find the small printed line near the bottom-left with the set code " +
  "(a short code, often inside a small dark box) and the card number (digits, usually written as NNN/NNN). " +
  "Copy exactly the characters you can actually see, in this format: <SETCODE> <NUMBER>. " +
  "Only include the letters EN or F after the set code if they are clearly printed there. " +
  "If you cannot read the set code clearly, reply with only the number. Do not guess or invent characters. " +
  "Ignore the single regulation letter before the code and the rarity letters after the number. If you cannot read the number, reply NONE.";

// POST /caldate {image}：从简中商品宣传图里读发售日（GitHub 自动任务用；宣传图上的艺术字一般的文字识别认不出来）
const DATE_PROMPT = "This is a promotional image for a Pokemon card product in Simplified Chinese. If the image shows a release date " +
  "(for example 2026年11月6日发售), reply with ONLY that date as YYYY-MM-DD. If there is no release date in the image, reply NONE.";
async function readCard(request, env, cors, prompt = READ_PROMPT) {
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...cors } });
  if (!env.AI) return json({ error: "Workers AI 未绑定（Settings → Bindings → Workers AI，变量名 AI）" }, 501);
  let bytes, b64;
  try {
    const { image } = await request.json();
    b64 = String(image || "").replace(/^data:image\/\w+;base64,/, "");
    const bin = atob(b64);
    if (!bin.length || bin.length > 400000) return json({ error: "image too large or empty" }, 400);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch { return json({ error: "bad request" }, 400); }
  try { return json({ text: (await aiAsk(env, bytes, b64, prompt, 24, "image/jpeg")).slice(0, 80) }); }
  catch (e) { return json({ error: "ai failed: " + String(e && e.message || e).slice(0, 200) }, 502); }
}
// 问看图模型一个问题。Workers AI 的图片输入格式改过几次：先用现在的写法（图片放在消息里），不行再试旧写法
async function aiAsk(env, bytes, b64, prompt, maxTokens, mime) {
  const formats = [
    () => ({ messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } }] }], max_tokens: maxTokens, temperature: 0 }),
    () => ({ prompt, image: [...bytes], max_tokens: maxTokens, temperature: 0 }),
    () => ({ messages: [{ role: "user", content: prompt }], image: [...bytes], max_tokens: maxTokens, temperature: 0 }),
  ];
  const errors = [];
  for (const f of formats) {
    try {
      let out;
      try { out = await env.AI.run(VISION_MODEL, f()); }
      catch (e) {
        // 第一次用 Llama 3.2 Vision 要先同意 Meta 的许可协议
        if (!/agree/i.test(String(e && e.message || e))) throw e;
        await env.AI.run(VISION_MODEL, { prompt: "agree" });
        out = await env.AI.run(VISION_MODEL, f());
      }
      return String((out && (out.response || out.result || out.text)) || "").trim();
    } catch (e) { errors.push(String(e && e.message || e).slice(0, 80)); }
  }
  throw new Error(errors.join(" | "));
}

async function listSet(set, line, ctx, cors) {
  const cache = caches.default;
  const key = new Request(`https://ptcg-cache.local/set?s=${set}&line=${line}`);
  const hit = await cache.match(key);
  if (hit) return hit;
  const items = [];
  try {
    for (let from = 0; from < 500; from += 50) {
      const body = {
        algorithm: "sales_synonym_v2", from, size: 50,
        filters: { term: { productLineName: [line], setName: [set] }, range: {}, match: {} },
        listingSearch: { context: { cart: {} }, filters: { term: {}, range: {}, exclude: { channelExclusion: 0 } } },
        context: { cart: {}, shippingCountry: "US" },
        settings: { useFuzzySearch: false, didYouMean: {} },
        sort: {},
      };
      const r = await fetch("https://mp-search-api.tcgplayer.com/v1/search/request?q=&isList=false", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const page = ((await r.json()).results || [])[0] || {};
      const list = page.results || [];
      for (const p of list) {
        const number = (p.customAttributes && p.customAttributes.number) || "";
        if (!number) continue; // 跳过卡盒、补充包这类商品
        items.push({ id: Math.round(p.productId), name: p.productName, set: p.setName, number, price: p.marketPrice == null ? null : p.marketPrice, rarity: p.rarityName || "",
          rel: ((p.customAttributes && p.customAttributes.releaseDate) || "").slice(0, 10) });
      }
      if (list.length < 50 || from + 50 >= (page.totalResults || 0)) break;
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: "tcgplayer unreachable" }), { status: 502, headers: { "content-type": "application/json", ...cors } });
  }
  const resp = new Response(JSON.stringify({ at: Date.now(), items }), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=86400", ...cors },
  });
  ctx.waitUntil(cache.put(key, resp.clone()));
  return resp;
}

// ---------- 发售日历里 Worker 负责的部分（每天更新一次，存在 KV 的 cal 里） ----------
// 来源：日版官网商品接口、TCGplayer 预售（美版新系列的盒装最早出现在这里）
// 另外两部分在网站上：简中 cal-cn.json（GitHub 自动任务每天更新）、美版周边 cal-en.json（手动整理）；网页把三份合起来显示
const CAL_STALE = 30 * 3600e3;
const CAL_KEEP_DAYS = 7; // 已发售的商品留 7 天
const decodeHtml = (s) => String(s || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&lsquo;/g, "'")
  .replace(/&ldquo;|&rdquo;/g, '"').replace(/&mdash;/g, "—").replace(/&ndash;/g, "–").replace(/&eacute;/g, "é").replace(/&hellip;/g, "…").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/\s+/g, " ").trim();
const ymd = (d) => d.toISOString().slice(0, 10);

async function calendarGet(env, cors) {
  if (!env.KV) return jsonResp({ at: 0, items: [], errors: { kv: "KV 未绑定" } }, cors);
  return jsonResp((await env.KV.get("cal", "json")) || { at: 0, items: [] }, cors, 200, 1800);
}

async function updateCalendar(env, minAge) {
  if (!env.KV) return { error: "KV 未绑定" };
  const old = (await env.KV.get("cal", "json")) || { at: 0, items: [] };
  if (Date.now() - old.at < minAge) return null;
  const seen = (await env.KV.get("calseen", "json")) || {};
  let budget = 44;
  const get = (url, opt) => { if (budget-- <= 0) throw new Error("本次请求次数用完"); return fetch(url, opt); };
  const errors = {}, groups = {}, partial = {}; // partial：这次读到了一部分（照样用），剩下的稍后补读
  // 简中不在这里做：官网图片在 Cloudflare 上下载不了（522 / 525），改由 GitHub 自动任务做（tools/calendar.mjs → cal-cn.json）
  // 美版官网有反爬虫验证（明确不希望程序抓取），不自动抓；周边商品手动整理在 cal-en.json 里
  for (const [k, fn] of [["ja", calJa], ["tcgp", calEnTcgp]]) {
    try { groups[k] = await fn(get, seen, env, partial); } catch (e) { errors[k] = String((e && e.message) || e).slice(0, 120); groups[k] = null; }
  }
  Object.assign(errors, partial);
  // 某个来源这次失败了：沿用上次的结果
  for (const k of Object.keys(groups)) if (!groups[k]) groups[k] = old.items.filter((x) => x.src === k);
  const counts = Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length]));
  const items = mergeCalendar(groups, ymd(new Date(Date.now() - CAL_KEEP_DAYS * 864e5)));
  // calseen 只留最近半年
  const cut = Date.now() - 180 * 864e5;
  for (const k of Object.keys(seen)) if ((seen[k].at || 0) < cut) delete seen[k];
  await env.KV.put("calseen", JSON.stringify(seen));
  const cal = { at: Date.now(), items, errors, counts, budgetLeft: budget };
  await env.KV.put("cal", JSON.stringify(cal));
  return { at: cal.at, count: items.length, counts, budgetLeft: budget, errors };
}
// 合并：TCGplayer 预售里和官网重复的去掉；只留 keepFrom 之后（或日期待定）的；按日期排
function mergeCalendar(groups, keepFrom) {
  const norm = (s) => String(s).toLowerCase().replace(/pok[eé]mon tcg:?|mega evolution|[—–:\-'’"().,&]/g, " ").replace(/\s+/g, " ").trim();
  const official = (groups.en || []).map((x) => norm(x.name));
  const tcgp = (groups.tcgp || []).filter((x) => !official.some((o) => o.includes(norm(x.name)) || norm(x.name).includes(o)));
  return [...(groups.ja || []), ...(groups.en || []), ...tcgp, ...(groups.cn || [])]
    .filter((x) => !x.date || x.date >= keepFrom)
    .sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999") || a.region.localeCompare(b.region));
}

// 日版官网：按发售日范围查（7 天前到明年底）
async function calJa(get) {
  const lo = new Date(Date.now() + 9 * 3600e3 - CAL_KEEP_DAYS * 864e5), hiY = lo.getUTCFullYear() + 1;
  const out = [];
  for (let page = 1, max = 1; page <= max && page <= 4; page++) {
    const u = `https://www.pokemon-card.com/products/resultAPI.php?dateLowerY=${lo.getUTCFullYear()}&dateLowerM=${lo.getUTCMonth() + 1}&dateLowerD=${lo.getUTCDate()}` +
      `&dateUpperY=${hiY}&dateUpperM=12&dateUpperD=31&page=${page}`;
    const j = await (await get(u, { headers: { ...BROWSER_HEADERS, accept: "application/json" } })).json();
    max = j.maxPage || 1;
    out.push(...parseJaApi(j));
  }
  return out;
}
function parseJaApi(j) {
  const abs = (u) => (!u ? "" : /^https?:/.test(u) ? u : "https://www.pokemon-card.com" + (u.startsWith("/") ? u : "/" + u));
  return (j.products || []).map((p) => {
    const m = String(p.releaseDate || "").match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/);
    return { id: "ja:" + (p.link_detailPage || p.productTitle), src: "ja", region: "ja", name: p.productTitle, type: p.productType || "",
      date: m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : null, img: abs(p.tumbsImg), imgs: [], price: p.priceTxt || "",
      desc: String(p.description || "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim(), contents: [], link: abs(p.link_detailPage) || "https://www.pokemon-card.com/products/", from: "日版官网" };
  });
}

// TCGplayer 预售：发售日在今天以后的美版盒装（同一系列的周边商品 TCGplayer 都记成系列首发日，所以只用来补新系列）
async function calEnTcgp(get) {
  const body = {
    algorithm: "sales_synonym_v2", from: 0, size: 50, // TCGplayer 一次最多 50 条，超过会返回空
    filters: { term: { productLineName: ["pokemon"], productTypeName: ["Sealed Products"] }, range: {}, match: {} },
    listingSearch: { context: { cart: {} }, filters: { term: {}, range: {}, exclude: { channelExclusion: 0 } } },
    context: { cart: {}, shippingCountry: "US" }, settings: { useFuzzySearch: false, didYouMean: {} },
    sort: { field: "release-date", order: "desc" },
  };
  const r = await get("https://mp-search-api.tcgplayer.com/v1/search/request?q=&isList=false", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const list = (((await r.json()).results || [])[0] || {}).results || [];
  const today = ymd(new Date(Date.now() - 5 * 3600e3));
  return list.filter((p) => String((p.customAttributes || {}).releaseDate || "").slice(0, 10) > today && !/\bCase\b|Half Booster Box|Art Bundle/i.test(p.productName))
    .map((p) => { const id = Math.round(p.productId); return { id: "tp:" + id, src: "tcgp", region: "en", name: p.productName, type: p.setName || "",
      date: String(p.customAttributes.releaseDate).slice(0, 10), img: `https://tcgplayer-cdn.tcgplayer.com/product/${id}_in_1000x1000.jpg`, imgs: [],
      // TCGplayer 的是预售市场价（通常有溢价），不是官方建议零售价：单独放在 market，网页上注明
      price: "", market: p.marketPrice ? "$" + Number(p.marketPrice).toFixed(2) : "", desc: "", contents: [], link: `https://www.tcgplayer.com/product/${id}`, from: "TCGplayer 预售" }; });
}
