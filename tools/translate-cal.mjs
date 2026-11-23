// 发售日历的翻译（提前做好，网页上直接切换，不是在线翻译）：每个商品翻成另外两种语言（简体中文 / 日文 / 英文），存进 cal-tr.json。
// GitHub Actions 每天跑（.github/workflows/calendar.yml），用 GitHub 自带的 AI 模型（GitHub Models，不用另外申请 API key）。
// 只翻新的或内容改过的（按内容算指纹），翻过的不再翻。没有 GITHUB_TOKEN（本地跑）时什么都不做。
// 本地跑：GITHUB_TOKEN=有 models 权限的 token node tools/translate-cal.mjs
import fs from "node:fs";
import crypto from "node:crypto";

const ROOT = new URL("../", import.meta.url);
const API = "https://api.ptcgprice.com";
const MODELS = ["openai/gpt-4.1-mini", "openai/gpt-4o-mini"];
const ENDPOINT = "https://models.github.ai/inference/chat/completions";
const MAX_PER_RUN = +process.env.MAX_PER_RUN || 40; // 免费额度每天有限，一次最多翻这么多，剩下的明天
const TOKEN = process.env.GITHUB_TOKEN;
const LANG = { "zh-cn": "zh", "zh-tw": "zh", ja: "ja", en: "en" };
const NAMES = { zh: "Simplified Chinese (简体中文, as used by the official Chinese Pokémon TCG)", ja: "Japanese (as used by the official Japanese Pokémon card game)", en: "English (as used by the official English Pokémon TCG)" };
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(new URL(f, ROOT), "utf8")); } catch { return d; } };

if (!TOKEN) { console.log("没有 GITHUB_TOKEN，跳过翻译"); process.exit(0); }

// 三份来源：简中官网（cal-cn.json）、美版官网（cal-en.json，手动）、价格服务器上的日版官网 + TCGplayer 预售
const srv = await fetch(`${API}?calendar=1`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
const items = [];
for (const src of [readJson("cal-cn.json", {}), readJson("cal-en.json", {}), srv || {}]) for (const x of src.items || []) if (!items.some((y) => y.id === x.id)) items.push(x);
const old = readJson("cal-tr.json", { items: {} });
const out = { at: Date.now(), items: {} };
const fields = (x) => ({ name: x.name || "", type: x.type || "", price: x.price || "", desc: x.desc || "", contents: x.contents || [] });
// 翻译规则改了就把 RULES 加 1：所有商品会按新规则重翻一遍
const RULES = 3;
const hash = (x) => crypto.createHash("sha1").update(RULES + JSON.stringify(fields(x))).digest("hex").slice(0, 12);

const SYSTEM = `You translate Pokémon Trading Card Game product announcements for a price-tracking app.
Return ONLY a JSON object. For each requested target language code, give an object with exactly the same keys and shapes as the input
(name, type, price, desc: strings; contents: array of strings, same length and order). Empty input strings stay empty.
Rules:
- Use each region's official Pokémon and Pokémon TCG terminology: Pokémon, trainer and set names as officially localized
  (e.g. ピカチュウ / 皮卡丘 / Pikachu, リザードン / 喷火龙 / Charizard, ナンジャモ / 奇树 / Iono, テラスタル / 太晶 / Tera).
- Region-specific product names and abbreviations (ETB, Elite Trainer Box, Pokémon Center ETB, UPC, Ultra Premium Collection, SPC, Booster Bundle,
  Build & Battle Box/Stadium, Mini Tin, Premium Collection, Booster Display, Sleeved Booster, Blister; ハイクラスパック, スタートデッキ,
  スペシャルデッキセット, ジムセット, etc.): if the target language has an established name for it, translate it AND put the original in
  parentheses right after, e.g. 精英训练家箱（ETB）, 迷你铁罐（Mini Tin）, エリートトレーナーボックス（ETB）, High Class Pack（ハイクラスパック）.
  If there is no established name in the target language, keep the original term (you may add a short explanation in parentheses).
  Apply the same idea to any similar term that only exists in one region's product lineup.
- KEEP AS-IS, never translate: rarity codes and rule names — SAR, SIR, AR, IR, SR, UR, HR, CHR, CSR, ACE SPEC, ex, EX, GX, V, VMAX, VSTAR, BREAK.
- Generic words are translated normally: 拡張パック / 补充包 / booster pack; デッキ / 卡组 / deck; BOX / 盒 / box.
- If an English set or product name has no official translation, keep the original name and add a short translation in parentheses only when it helps.
- Keep numbers, prices, currencies, dates and times exactly (translate only the surrounding words, e.g. 建议零售价 999元 → 希望小売価格 999元（人民元） / MSRP CN¥999).
- Natural, concise wording. No notes, no explanations.`;

async function translate(x, from, targets) {
  const user = `Source language: ${NAMES[from]}\nTarget languages: ${targets.map((t) => `${t} = ${NAMES[t]}`).join("; ")}\nInput:\n${JSON.stringify(fields(x))}`;
  for (const model of MODELS) {
    for (let k = 0; k < 4; k++) {
      let r;
      try {
        r = await fetch(ENDPOINT, {
          method: "POST",
          headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" },
          body: JSON.stringify({ model, temperature: 0.2, response_format: { type: "json_object" }, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }] }),
        });
      } catch (e) { await sleep(5000); continue; }
      if (r.status === 429) { const wait = Math.min(120, +r.headers.get("retry-after") || 30); console.log(`  额度用完，等 ${wait} 秒`); await sleep(wait * 1000); continue; }
      const raw = await r.text();
      if (!r.ok) { console.log(`  ${model} HTTP ${r.status}: ${raw.slice(0, 300)}`); break; }
      let body;
      try { body = JSON.parse(raw); } catch {
        console.log(`  ${model} HTTP ${r.status} ${r.headers.get("content-type")}，回的不是 JSON：${JSON.stringify(raw.slice(0, 300))}`);
        break; // 换下一个模型
      }
      try {
        const msg = body.choices && body.choices[0] && body.choices[0].message;
        if (!msg || typeof msg.content !== "string") throw new Error("没有 choices[0].message.content：" + JSON.stringify(body).slice(0, 300));
        const j = JSON.parse(msg.content.replace(/^```(?:json)?\s*|\s*```$/g, ""));
        const res = {};
        for (const t of targets) {
          const v = j[t];
          if (!v || typeof v.name !== "string") throw new Error("缺 " + t);
          res[t] = { name: v.name, type: v.type || "", price: v.price || "", desc: v.desc || "", contents: Array.isArray(v.contents) ? v.contents.map(String) : [] };
        }
        return res;
      } catch (e) { console.log(`  ${model} 回的格式不对：${e.message}`); break; }
    }
  }
  return null;
}

let done = 0, kept = 0, failed = 0;
for (const x of items) {
  const from = LANG[x.region] || "en", targets = ["zh", "ja", "en"].filter((t) => t !== from), h = hash(x), prev = old.items[x.id];
  if (prev && prev.h === h && targets.every((t) => prev[t])) { out.items[x.id] = prev; kept++; continue; }
  if (done >= MAX_PER_RUN) { if (prev) out.items[x.id] = prev; continue; } // 旧翻译先留着，明天再翻
  const tr = await translate(x, from, targets);
  done++;
  if (tr) { out.items[x.id] = { h, ...tr }; console.log(`  ✓ ${x.id} ${String(x.name).slice(0, 40)}`); }
  else { failed++; if (prev) out.items[x.id] = prev; }
  // 前 3 个全失败：多半是设置问题（权限 / 接口），别再一个个白试
  if (done === 3 && failed === 3) { console.log("前 3 个都失败，这次先停下（看上面的错误信息）"); for (const y of items) if (!out.items[y.id] && old.items[y.id]) out.items[y.id] = old.items[y.id]; break; }
  await sleep(4500); // 免费额度：每分钟最多十几次
}
// 价格服务器这次没连上：它那部分（日版官网、TCGplayer 预售）的旧翻译照留
if (!srv) for (const [id, v] of Object.entries(old.items || {})) if (!out.items[id] && /^(ja|tp):/.test(id)) out.items[id] = v;
fs.writeFileSync(new URL("cal-tr.json", ROOT), JSON.stringify(out));
console.log(`翻译：新翻 ${done - failed} 个，沿用 ${kept} 个，失败 ${failed} 个，共 ${Object.keys(out.items).length} 个`);
