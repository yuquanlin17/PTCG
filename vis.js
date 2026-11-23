// 整卡比对：用 DINOv2-small 把卡图变成 384 个数字（特征），和事先算好的卡图库比，最像的就是这张卡
// 网页（扫描）和 tools/build-index.html（建卡图库）共用这一份，保证两边处理方式完全一样
const TF_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1";
const MODEL = "Xenova/dinov2-small";
const DTYPE = "fp16"; // 显卡和 CPU 用同一份 fp16 权重，算出来的特征一致（约 42MB，第一次下载后存在手机里）
// 注意：transformers.js 的本地模型路径是 models/<MODEL>/onnx/model_fp16.onnx（和 HuggingFace 上的目录结构一样）
export const CARD_W = 224, CARD_H = 312, CARD_RATIO = CARD_W / CARD_H;

let model = null, loading = null;
export const modelReady = () => !!model;
export function loadModel(onProgress) {
  if (model) return Promise.resolve(model);
  if (!loading) {
    loading = (async () => {
      const T = await import(TF_URL);
      // 模型文件放在网站自己的 models/ 下面（在中国也能下载）；没有的话才去 HuggingFace（在中国打不开时换国内镜像）
      const local = new URL("./models/", import.meta.url).href;
      const hasLocal = await fetch(`${local}${MODEL}/onnx/model_${DTYPE}.onnx`, { method: "HEAD", cache: "no-store" }).then((r) => r.ok).catch(() => false);
      T.env.allowLocalModels = hasLocal;
      T.env.localModelPath = local;
      if (!hasLocal) T.env.remoteHost = await pickHost();
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

const HOSTS = ["https://huggingface.co/", "https://hf-mirror.com/"];
async function pickHost() {
  for (const h of HOSTS) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 5000);
    try { const r = await fetch(`${h}${MODEL}/resolve/main/config.json`, { signal: ctl.signal, cache: "no-store" }); if (r.ok) return h; }
    catch {} finally { clearTimeout(t); }
  }
  return HOSTS[0];
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

// ---------- 找卡：把画面和「认出来的那张卡」的卡图一块一块对上，算出卡在画面里的四个角（歪的、斜着拍的、在卡砖里都行） ----------
// 识别模型本来就会把图切成 16×16 小块、每块算一组特征；画面和参考卡图里特征最像的小块配成对，
// 用 RANSAC 找出最多配对认可的透视变换，把参考卡的四个角投到画面上。比找直线可靠：卡砖、反光、背景杂乱都不怕。
// 模型输入：短边缩到 256，取中间 224×224（16×16 块，每块 14 像素）。这里直接给 256×256 的图，块的位置就固定了
const SQ = 256, PATCH = 14, OFF = (SQ - 224) / 2, GRID = 16;
const patchCenter = (k) => [OFF + (k % GRID) * PATCH + PATCH / 2, OFF + Math.floor(k / GRID) * PATCH + PATCH / 2];
async function patchFeats(canvas) {
  const { T, m } = await loadModel();
  const out = await m(T.RawImage.fromCanvas(canvas));
  const D = out.dims[out.dims.length - 1], n = out.dims[out.dims.length - 2] - 1; // 第一个是 [CLS]
  if (n !== GRID * GRID) throw new Error("patch grid " + n);
  const f = new Float32Array(n * D);
  for (let k = 0; k < n; k++) {
    let s = 0;
    for (let j = 0; j < D; j++) { const v = out.data[(k + 1) * D + j]; f[k * D + j] = v; s += v * v; }
    s = Math.sqrt(s) || 1;
    for (let j = 0; j < D; j++) f[k * D + j] /= s;
  }
  return { f, n, D };
}
// 参考卡图：整张卡放进 256×256 的中间（高 224），四个角的位置是固定的
const REF_W = Math.round(224 * CARD_RATIO), REF_X = (SQ - REF_W) / 2;
export const REF_CORNERS = [[REF_X, OFF], [REF_X + REF_W, OFF], [REF_X + REF_W, OFF + 224], [REF_X, OFF + 224]];
const refCache = new Map();
export function refFeats(id, img) {
  if (!refCache.has(id)) refCache.set(id, (async () => {
    const c = document.createElement("canvas"); c.width = SQ; c.height = SQ;
    const g = c.getContext("2d"); g.fillStyle = "#808080"; g.fillRect(0, 0, SQ, SQ);
    g.imageSmoothingQuality = "high"; g.drawImage(img, REF_X, OFF, REF_W, 224);
    return patchFeats(c);
  })().catch((e) => { refCache.delete(id); throw e; }));
  return refCache.get(id);
}
// 画面上以 (cx, cy) 为中心、边长 side 的正方形 → 256×256
export function frameSquare(src, cx, cy, side) {
  const c = document.createElement("canvas"); c.width = SQ; c.height = SQ;
  const g = c.getContext("2d"); g.fillStyle = "#808080"; g.fillRect(0, 0, SQ, SQ);
  g.imageSmoothingQuality = "high"; g.drawImage(src, cx - side / 2, cy - side / 2, side, side, 0, 0, SQ, SQ);
  return c;
}
// 画面方块的小块特征（同一帧要和几张卡对齐时只算一次）
export const squareFeats = (canvas) => patchFeats(canvas);
// 对齐：返回参考卡四个角在 256×256 画面方块里的位置（拿不准返回 null）。frame：画面方块，或者 squareFeats 的结果
export async function alignCard(frame, ref) {
  const fr = frame.f ? frame : await patchFeats(frame), D = fr.D, n = fr.n;
  // 每个画面小块找参考图里最像的；双向都最像（互为最近）的才算一对
  const bestF = new Int32Array(n).fill(-1), simF = new Float32Array(n), bestR = new Int32Array(n).fill(-1), simR = new Float32Array(n).fill(-2);
  for (let i = 0; i < n; i++) {
    let b = -1, bs = -2;
    for (let j = 0; j < n; j++) {
      let s = 0; for (let k = 0, oi = i * D, oj = j * D; k < D; k++) s += fr.f[oi + k] * ref.f[oj + k];
      if (s > bs) { bs = s; b = j; }
      if (s > simR[j]) { simR[j] = s; bestR[j] = i; }
    }
    bestF[i] = b; simF[i] = bs;
  }
  const pairs = [];
  for (let i = 0; i < n; i++) { const j = bestF[i]; if (j >= 0 && bestR[j] === i && simF[i] > 0.45) pairs.push([patchCenter(j), patchCenter(i), simF[i]]); }
  if (pairs.length < 10) return null;
  // RANSAC：卡片基本是正对手机的，只算「平移 + 缩放 + 旋转」（相似变换，2 对点就能定），比透视变换稳得多
  const sim2 = (a1, a2, b1, b2) => { // a → b
    const ax = a2[0] - a1[0], ay = a2[1] - a1[1], bx = b2[0] - b1[0], by = b2[1] - b1[1], d = ax * ax + ay * ay;
    if (d < 1) return null;
    const c = (ax * bx + ay * by) / d, s = (ax * by - ay * bx) / d;
    return [c, s, b1[0] - (c * a1[0] - s * a1[1]), b1[1] - (s * a1[0] + c * a1[1])];
  };
  const apply = ([c, s, tx, ty], [x, y]) => [c * x - s * y + tx, s * x + c * y + ty];
  let best = null, bestIn = [];
  const TH = PATCH * 1.2;
  for (let it = 0; it < 400; it++) {
    const i = (Math.random() * pairs.length) | 0, j = (Math.random() * pairs.length) | 0;
    if (i === j) continue;
    const M = sim2(pairs[i][0], pairs[j][0], pairs[i][1], pairs[j][1]);
    if (!M) continue;
    const sc = Math.hypot(M[0], M[1]);
    if (sc < 0.25 || sc > 3) continue;
    const inl = [];
    for (let k = 0; k < pairs.length; k++) { const q = apply(M, pairs[k][0]); if (Math.hypot(q[0] - pairs[k][1][0], q[1] - pairs[k][1][1]) < TH) inl.push(k); }
    if (inl.length > bestIn.length) { bestIn = inl; best = M; }
  }
  if (!best || bestIn.length < 8 || bestIn.length < pairs.length * 0.25) return null;
  // 用所有认可的配对重新拟合（最小二乘相似变换）
  let sx = 0, sy = 0, tx = 0, ty = 0;
  for (const k of bestIn) { sx += pairs[k][0][0]; sy += pairs[k][0][1]; tx += pairs[k][1][0]; ty += pairs[k][1][1]; }
  const m = bestIn.length; sx /= m; sy /= m; tx /= m; ty /= m;
  let a = 0, bb = 0, d = 0;
  for (const k of bestIn) { const [x, y] = pairs[k][0], [u, v] = pairs[k][1], X = x - sx, Y = y - sy, U = u - tx, V = v - ty; a += X * U + Y * V; bb += X * V - Y * U; d += X * X + Y * Y; }
  const c = a / d, s2 = bb / d, M = [c, s2, tx - (c * sx - s2 * sy), ty - (s2 * sx + c * sy)];
  const quad = REF_CORNERS.map((p) => apply(M, p));
  return { quad, inliers: bestIn.length, pairs: pairs.length, scale: Math.hypot(c, s2) };
}
const mapPt = (M, [x, y]) => { const z = M[6] * x + M[7] * y + 1; return [(M[0] * x + M[1] * y + M[2]) / z, (M[3] * x + M[4] * y + M[5]) / z]; };
function solve8(A, b) {
  for (let col = 0; col < 8; col++) {
    let piv = col;
    for (let r = col + 1; r < 8; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < 1e-12) throw new Error("singular");
    [A[col], A[piv]] = [A[piv], A[col]]; [b[col], b[piv]] = [b[piv], b[col]];
    for (let r = 0; r < 8; r++) {
      if (r === col) continue;
      const f = A[r][col] / A[col][col];
      for (let k = col; k < 8; k++) A[r][k] -= f * A[col][k];
      b[r] -= f * b[col];
    }
  }
  return b.map((v, i) => v / A[i][i]);
}
// 把四边形（左上、右上、右下、左下）拉正成标准大小的卡片图（透视变换 + 双线性插值）
export function quadCanvas(src, q, w = CARD_W, h = CARD_H) {
  const xs = q.map((p) => p[0]), ys = q.map((p) => p[1]);
  const bx = Math.floor(Math.min(...xs)), by = Math.floor(Math.min(...ys));
  const bw = Math.max(2, Math.ceil(Math.max(...xs)) - bx), bh = Math.max(2, Math.ceil(Math.max(...ys)) - by);
  const s = Math.min(1, (h * 1.6) / bh);
  const SW = Math.max(2, Math.round(bw * s)), SH = Math.max(2, Math.round(bh * s));
  const wc = document.createElement("canvas"); wc.width = SW; wc.height = SH;
  const wg = wc.getContext("2d", { willReadFrequently: true });
  wg.imageSmoothingQuality = "high";
  wg.drawImage(src, bx, by, bw, bh, 0, 0, SW, SH);
  const sp = wg.getImageData(0, 0, SW, SH).data;
  const M = homography([[0, 0], [w, 0], [w, h], [0, h]], q.map(([x, y]) => [(x - bx) * s, (y - by) * s]));
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true }), img = g.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x + 0.5, v = y + 0.5, z = M[6] * u + M[7] * v + 1;
    let sx = (M[0] * u + M[1] * v + M[2]) / z - 0.5, sy = (M[3] * u + M[4] * v + M[5]) / z - 0.5;
    sx = Math.min(SW - 1.001, Math.max(0, sx)); sy = Math.min(SH - 1.001, Math.max(0, sy));
    const x0 = sx | 0, y0 = sy | 0, fx = sx - x0, fy = sy - y0, o = (y * w + x) * 4, i00 = (y0 * SW + x0) * 4, i01 = i00 + SW * 4;
    for (let ch = 0; ch < 3; ch++) d[o + ch] = (sp[i00 + ch] * (1 - fx) + sp[i00 + 4 + ch] * fx) * (1 - fy) + (sp[i01 + ch] * (1 - fx) + sp[i01 + 4 + ch] * fx) * fy;
    d[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}
function homography(from, to) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i], [u, v] = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  return solve8(A, b);
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
