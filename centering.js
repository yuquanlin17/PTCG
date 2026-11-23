// 居中检测（送评前预筛）：拍正面、背面，量四边白边（卡边 → 内框）的宽度，算左右 / 上下比例，对照各家评级公司的居中标准。
// 自动找边以后可以拖动 8 条线微调（拖的时候放大镜显示细节）。标准是网上整理的大致数字，以评级公司官网为准。

// 「55/45」= 宽的一边最多占两边合计的 55%
export const STANDARDS = [
  ["PSA", "10", 55, 75], ["PSA", "9", 60, 90], ["PSA", "8", 65, 90], ["PSA", "7", 70, 90],
  ["BGS", "10 黑标", 50, 55], ["BGS", "9.5", 55, 60], ["BGS", "9", 60, 65],
  ["CGC", "10 Pristine", 50, 50], ["CGC", "10 Gem Mint", 55, 75],
  ["TAG", "10", 55, 65],
];
const SIDES = { front: "正面", back: "背面" };
const MAXPX = 1600;

// ---------- 找边 ----------
// 图片缩到 MAXPX 以内的画布上找：先找卡边（最外面一圈明显的边），再在卡边往里 1%～15% 的范围找内框
export function detect(cv) {
  const w = cv.width, h = cv.height, d = cv.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const at = (x, y) => (y * w + x) * 4;
  const diff = (a, b) => Math.abs(d[a] - d[b]) + Math.abs(d[a + 1] - d[b + 1]) + Math.abs(d[a + 2] - d[b + 2]);
  // 竖线的分数：在 y0～y1 这段上，左右两边颜色差的平均；横线同理
  const colScore = (x, y0, y1) => { let s = 0, n = 0; for (let y = y0; y < y1; y += 2) { s += diff(at(x - 1, y), at(x + 1, y)); n++; } return n ? s / n : 0; };
  const rowScore = (y, x0, x1) => { let s = 0, n = 0; for (let x = x0; x < x1; x += 2) { s += diff(at(x, y - 1), at(x, y + 1)); n++; } return n ? s / n : 0; };
  const scan = (score, a, b, y0, y1) => {
    const out = [], end = Math.min(Math.round(b), (score === colScore ? w : h) - 1);
    for (let i = Math.max(1, Math.round(a)); i < end; i++) out.push([i, score(i, Math.round(y0), Math.round(y1))]);
    return out;
  };
  const peaks = (arr) => arr.filter(([, v], k) => k > 1 && k < arr.length - 2 && v >= arr[k - 1][1] && v >= arr[k + 1][1] && v > arr[k - 2][1] && v >= arr[k + 2][1]);
  // 外边：每边取最明显的几条候选，四条组合起来长宽比要像卡片（88:63），边越清楚越好、卡越大越好
  const cands = (arr) => { const pk = peaks(arr).sort((a, b) => b[1] - a[1]).slice(0, 6); return pk.length ? pk : [[arr.length ? arr[0][0] : 0, 0]]; };
  const my0 = Math.round(h * 0.3), my1 = Math.round(h * 0.7), mx0 = Math.round(w * 0.3), mx1 = Math.round(w * 0.7);
  const Ls = cands(scan(colScore, 2, w * 0.45, my0, my1)), Rs = cands(scan(colScore, w * 0.55, w - 2, my0, my1));
  const Ts = cands(scan(rowScore, 2, h * 0.45, mx0, mx1)), Bs = cands(scan(rowScore, h * 0.55, h - 2, mx0, mx1));
  const top = Math.max(...[...Ls, ...Rs, ...Ts, ...Bs].map((p) => p[1]), 1);
  let pick = null;
  for (const l of Ls) for (const r of Rs) for (const t of Ts) for (const b of Bs) {
    const ratio = (b[0] - t[0]) / (r[0] - l[0]);
    if (!(ratio > 1.3 && ratio < 1.5)) continue;
    const score = (l[1] + r[1] + t[1] + b[1]) / top - Math.abs(ratio / 1.397 - 1) * 6 + ((r[0] - l[0]) / w) * 0.8;
    if (!pick || score > pick.score) pick = { score, L: l[0], R: r[0], T: t[0], B: b[0] };
  }
  const best = (arr) => arr.reduce((a, b) => (b[1] > a[1] ? b : a), [null, -1])[0];
  const L = pick ? pick.L : best(scan(colScore, 2, w * 0.45, my0, my1)) ?? Math.round(w * 0.1);
  const R = pick ? pick.R : best(scan(colScore, w * 0.55, w - 2, my0, my1)) ?? Math.round(w * 0.9);
  const T = pick ? pick.T : best(scan(rowScore, 2, h * 0.45, mx0, mx1)) ?? Math.round(h * 0.1);
  const B = pick ? pick.B : best(scan(rowScore, h * 0.55, h - 2, mx0, mx1)) ?? Math.round(h * 0.9);
  const cw = R - L, ch = B - T;
  // 内框：只看卡中间那段（避开圆角），在卡边往里 1%～15% 里找最明显的一条
  const iy0 = Math.round(T + ch * 0.25), iy1 = Math.round(B - ch * 0.25), ix0 = Math.round(L + cw * 0.25), ix1 = Math.round(R - cw * 0.25);
  const il = best(scan(colScore, L + cw * 0.012, L + cw * 0.15, iy0, iy1)) ?? L + cw * 0.05;
  const ir = best(scan(colScore, R - cw * 0.15, R - cw * 0.012, iy0, iy1)) ?? R - cw * 0.05;
  const it = best(scan(rowScore, T + ch * 0.012, T + ch * 0.15, ix0, ix1)) ?? T + ch * 0.04;
  const ib = best(scan(rowScore, B - ch * 0.15, B - ch * 0.012, ix0, ix1)) ?? B - ch * 0.04;
  // 亚像素：在峰附近用抛物线拟合（边界在两个像素中间时，结果是 x.5）
  const refine = (pos, vert, y0, y1) => {
    const f = vert ? colScore : rowScore, n = vert ? w : h, p = Math.round(pos);
    if (p < 2 || p > n - 3) return pos;
    const a = f(p - 1, y0, y1), c = f(p, y0, y1), d = f(p + 1, y0, y1), den = a - 2 * c + d;
    return den < 0 ? p + Math.max(-0.5, Math.min(0.5, (a - d) / (2 * den))) : p;
  };
  return {
    L: refine(L, true, my0, my1), R: refine(R, true, my0, my1), T: refine(T, false, mx0, mx1), B: refine(B, false, mx0, mx1),
    l: refine(il, true, iy0, iy1), r: refine(ir, true, iy0, iy1), t: refine(it, false, ix0, ix1), b: refine(ib, false, ix0, ix1),
  };
}

// 比例：宽的一边占多少（55.3 表示 55.3/44.7）
export function ratios(e) {
  const lw = e.l - e.L, rw = e.R - e.r, tw = e.t - e.T, bw = e.B - e.b;
  const pct = (a, b) => (a + b > 0 ? (100 * Math.max(a, b)) / (a + b) : 50);
  return { lw, rw, tw, bw, lr: pct(lw, rw), tb: pct(tw, bw), lrSide: lw >= rw ? "左" : "右", tbSide: tw >= bw ? "上" : "下" };
}

// ---------- 界面 ----------
const CSS = `
.cz-bg { position: fixed; inset: 0; z-index: 30; background: var(--bg); overflow-y: auto; }
.cz { max-width: 560px; margin: 0 auto; padding: max(12px, env(safe-area-inset-top)) 16px calc(24px + env(safe-area-inset-bottom)); }
.cz-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
.cz-head h2 { font-size: 18px; margin: 0; }
.cz-tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 10px; }
.cz-tabs button { padding: 9px; border-radius: 10px; border: 1px solid var(--line); background: var(--surface); font-weight: 600; }
.cz-tabs button.on { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
.cz-tabs button small { font-weight: 500; opacity: .8; margin-left: 4px; }
.cz-stage { position: relative; background: #000; border-radius: 12px; overflow: hidden; touch-action: none; min-height: 200px; display: flex; align-items: center; justify-content: center; color: #cfd3dd; font-size: 14px; text-align: center; }
.cz-stage canvas { display: block; width: 100%; }
.cz-row { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0; align-items: center; }
.cz-row label.btn { cursor: pointer; }
.cz-rot { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--muted); }
.cz-rot input { flex: 1; }
.cz-num { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 8px 0; }
.cz-num div { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; }
.cz-num b { font: 700 18px var(--mono); display: block; }
.cz-num small { color: var(--muted); font-size: 12px; }
.cz-tbl { width: 100%; border-collapse: collapse; font-size: 13.5px; background: var(--surface); border-radius: 10px; overflow: hidden; }
.cz-tbl th, .cz-tbl td { padding: 7px 8px; border-bottom: 1px solid var(--line); text-align: left; }
.cz-tbl td.ok { color: var(--good); font-weight: 700; } .cz-tbl td.no { color: var(--bad); font-weight: 700; } .cz-tbl td.na { color: var(--muted); }
.cz-note { color: var(--muted); font-size: 12.5px; line-height: 1.55; margin-top: 10px; }
`;
let root = null;
const state = { side: "front", front: null, back: null, drag: null };

export function openCentering() {
  if (!root) build();
  root.hidden = false;
  document.body.style.overflow = "hidden";
  render();
}
function build() {
  const st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
  root = document.createElement("div"); root.className = "cz-bg"; root.hidden = true;
  root.innerHTML = `<div class="cz">
    <div class="cz-head"><h2>居中检测 · 送评前看看</h2><button class="btn small" data-close>关闭</button></div>
    <div class="cz-tabs"><button data-side="front">正面<small></small></button><button data-side="back">背面<small></small></button></div>
    <div class="cz-stage" data-stage><div style="padding:30px 16px">把卡（不带卡套 / 卡砖更准）平放在<b>颜色和卡边不一样</b>的桌面上，手机和卡保持平行，正对着拍。</div></div>
    <div class="cz-row">
      <label class="btn small primary">拍照<input type="file" accept="image/*" capture="environment" hidden data-file></label>
      <label class="btn small">从相册选<input type="file" accept="image/*" hidden data-file></label>
      <button class="btn small" data-auto hidden>重新自动找边</button>
    </div>
    <div class="cz-rot" data-rotrow hidden>转正 <input type="range" min="-6" max="6" step="0.1" value="0" data-rot><span data-rotv>0°</span></div>
    <div class="cz-num" data-num hidden></div>
    <div data-grades></div>
    <div class="cz-note">黄线是<b>卡边</b>，绿线是<b>内框</b>（正面是图框 / 黄边内侧，背面是蓝边内侧）。自动找边不一定准，按住线拖到正确位置，拖的时候会放大显示。<br>
    比例「55/45」= 宽的一边占两边白边合计的 55%。评级公司的标准是网上整理的大致数字（BGS / CGC / TAG 背面各家说法不一），以官网为准；居中只是评分的一项，边角、表面、白边磨损同样重要。</div>
  </div>`;
  document.body.appendChild(root);
  root.querySelector("[data-close]").onclick = () => { root.hidden = true; document.body.style.overflow = ""; };
  root.querySelectorAll("[data-side]").forEach((b) => (b.onclick = () => { state.side = b.dataset.side; render(); }));
  root.querySelectorAll("[data-file]").forEach((inp) => (inp.onchange = async (e) => {
    const f = e.target.files && e.target.files[0]; e.target.value = "";
    if (f) await loadSide(f);
  }));
  root.querySelector("[data-auto]").onclick = () => { const s = state[state.side]; if (s) { s.e = detect(s.cv); render(); } };
  root.querySelector("[data-rot]").oninput = (e) => {
    const s = state[state.side]; if (!s) return;
    s.rot = +e.target.value; root.querySelector("[data-rotv]").textContent = s.rot.toFixed(1) + "°";
    rotate(s); s.e = detect(s.cv); render();
  };
}
async function loadSide(file) {
  const url = URL.createObjectURL(file);
  const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = url; });
  const k = Math.min(1, MAXPX / Math.max(img.naturalWidth, img.naturalHeight));
  const src = document.createElement("canvas"); src.width = Math.round(img.naturalWidth * k); src.height = Math.round(img.naturalHeight * k);
  src.getContext("2d").drawImage(img, 0, 0, src.width, src.height);
  URL.revokeObjectURL(url);
  const s = { src, rot: 0, cv: null, e: null };
  rotate(s); s.e = detect(s.cv);
  state[state.side] = s;
  render();
}
function rotate(s) {
  const c = s.cv || document.createElement("canvas");
  c.width = s.src.width; c.height = s.src.height;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.fillStyle = "#000"; g.fillRect(0, 0, c.width, c.height);
  g.save(); g.translate(c.width / 2, c.height / 2); g.rotate((s.rot * Math.PI) / 180); g.drawImage(s.src, -c.width / 2, -c.height / 2); g.restore();
  s.cv = c;
}

const fmt = (p) => `${p.toFixed(1)}/${(100 - p).toFixed(1)}`;
function render() {
  root.querySelectorAll("[data-side]").forEach((b) => {
    b.classList.toggle("on", b.dataset.side === state.side);
    const s = state[b.dataset.side];
    b.querySelector("small").textContent = s ? (() => { const r = ratios(s.e); return `${Math.max(r.lr, r.tb).toFixed(0)}/${(100 - Math.max(r.lr, r.tb)).toFixed(0)}`; })() : "未拍";
  });
  const s = state[state.side], stage = root.querySelector("[data-stage]");
  root.querySelector("[data-auto]").hidden = !s;
  root.querySelector("[data-rotrow]").hidden = !s;
  if (s) { root.querySelector("[data-rot]").value = s.rot; root.querySelector("[data-rotv]").textContent = s.rot.toFixed(1) + "°"; }
  if (s) drawStage(stage, s);
  const num = root.querySelector("[data-num]");
  num.hidden = !s;
  if (s) {
    const r = ratios(s.e);
    num.innerHTML = `<div><small>左右（${SIDES[state.side]}）</small><b>${fmt(r.lr)}</b><small>${r.lrSide}边宽 · 左 ${r.lw.toFixed(0)} / 右 ${r.rw.toFixed(0)} 像素</small></div>
      <div><small>上下（${SIDES[state.side]}）</small><b>${fmt(r.tb)}</b><small>${r.tbSide}边宽 · 上 ${r.tw.toFixed(0)} / 下 ${r.bw.toFixed(0)} 像素</small></div>`;
  }
  root.querySelector("[data-grades]").innerHTML = gradeTable();
}
function gradeTable() {
  const worst = (k) => { const s = state[k]; if (!s) return null; const r = ratios(s.e); return Math.max(r.lr, r.tb); };
  const f = worst("front"), b = worst("back");
  if (f == null && b == null) return "";
  const cell = (v, lim) => (v == null ? `<td class="na">未拍</td>` : v <= lim + 1e-9 ? `<td class="ok">✓ ${lim}/${100 - lim}</td>` : `<td class="no">✗ ${lim}/${100 - lim}</td>`);
  const rows = STANDARDS.map(([co, g, fl, bl]) => `<tr><td><b>${co}</b> ${g}</td>${cell(f, fl)}${cell(b, bl)}</tr>`).join("");
  // 每家能拿到的最高等级（只看居中）
  const best = {};
  for (const [co, g, fl, bl] of STANDARDS) if (!best[co] && (f == null || f <= fl) && (b == null || b <= bl)) best[co] = g;
  const sum = ["PSA", "BGS", "CGC", "TAG"].map((co) => `${co} ${best[co] ? "最高 " + best[co] : "10 以下"}`).join(" · ");
  return `<div class="cz-note" style="margin:4px 0 8px;color:var(--fg)"><b>只看居中：</b>${sum}${f == null || b == null ? "（还差" + (f == null ? "正面" : "背面") + "）" : ""}</div>
    <table class="cz-tbl"><tr><th>等级</th><th>正面 ${f == null ? "" : fmt(f)}</th><th>背面 ${b == null ? "" : fmt(b)}</th></tr>${rows}</table>`;
}

// 画面：图 + 8 条线；按住拖线，拖的时候右上角显示放大镜
const LINES = [["L", "x", "outer"], ["R", "x", "outer"], ["T", "y", "outer"], ["B", "y", "outer"], ["l", "x", "inner"], ["r", "x", "inner"], ["t", "y", "inner"], ["b", "y", "inner"]];
function drawStage(stage, s) {
  let cv = stage.querySelector("canvas");
  if (!cv) {
    stage.innerHTML = ""; cv = document.createElement("canvas"); stage.appendChild(cv);
    const pos = (ev) => { const r = cv.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
    cv.onpointerdown = (ev) => {
      const cur = state[state.side]; if (!cur) return;
      const [px, py] = pos(ev), k = cv.clientWidth / cur.cv.width;
      let near = null, dmin = 22;
      for (const [key, ax] of LINES) {
        const v = cur.e[key] * k, dd = Math.abs((ax === "x" ? px : py) - v);
        if (dd < dmin) { dmin = dd; near = key; }
      }
      if (!near) return;
      cv.setPointerCapture(ev.pointerId);
      state.drag = { key: near, ax: LINES.find((l) => l[0] === near)[1], x: px, y: py };
      ev.preventDefault();
    };
    cv.onpointermove = (ev) => {
      const cur = state[state.side]; if (!state.drag || !cur) return;
      const [px, py] = pos(ev), k = cv.clientWidth / cur.cv.width;
      cur.e[state.drag.key] = (state.drag.ax === "x" ? px : py) / k;
      state.drag.x = px; state.drag.y = py;
      render();
    };
    cv.onpointerup = cv.onpointercancel = () => { state.drag = null; const cur = state[state.side]; if (cur) paint(cv, cur); };
  }
  paint(cv, s);
}
function paint(cv, s) {
  const dpr = window.devicePixelRatio || 1, W = cv.parentElement.clientWidth, H = Math.round((W * s.cv.height) / s.cv.width);
  if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.height = H + "px"; }
  const g = cv.getContext("2d"), k = (W * dpr) / s.cv.width;
  g.drawImage(s.cv, 0, 0, cv.width, cv.height);
  const e = s.e;
  // 白边区域淡淡涂色，方便看出两边宽窄
  g.fillStyle = "rgba(240,180,58,.18)";
  g.fillRect(e.L * k, e.T * k, (e.l - e.L) * k, (e.B - e.T) * k); g.fillRect(e.r * k, e.T * k, (e.R - e.r) * k, (e.B - e.T) * k);
  g.fillRect(e.l * k, e.T * k, (e.r - e.l) * k, (e.t - e.T) * k); g.fillRect(e.l * k, e.b * k, (e.r - e.l) * k, (e.B - e.b) * k);
  for (const [key, ax, kind] of LINES) {
    g.strokeStyle = kind === "outer" ? "#f0b43a" : "#3cc47c"; g.lineWidth = Math.max(1.5, 2 * dpr) * (state.drag && state.drag.key === key ? 1.6 : 1);
    g.beginPath();
    if (ax === "x") { g.moveTo(e[key] * k, 0); g.lineTo(e[key] * k, cv.height); } else { g.moveTo(0, e[key] * k); g.lineTo(cv.width, e[key] * k); }
    g.stroke();
  }
  // 放大镜
  if (state.drag) {
    const R = 70 * dpr, Z = 4, cx = state.drag.x * dpr, cy = state.drag.y * dpr;
    const ox = cx < cv.width / 2 ? cv.width - R - 10 * dpr : R + 10 * dpr, oy = R + 10 * dpr;
    g.save(); g.beginPath(); g.arc(ox, oy, R, 0, Math.PI * 2); g.clip();
    g.drawImage(cv, cx - R / Z, cy - R / Z, (2 * R) / Z, (2 * R) / Z, ox - R, oy - R, 2 * R, 2 * R);
    g.restore();
    g.strokeStyle = "#fff"; g.lineWidth = 2 * dpr; g.beginPath(); g.arc(ox, oy, R, 0, Math.PI * 2); g.stroke();
  }
}
