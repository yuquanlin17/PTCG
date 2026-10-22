// PTCG 卡价扫描 · 价格中转（Cloudflare Worker，免费版即可）
// 作用：替网页去 TCGplayer 搜卡、取市价，加上跨域许可，结果缓存 30 分钟。
// 用法：GET https://你的worker地址/?q=M1L%20065&line=pokemon-japan   （美版 line=pokemon）
const CACHE_SECONDS = 30 * 60;

export default {
  async fetch(request, env, ctx) {
    const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    const url = new URL(request.url);
    const q = (url.searchParams.get("q") || "").trim().slice(0, 100);
    const line = url.searchParams.get("line") === "pokemon-japan" ? "pokemon-japan" : "pokemon";
    // ?set=m6-storm-emeralda：列出整个系列的卡（用来按卡图比对），缓存 1 天
    const set = (url.searchParams.get("set") || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 80);
    if (set) return listSet(set, line, ctx, cors);
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
};

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
