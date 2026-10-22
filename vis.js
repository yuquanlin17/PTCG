// 整卡比对：用 DINOv2-small 把卡图变成 384 个数字（特征），和事先算好的卡图库比，最像的就是这张卡
// 网页（扫描）和 tools/build-index.html（建卡图库）共用这一份，保证两边处理方式完全一样
const TF_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1";
const MODEL = "Xenova/dinov2-small";
const DTYPE = "fp16"; // 显卡和 CPU 用同一份 fp16 权重，算出来的特征一致（约 42MB，第一次下载后存在手机里）
export const CARD_W = 224, CARD_H = 312, CARD_RATIO = CARD_W / CARD_H;

let model = null, loading = null;
export const modelReady = () => !!model;
export function loadModel(onProgress) {
  if (model) return Promise.resolve(model);
  if (!loading) {
    loading = (async () => {
      const T = await import(TF_URL);
      const gpu = !!(navigator.gpu && (await navigator.gpu.requestAdapter().catch(() => null)));
      const make = (device) => T.pipeline("image-feature-extraction", MODEL, { device, dtype: DTYPE, progress_callback: onProgress });
      let m, device = gpu ? "webgpu" : "wasm";
      try { m = await make(device); } catch (e) { if (!gpu) throw e; device = "wasm"; m = await make(device); }
      model = { T, m, device };
      return model;
    })().catch((e) => { loading = null; throw e; });
  }
  return loading;
}

// 把图上一块区域（卡片）画成标准大小；区域比例和卡片不一样时取中间
export function cardCanvas(src, sx, sy, sw, sh, out) {
  const r = sw / sh;
  if (r > CARD_RATIO * 1.06) { const w = sh * CARD_RATIO; sx += (sw - w) / 2; sw = w; }
  else if (r < CARD_RATIO / 1.06) { const h = sw / CARD_RATIO; sy += (sh - h) / 2; sh = h; }
  const c = out || document.createElement("canvas");
  c.width = CARD_W; c.height = CARD_H;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.imageSmoothingQuality = "high";
  g.drawImage(src, sx, sy, sw, sh, 0, 0, CARD_W, CARD_H);
  return c;
}

// 特征：取 [CLS]，归一化
export async function embed(canvas) {
  const { T, m } = await loadModel();
  const out = await m(T.RawImage.fromCanvas(canvas));
  const D = out.dims[out.dims.length - 1], v = new Float32Array(D);
  let n = 0;
  for (let i = 0; i < D; i++) { v[i] = out.data[i]; n += v[i] * v[i]; }
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < D; i++) v[i] /= n;
  return v;
}
export function quantize(v) {
  let mx = 1e-9; for (const x of v) mx = Math.max(mx, Math.abs(x));
  const q = new Int8Array(v.length);
  for (let i = 0; i < v.length; i++) q[i] = Math.round((v[i] / mx) * 127);
  return q;
}

// 卡图库：vec.bin（每张卡 384 个 int8）+ meta.json（商品号、系列、编号、卡名…）
export async function loadIndex(base, onProgress) {
  const [meta, buf] = await Promise.all([
    fetch(base + "meta.json", { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error("meta " + r.status); return r.json(); }),
    fetchWithProgress(base + "vec.bin", onProgress),
  ]);
  const D = meta.D, vecs = new Int8Array(buf), n = vecs.length / D;
  const inv = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let j = i * D, e = j + D; j < e; j++) s += vecs[j] * vecs[j]; inv[i] = 1 / (Math.sqrt(s) || 1); }
  return { meta, vecs, inv, D, n };
}
async function fetchWithProgress(url, onProgress) {
  const r = await fetch(url, { cache: "no-cache" });
  if (!r.ok) throw new Error("vec " + r.status);
  const total = +r.headers.get("content-length") || 0;
  if (!r.body || !onProgress) return r.arrayBuffer();
  const reader = r.body.getReader(), parts = [];
  let got = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); got += value.length; onProgress(got, total); }
  const out = new Uint8Array(got); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out.buffer;
}
// 余弦相似度最高的 k 张
export function search(index, q, k = 8, filter) {
  const { vecs, inv, D, n } = index, top = [];
  for (let i = 0; i < n; i++) {
    if (filter && !filter(i)) continue;
    let s = 0;
    for (let j = 0, o = i * D; j < D; j++) s += q[j] * vecs[o + j];
    s *= inv[i];
    if (top.length < k || s > top[top.length - 1].sim) {
      top.push({ i, sim: s }); top.sort((a, b) => b.sim - a.sim); if (top.length > k) top.pop();
    }
  }
  return top;
}
