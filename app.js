function renderMath(el) {
  if (typeof renderMathInElement !== 'function') return;
  renderMathInElement(el, {
    delimiters: [
      { left: '\\[', right: '\\]', display: true },
      { left: '\\(', right: '\\)', display: false },
      { left: '$$', right: '$$', display: true }
    ],
    throwOnError: false
  });
}

/* ---------- sanitizer for AI-generated HTML/SVG before innerHTML injection ---------- */
function sanitizeHtml(html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  const strip = (node) => {
    Array.from(node.children).forEach(child => {
      const tag = child.tagName;
      if (['SCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'STYLE'].includes(tag)) {
        child.remove();
        return;
      }
      Array.from(child.attributes).forEach(attr => {
        const name = attr.name.toLowerCase();
        const val  = attr.value.trim().toLowerCase();
        if (name.startsWith('on') || ((name === 'href' || name === 'src') && val.startsWith('javascript:'))) {
          child.removeAttribute(attr.name);
        }
      });
      strip(child);
    });
  };
  strip(template.content);
  return template.innerHTML;
}

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ---------- tiny safe math expression parser (no eval/Function) ---------- */
function parseMathExpr(expr) {
  const tokens = [];
  const re = /\s*([A-Za-z_][A-Za-z_0-9]*|\d+\.?\d*|\.\d+|\^|\*|\/|\+|-|\(|\)|,)/g;
  let m;
  while ((m = re.exec(expr))) tokens.push(m[1]);
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parseExpression() {
    let node = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const op = next();
      node = { op, left: node, right: parseTerm() };
    }
    return node;
  }
  function parseTerm() {
    let node = parseUnary();
    while (peek() === '*' || peek() === '/') {
      const op = next();
      node = { op, left: node, right: parseUnary() };
    }
    return node;
  }
  function parseUnary() {
    if (peek() === '-') { next(); return { op: 'neg', arg: parseUnary() }; }
    if (peek() === '+') { next(); return parseUnary(); }
    return parsePower();
  }
  function parsePower() {
    let node = parseAtom();
    if (peek() === '^') {
      next();
      node = { op: '^', left: node, right: parseUnary() };
    }
    return node;
  }
  function parseAtom() {
    const t = peek();
    if (t === undefined) throw new Error('Unexpected end of expression');
    if (t === '(') {
      next();
      const node = parseExpression();
      if (peek() === ')') next();
      return node;
    }
    if (/^(\d|\.)/.test(t)) { next(); return { num: parseFloat(t) }; }
    if (/^[A-Za-z_]/.test(t)) {
      next();
      if (peek() === '(') {
        next();
        const args = [parseExpression()];
        while (peek() === ',') { next(); args.push(parseExpression()); }
        if (peek() === ')') next();
        return { call: t, args };
      }
      return { name: t };
    }
    throw new Error('Unexpected token: ' + t);
  }

  const ast = parseExpression();
  if (pos < tokens.length) throw new Error('Trailing tokens');
  return ast;
}

function evalMathAst(node, x) {
  if (node.num !== undefined) return node.num;
  if (node.name) {
    const n = node.name.toLowerCase();
    if (n === 'x') return x;
    if (n === 'pi') return Math.PI;
    if (n === 'e') return Math.E;
    return NaN;
  }
  if (node.call) {
    const a = node.args.map(arg => evalMathAst(arg, x));
    switch (node.call.toLowerCase()) {
      case 'sin': return Math.sin(a[0]);
      case 'cos': return Math.cos(a[0]);
      case 'tan': return Math.tan(a[0]);
      case 'sqrt': return Math.sqrt(a[0]);
      case 'abs': return Math.abs(a[0]);
      case 'log': return Math.log(a[0]);
      case 'log10': return Math.log10(a[0]);
      case 'exp': return Math.exp(a[0]);
      case 'pow': return Math.pow(a[0], a[1]);
      case 'min': return Math.min(...a);
      case 'max': return Math.max(...a);
      default: return NaN;
    }
  }
  if (node.op === 'neg') return -evalMathAst(node.arg, x);
  const l = evalMathAst(node.left, x), r = evalMathAst(node.right, x);
  switch (node.op) {
    case '+': return l + r;
    case '-': return l - r;
    case '*': return l * r;
    case '/': return l / r;
    case '^': return Math.pow(l, r);
  }
  return NaN;
}

/* ---------- geometry math helpers ---------- */
const geoSub   = (P, Q) => ({ x: P.x - Q.x, y: P.y - Q.y });
const geoAdd   = (P, Q) => ({ x: P.x + Q.x, y: P.y + Q.y });
const geoScale = (P, s) => ({ x: P.x * s, y: P.y * s });
const geoDist  = (P, Q) => Math.hypot(P.x - Q.x, P.y - Q.y);
const geoNorm  = (P) => { const l = Math.hypot(P.x, P.y) || 1; return { x: P.x / l, y: P.y / l }; };

function triangleVertices(a, b, c) {
  if (![a, b, c].every(n => Number.isFinite(n) && n > 0)) return null;
  if (!(a + b > c && a + c > b && b + c > a)) return null;
  const B = { x: 0, y: 0 };
  const C = { x: a, y: 0 };
  const x = (c * c - b * b + a * a) / (2 * a);
  const y2 = c * c - x * x;
  if (y2 < 0) return null;
  const A = { x, y: Math.sqrt(y2) };
  return { A, B, C };
}

function footOfPerpendicular(P, Q, R) {
  const d = geoSub(R, Q);
  const len2 = d.x * d.x + d.y * d.y;
  if (len2 === 0) return { ...Q };
  const t = ((P.x - Q.x) * d.x + (P.y - Q.y) * d.y) / len2;
  return { x: Q.x + t * d.x, y: Q.y + t * d.y };
}

function triangleArea(a, b, c) {
  const s = (a + b + c) / 2;
  return Math.sqrt(Math.max(s * (s - a) * (s - b) * (s - c), 0));
}

function triangleIncenter(A, B, C, a, b, c) {
  const sum = a + b + c;
  return { x: (a * A.x + b * B.x + c * C.x) / sum, y: (a * A.y + b * B.y + c * C.y) / sum };
}

function triangleCircumcenter(A, B, C) {
  const d = 2 * (A.x * (B.y - C.y) + B.x * (C.y - A.y) + C.x * (A.y - B.y));
  if (Math.abs(d) < 1e-9) return null;
  const ux = ((A.x ** 2 + A.y ** 2) * (B.y - C.y) + (B.x ** 2 + B.y ** 2) * (C.y - A.y) + (C.x ** 2 + C.y ** 2) * (A.y - B.y)) / d;
  const uy = ((A.x ** 2 + A.y ** 2) * (C.x - B.x) + (B.x ** 2 + B.y ** 2) * (A.x - C.x) + (C.x ** 2 + C.y ** 2) * (B.x - A.x)) / d;
  return { x: ux, y: uy };
}

/* ---------- SVG builders ---------- */
function buildTriangleSVG(data) {
  try {
    const a = Number(data.sides?.a), b = Number(data.sides?.b), c = Number(data.sides?.c);
    const verts = triangleVertices(a, b, c);
    if (!verts) return null;
    const { A, B, C } = verts;
    const vertexOf = { A, B, C };
    const oppositeSide = { A: [B, C], B: [C, A], C: [A, B] };

    const points = [A, B, C];
    let altitudeInfo = null, medianInfo = null, bisectorInfo = null, incircleInfo = null, circumcircleInfo = null;

    if (data.altitude && vertexOf[data.altitude]) {
      const v = data.altitude, P = vertexOf[v], [Q, R] = oppositeSide[v];
      const H = footOfPerpendicular(P, Q, R);
      points.push(H);
      altitudeInfo = { P, H, Q, R };
    }
    if (data.median && vertexOf[data.median]) {
      const v = data.median, P = vertexOf[v], [Q, R] = oppositeSide[v];
      const M = { x: (Q.x + R.x) / 2, y: (Q.y + R.y) / 2 };
      points.push(M);
      medianInfo = { P, M };
    }
    if (data.bisector && vertexOf[data.bisector]) {
      const v = data.bisector, P = vertexOf[v], [Q, R] = oppositeSide[v];
      const PQ = geoDist(P, Q), PR = geoDist(P, R);
      const t = PQ / (PQ + PR);
      const D = { x: Q.x + t * (R.x - Q.x), y: Q.y + t * (R.y - Q.y) };
      points.push(D);
      bisectorInfo = { P, D };
    }
    if (data.incircle) {
      const I = triangleIncenter(A, B, C, a, b, c);
      const r = triangleArea(a, b, c) / ((a + b + c) / 2);
      points.push({ x: I.x - r, y: I.y - r }, { x: I.x + r, y: I.y + r });
      incircleInfo = { I, r };
    }
    if (data.circumcircle) {
      const O = triangleCircumcenter(A, B, C);
      if (O) {
        const R = geoDist(O, A);
        points.push({ x: O.x - R, y: O.y - R }, { x: O.x + R, y: O.y + R });
        circumcircleInfo = { O, R };
      }
    }

    const unit = Math.min(a, b, c);
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const span = Math.max(maxX - minX, maxY - minY) || 1;
    const pad = span * 0.2 + unit * 0.16;
    const W = (maxX - minX) + pad * 2;
    const H = (maxY - minY) + pad * 2;
    const map = (p) => ({ x: p.x - minX + pad, y: (maxY - p.y) + pad });
    const fmt = (p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
    const fs = (unit * 0.16).toFixed(2);
    const dotR = (unit * 0.035).toFixed(2);
    const strokeThick = (unit * 0.022).toFixed(3);
    const strokeThin  = (unit * 0.015).toFixed(3);
    const strokeMark  = (unit * 0.011).toFixed(3);
    const dash = `${(unit * 0.045).toFixed(3)},${(unit * 0.032).toFixed(3)}`;

    const dispW = 320;
    const dispH = Math.round(dispW * H / W);
    let svg = `<div style="max-width:${dispW}px;margin:18px auto;overflow-x:auto;"><svg viewBox="0 0 ${W.toFixed(2)} ${H.toFixed(2)}" width="${dispW}" height="${dispH}" style="max-width:100%;height:auto;display:block;" xmlns="http://www.w3.org/2000/svg">`;

    const mA = map(A), mB = map(B), mC = map(C);
    svg += `<polygon points="${fmt(mA)} ${fmt(mB)} ${fmt(mC)}" fill="rgba(110,181,255,0.08)" stroke="var(--accent2)" stroke-width="${strokeThick}" />`;

    const centroid = { x: (A.x + B.x + C.x) / 3, y: (A.y + B.y + C.y) / 3 };
    const labelPoint = (name, P, color, off) => {
      const dir = geoNorm(geoSub(P, centroid));
      const lp = map(geoAdd(P, geoScale(dir, off)));
      svg += `<text x="${lp.x.toFixed(2)}" y="${lp.y.toFixed(2)}" font-size="${fs}" fill="${color}" text-anchor="middle" dominant-baseline="middle" font-weight="600">${escapeXml(name)}</text>`;
    };
    labelPoint('A', A, 'var(--text)', unit * 0.16);
    labelPoint('B', B, 'var(--text)', unit * 0.16);
    labelPoint('C', C, 'var(--text)', unit * 0.16);

    const labelSide = (P, Q, len) => {
      const mid = { x: (P.x + Q.x) / 2, y: (P.y + Q.y) / 2 };
      const dir = geoNorm(geoSub(mid, centroid));
      const lp = map(geoAdd(mid, geoScale(dir, unit * 0.11)));
      svg += `<text x="${lp.x.toFixed(2)}" y="${lp.y.toFixed(2)}" font-size="${(fs * 0.82).toFixed(2)}" fill="var(--muted)" text-anchor="middle">${escapeXml(len)}</text>`;
    };
    labelSide(B, C, a); labelSide(C, A, b); labelSide(A, B, c);

    if (altitudeInfo) {
      const { P, H, Q, R } = altitudeInfo;
      const mp = map(P), mh = map(H);
      svg += `<line x1="${mp.x.toFixed(2)}" y1="${mp.y.toFixed(2)}" x2="${mh.x.toFixed(2)}" y2="${mh.y.toFixed(2)}" stroke="var(--accent)" stroke-width="${strokeThin}" stroke-dasharray="${dash}" />`;
      const baseDir = geoNorm(geoSub(R, Q));
      const altDir  = geoNorm(geoSub(P, H));
      const ms = unit * 0.09;
      const p1 = geoAdd(H, geoScale(baseDir, ms));
      const p2 = geoAdd(p1, geoScale(altDir, ms));
      const p3 = geoAdd(H, geoScale(altDir, ms));
      const m1 = map(p1), m2 = map(p2), m3 = map(p3);
      svg += `<polyline points="${fmt(m1)} ${fmt(m2)} ${fmt(m3)}" fill="none" stroke="var(--text)" stroke-width="${strokeMark}" />`;
      const mhDot = map(H);
      svg += `<circle cx="${mhDot.x.toFixed(2)}" cy="${mhDot.y.toFixed(2)}" r="${dotR}" fill="var(--accent)" />`;
      const outLabel = map(geoAdd(H, geoScale(altDir, -unit * 0.13)));
      svg += `<text x="${outLabel.x.toFixed(2)}" y="${outLabel.y.toFixed(2)}" font-size="${(fs * 0.9).toFixed(2)}" fill="var(--accent)" text-anchor="middle" dominant-baseline="middle" font-weight="600">H</text>`;
    }
    if (medianInfo) {
      const { P, M } = medianInfo;
      const mp = map(P), mm = map(M);
      svg += `<line x1="${mp.x.toFixed(2)}" y1="${mp.y.toFixed(2)}" x2="${mm.x.toFixed(2)}" y2="${mm.y.toFixed(2)}" stroke="var(--accent3)" stroke-width="${strokeThin}" stroke-dasharray="${dash}" />`;
      svg += `<circle cx="${mm.x.toFixed(2)}" cy="${mm.y.toFixed(2)}" r="${dotR}" fill="var(--accent3)" />`;
    }
    if (bisectorInfo) {
      const { P, D } = bisectorInfo;
      const mp = map(P), md = map(D);
      svg += `<line x1="${mp.x.toFixed(2)}" y1="${mp.y.toFixed(2)}" x2="${md.x.toFixed(2)}" y2="${md.y.toFixed(2)}" stroke="var(--success)" stroke-width="${strokeThin}" stroke-dasharray="${dash}" />`;
      svg += `<circle cx="${md.x.toFixed(2)}" cy="${md.y.toFixed(2)}" r="${dotR}" fill="var(--success)" />`;
    }
    if (incircleInfo) {
      const mi = map(incircleInfo.I);
      const rScaled = Math.abs((map({ x: incircleInfo.I.x + incircleInfo.r, y: incircleInfo.I.y }).x) - mi.x);
      svg += `<circle cx="${mi.x.toFixed(2)}" cy="${mi.y.toFixed(2)}" r="${rScaled.toFixed(2)}" fill="none" stroke="var(--accent)" stroke-width="${strokeThin}" stroke-dasharray="${dash}" />`;
      svg += `<circle cx="${mi.x.toFixed(2)}" cy="${mi.y.toFixed(2)}" r="${dotR}" fill="var(--accent)" />`;
    }
    if (circumcircleInfo) {
      const mo = map(circumcircleInfo.O);
      const rScaled = Math.abs((map({ x: circumcircleInfo.O.x + circumcircleInfo.R, y: circumcircleInfo.O.y }).x) - mo.x);
      svg += `<circle cx="${mo.x.toFixed(2)}" cy="${mo.y.toFixed(2)}" r="${rScaled.toFixed(2)}" fill="none" stroke="var(--accent3)" stroke-width="${strokeThin}" stroke-dasharray="${dash}" />`;
      svg += `<circle cx="${mo.x.toFixed(2)}" cy="${mo.y.toFixed(2)}" r="${dotR}" fill="var(--accent3)" />`;
    }

    svg += `</svg></div>`;
    if (data.caption) {
      svg += `<div style="text-align:center;font-size:0.8rem;color:var(--muted);margin:-10px 0 14px;">${escapeXml(data.caption)}</div>`;
    }
    return svg;
  } catch (e) {
    return null;
  }
}

function niceStep(range, target = 6) {
  const raw = range / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return step * mag;
}

function buildPlotSVG(data) {
  try {
    const fns = Array.isArray(data.fns) ? data.fns : (data.fn ? [data.fn] : []);
    if (!fns.length) return null;
    const domain = Array.isArray(data.domain) && data.domain.length === 2 ? data.domain.map(Number) : [-10, 10];
    const [xmin, xmax] = domain;
    if (!(Number.isFinite(xmin) && Number.isFinite(xmax)) || xmin >= xmax) return null;

    const colors = ['var(--accent2)', 'var(--accent)', 'var(--accent3)', 'var(--danger)', 'var(--success)'];
    const N = 240;
    const series = [];
    let yMin = Infinity, yMax = -Infinity;

    for (const fnStr of fns) {
      let ast;
      try { ast = parseMathExpr(fnStr); } catch (e) { continue; }
      const pts = [];
      for (let i = 0; i <= N; i++) {
        const x = xmin + (xmax - xmin) * i / N;
        const y = evalMathAst(ast, x);
        if (Number.isFinite(y)) {
          pts.push({ x, y });
          if (y < yMin) yMin = y;
          if (y > yMax) yMax = y;
        } else {
          pts.push(null);
        }
      }
      series.push({ fnStr, pts });
    }
    if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) return null;
    if (yMin === yMax) { yMin -= 1; yMax += 1; }
    const padY = (yMax - yMin) * 0.12;
    yMin -= padY; yMax += padY;

    const W = 480, H = 320, marginL = 40, marginR = 18, marginT = 18, marginB = 34;
    const plotW = W - marginL - marginR, plotH = H - marginT - marginB;
    const mapX = (x) => marginL + (x - xmin) / (xmax - xmin) * plotW;
    const mapY = (y) => marginT + (yMax - y) / (yMax - yMin) * plotH;

    let svg = `<div style="max-width:${W}px;margin:18px auto;overflow-x:auto;"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="max-width:100%;height:auto;display:block;" xmlns="http://www.w3.org/2000/svg">`;

    const xStep = niceStep(xmax - xmin), yStep = niceStep(yMax - yMin);
    for (let gx = Math.ceil(xmin / xStep) * xStep; gx <= xmax + 1e-9; gx += xStep) {
      const px = mapX(gx);
      svg += `<line x1="${px.toFixed(1)}" y1="${marginT}" x2="${px.toFixed(1)}" y2="${marginT + plotH}" stroke="var(--border)" stroke-width="1" opacity="0.5"/>`;
      svg += `<text x="${px.toFixed(1)}" y="${(marginT + plotH + 16).toFixed(1)}" font-size="10" fill="var(--muted)" text-anchor="middle">${Math.round(gx * 100) / 100}</text>`;
    }
    for (let gy = Math.ceil(yMin / yStep) * yStep; gy <= yMax + 1e-9; gy += yStep) {
      const py = mapY(gy);
      svg += `<line x1="${marginL}" y1="${py.toFixed(1)}" x2="${marginL + plotW}" y2="${py.toFixed(1)}" stroke="var(--border)" stroke-width="1" opacity="0.5"/>`;
      svg += `<text x="${(marginL - 6).toFixed(1)}" y="${(py + 3).toFixed(1)}" font-size="10" fill="var(--muted)" text-anchor="end">${Math.round(gy * 100) / 100}</text>`;
    }
    if (xmin <= 0 && xmax >= 0) {
      const px = mapX(0);
      svg += `<line x1="${px.toFixed(1)}" y1="${marginT}" x2="${px.toFixed(1)}" y2="${marginT + plotH}" stroke="var(--muted)" stroke-width="1.4"/>`;
    }
    if (yMin <= 0 && yMax >= 0) {
      const py = mapY(0);
      svg += `<line x1="${marginL}" y1="${py.toFixed(1)}" x2="${marginL + plotW}" y2="${py.toFixed(1)}" stroke="var(--muted)" stroke-width="1.4"/>`;
    }

    series.forEach((s, idx) => {
      const color = colors[idx % colors.length];
      let d = '', started = false;
      for (const p of s.pts) {
        if (!p) { started = false; continue; }
        const px = mapX(p.x), py = mapY(p.y);
        d += (started ? 'L ' : 'M ') + px.toFixed(2) + ' ' + py.toFixed(2) + ' ';
        started = true;
      }
      if (d) svg += `<path d="${d}" fill="none" stroke="${color}" stroke-width="2.2" />`;
    });

    const labels = Array.isArray(data.labels) ? data.labels : fns;
    let ly = marginT + 4;
    labels.forEach((lab, idx) => {
      const color = colors[idx % colors.length];
      svg += `<rect x="${marginL + plotW - 118}" y="${(ly - 8).toFixed(1)}" width="10" height="10" fill="${color}" rx="2"/>`;
      svg += `<text x="${marginL + plotW - 104}" y="${ly.toFixed(1)}" font-size="10" fill="var(--text)">${escapeXml(lab)}</text>`;
      ly += 16;
    });

    svg += `</svg></div>`;
    return svg;
  } catch (e) {
    return null;
  }
}

function renderGeometryFigures(root) {
  root.querySelectorAll('.geo-figure').forEach(el => {
    try {
      const data = JSON.parse(el.getAttribute('data-geo'));
      const svgHtml = data.type === 'triangle' ? buildTriangleSVG(data) : null;
      if (svgHtml) el.outerHTML = svgHtml; else el.remove();
    } catch (e) {
      el.remove();
    }
  });
}

function renderFunctionPlots(root) {
  root.querySelectorAll('.fn-plot').forEach(el => {
    try {
      const data = JSON.parse(el.getAttribute('data-plot'));
      const svgHtml = buildPlotSVG(data);
      if (svgHtml) el.outerHTML = svgHtml; else el.remove();
    } catch (e) {
      el.remove();
    }
  });
}

function renderRichContent(el) {
  renderGeometryFigures(el);
  renderFunctionPlots(el);
  renderMath(el);
}

let lessonLoadTimer = null;
let currentGrade = '';
let currentGradeLabel = 'общообразователно ниво';
let currentSubject = '';
let currentUnit = '';
let currentTopic = '';
let currentLessonContent = '';
let savedLessons = JSON.parse(localStorage.getItem('luminary_saved') || '[]');
let testHistory = JSON.parse(localStorage.getItem('luminary_test_history') || '[]');
let currentAssessment = null;
let testAnswers = {};
let testCurrentIndex = 0;
let testResults = null;
let testReadOnlyMode = false;

const subjectDataMapping = {
  'math': 'Математика',
  'bulgarian': 'български език и литература',
  'english': 'Английски език',
  'history': 'История',
  'biology': 'Биология и здравно образование',
  'physics': 'физика_и_астрономия',
  'chemistry': 'химия и опазване на околната среда',
  'cs': 'информатика',
  'geography': 'geography',
  'art': 'Изобразително изкуство',
  'chovek_prirodata': 'Човекът и природата',
  'chovek_obshtestvo': 'Човекът и обществото',
  'rodinoznanie': 'родинознание'
};

const subjects = [
  { id: 'math', letter: 'М', name: 'Математика',
    desc: 'Алгебра, геометрия, смятане и още',
    accentColor: '#f0c060', accentBorder: 'rgba(240,192,96,0.4)',
    letterBg: 'rgba(240,192,96,0.22)' },
  { id: 'bulgarian', letter: 'Б', name: 'Български език',
    desc: 'Граматика, писане, литература',
    accentColor: '#6eb5ff', accentBorder: 'rgba(110,181,255,0.4)',
    letterBg: 'rgba(110,181,255,0.22)' },
  { id: 'english', letter: 'А', name: 'Английски език',
    desc: 'Граматика, речник, разговорна практика',
    accentColor: '#6effa0', accentBorder: 'rgba(110,255,160,0.4)',
    letterBg: 'rgba(110,255,160,0.22)' },
  { id: 'history', letter: 'И', name: 'История и цивилизация',
    desc: 'Световна и българска история',
    accentColor: '#ff9f6b', accentBorder: 'rgba(255,159,107,0.4)',
    letterBg: 'rgba(255,159,107,0.22)' },
  { id: 'biology', letter: 'Б', name: 'Биология',
    desc: 'Животни, растения, човешко тяло',
    accentColor: '#5dde8f', accentBorder: 'rgba(93,222,143,0.4)',
    letterBg: 'rgba(93,222,143,0.22)' },
  { id: 'physics', letter: 'Ф', name: 'Физика',
    desc: 'Движение, енергия, светлина',
    accentColor: '#ff9f6b', accentBorder: 'rgba(255,159,107,0.4)',
    letterBg: 'rgba(255,159,107,0.22)' },
  { id: 'chemistry', letter: 'Х', name: 'Химия',
    desc: 'Вещества, реакции и опазване на околната среда',
    accentColor: '#ff8c00', accentBorder: 'rgba(255,140,0,0.4)',
    letterBg: 'rgba(255,140,0,0.22)' },
  { id: 'cs', letter: 'И', name: 'Информатика',
    desc: 'Програмиране, алгоритми, уеб',
    accentColor: '#b08fff', accentBorder: 'rgba(176,143,255,0.4)',
    letterBg: 'rgba(176,143,255,0.22)' },
  { id: 'geography', letter: 'Г', name: 'География и икономика',
    desc: 'Физическа и социална география',
    accentColor: '#5dd6de', accentBorder: 'rgba(93,214,222,0.4)',
    letterBg: 'rgba(93,214,222,0.22)' },
  { id: 'art', letter: 'И', name: 'Изобразително изкуство',
    desc: 'Теория, история и техники',
    accentColor: '#ff7eb3', accentBorder: 'rgba(255,126,179,0.4)',
    letterBg: 'rgba(255,126,179,0.22)' },
  { id: 'chovek_prirodata', letter: 'П', name: 'Човекът и природата',
    desc: 'Основи на природата и човешкото здраве',
    accentColor: '#8fd14f', accentBorder: 'rgba(143,209,79,0.4)',
    letterBg: 'rgba(143,209,79,0.22)' },
  { id: 'chovek_obshtestvo', letter: 'О', name: 'Човекът и обществото',
    desc: 'Социални умения, държава, гражданство',
    accentColor: '#ffb74d', accentBorder: 'rgba(255,183,77,0.4)',
    letterBg: 'rgba(255,183,77,0.22)' },
  { id: 'rodinoznanie', letter: 'Р', name: 'Родинознание',
    desc: 'Познай своя роден край и родина',
    accentColor: '#4da6ff', accentBorder: 'rgba(77,166,255,0.4)',
    letterBg: 'rgba(77,166,255,0.22)' }
];

const quickTopics = [
  { letter: 'П', name: 'Питагорова теорема',  sub: 'math',    topic: 'Геометрия' },
  { letter: 'Д', name: 'ДНК и генетика',       sub: 'science', topic: 'Генетика' },
  { letter: 'В', name: 'Българско Възраждане', sub: 'history', topic: 'Българско Възраждане' },
  { letter: 'Ц', name: 'Цикли в Python',        sub: 'cs',      topic: 'Python основи' },
];

const gradeLabels = {
  '1': '1. клас',  '2': '2. клас',  '3': '3. клас',  '4': '4. клас',
  '5': '5. клас',  '6': '6. клас',  '7': '7. клас',  '8': '8. клас',
  '9': '9. клас',  '10': '10. клас', '11': '11. клас', '12': '12. клас',
};

function getDataSubjectNames(subjectId) {
  const val = subjectDataMapping[subjectId];
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

function isSubjectAvailableForGrade(subjectId, grade) {
  if (!grade) return true;
  const names = getDataSubjectNames(subjectId);
  for (const name of names) {
    const dataSubject = topicsBySubject[name];
    if (dataSubject && dataSubject[grade]) return true;
  }
  return false;
}

function renderHome() {
  const grid = document.getElementById('subject-grid');
  let displaySubjects = subjects;
  if (currentGrade) {
    displaySubjects = subjects.filter(s => isSubjectAvailableForGrade(s.id, currentGrade));
  }

  grid.innerHTML = displaySubjects.map(s => `
    <div class="subject-card" onclick="openSubject('${s.id}')"
      style="--card-accent: linear-gradient(135deg, transparent 60%, ${s.accentColor}08);
             --card-accent-border: ${s.accentBorder};
             border-color: ${s.accentBorder.replace('0.4)', '0.22)')}">
      <div class="subject-letter" style="background:${s.letterBg}; color:${s.accentColor}">
        ${s.letter}
      </div>
      <h3>${s.name}</h3>
      <p>${s.desc}</p>
    </div>
  `).join('');

  const qGrid = document.getElementById('quick-grid');
  qGrid.innerHTML = quickTopics.map(q => `
    <div class="subject-card" onclick="openSubjectTopic('${q.sub}', '${q.topic}')">
      <div class="subject-letter" style="background:rgba(240,192,96,0.22); color:var(--accent)">
        ${q.letter}
      </div>
      <h3>${q.name}</h3>
      <p>Бърз урок — кликни за начало</p>
    </div>
  `).join('');
}

function navigate(screen) {
  ['home', 'lesson', 'saved', 'test'].forEach(s => {
    document.getElementById(`${s}-screen`).style.display = 'none';
    const tab = document.getElementById(`tab-${s}`);
    if (tab) tab.classList.remove('active');
  });
  document.getElementById(`${screen}-screen`).style.display = 'block';
  const tab = document.getElementById(`tab-${screen}`);
  if (tab) tab.classList.add('active');
  if (screen === 'saved') { renderSaved(); renderTestHistory(); }
}

function onGradeChange() {
  currentGrade = document.getElementById('grade-select').value;
  const indicator = document.getElementById('grade-indicator');
  const label     = document.getElementById('grade-label');

  if (currentGrade) {
    label.textContent = gradeLabels[currentGrade] || currentGrade;
    indicator.classList.remove('hidden');
  } else {
    indicator.classList.add('hidden');
  }

  renderHome();
}

function openSubject(subjectId) {
  currentSubject = subjectId;
  const subj = subjects.find(s => s.id === subjectId);
  navigate('lesson');

  const gradeLabel = currentGrade ? ` · ${gradeLabels[currentGrade]}` : '';
  document.getElementById('lesson-breadcrumb').textContent = `${subj.name}${gradeLabel}`;
  document.getElementById('lesson-title').textContent = 'Избери раздел';

  document.getElementById('lesson-topic-select')?.classList.remove('topic-select-collapsed');
  document.getElementById('toggle-topics-btn')?.setAttribute('hidden', '');

  document.getElementById('step-unit')?.classList.add('active');
  document.getElementById('step-topic')?.classList.remove('active');

  const gradeKey = currentGrade || '1';
  let units = [];
  const names = getDataSubjectNames(subjectId);
  for (const name of names) {
    const dataSubj = topicsBySubject[name];
    if (dataSubj && dataSubj[gradeKey]) {
      units = dataSubj[gradeKey];
      break;
    }
  }

  const pills = document.getElementById('topic-pills');
  if (units.length > 0) {
    pills.innerHTML = units.map((u, idx) => `
      <div class="topic-pill" onclick="selectUnit('${u.unit}', ${idx}, this)">
        <span class="pill-label">${u.unit}</span>
        <span class="pill-count">${(u.topics?.length || 0)} теми</span>
      </div>
    `).join('');
  } else {
    pills.innerHTML = '<div class="topic-pill disabled">Няма налични раздели за този клас</div>';
  }

  document.getElementById('lesson-content').innerHTML = '';
  document.getElementById('take-test-wrap')?.setAttribute('hidden', '');
  document.getElementById('ai-chat').innerHTML = `
    <div class="chat-msg ai">
      Здравей! Аз съм твоят AI учител по <strong>${subj.name}</strong>. Избери раздел отгоре и после тема. Попитай ме да обясня нещо по-просто, да дам пример или да те изпитам!
    </div>`;
}

function selectUnit(unitName, unitIndex, el) {
  currentUnit = unitName;
  document.querySelectorAll('.topic-pill').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  
  document.getElementById('lesson-title').textContent = unitName;
  document.getElementById('step-unit')?.classList.remove('active');
  document.getElementById('step-topic')?.classList.add('active');

  const dataSubjectName = subjectDataMapping[currentSubject];
  const dataSubject = topicsBySubject[dataSubjectName];
  const gradeKey = currentGrade || '1';
  const units = dataSubject && dataSubject[gradeKey] ? dataSubject[gradeKey] : [];
  const currentUnitData = units[unitIndex];
  
  if (currentUnitData && currentUnitData.topics) {
    const topicsHtml = `
      <h3>Теми в раздела:</h3>
      <div class="topic-grid">
        ${currentUnitData.topics.map(t => `
          <div class="topic-card" onclick="selectTopic('${t.replace(/'/g, "\\'")}', this)">
            <div class="topic-card-title">${t}</div>
            <div class="topic-card-meta">Кликни, за да започнеш урока</div>
          </div>
        `).join('')}
      </div>
    `;
    document.getElementById('lesson-content').innerHTML = topicsHtml;
  }
}

function openSubjectTopic(subjectId, topic) {
  openSubject(subjectId);

  const gradeKey = currentGrade || '1';
  const names = getDataSubjectNames(subjectId);
  let units = [];
  for (const name of names) {
    const dataSubj = topicsBySubject[name];
    if (dataSubj && dataSubj[gradeKey]) {
      units = dataSubj[gradeKey];
      break;
    }
  }

  const unitIndex = units.findIndex(u => u.topics && u.topics.includes(topic));
  if (unitIndex >= 0) {
    const pillEls = document.querySelectorAll('#topic-pills .topic-pill');
    const pillEl = pillEls[unitIndex];
    if (pillEl) {
      selectUnit(units[unitIndex].unit, unitIndex, pillEl);
      setTimeout(() => {
        const topicCards = document.querySelectorAll('.topic-card');
        const matched = Array.from(topicCards).find(c => c.textContent.trim().startsWith(topic));
        if (matched) selectTopic(topic, matched);
      }, 30);
    }
  }
}

function toggleTopicSelect() {
  const select = document.getElementById('lesson-topic-select');
  const btn    = document.getElementById('toggle-topics-btn');
  const collapsed = select.classList.toggle('topic-select-collapsed');
  btn.textContent = collapsed ? 'Смени урока' : 'Скрий раздели';
}

function selectTopic(topic, el) {
  currentTopic = topic;
  if (el) {
    document.querySelectorAll('.topic-card').forEach(p => p.classList.remove('active'));
    el.classList.add('active');
  }
  
  clearTimeout(lessonLoadTimer);
  lessonLoadTimer = setTimeout(() => loadLessonContent(topic), 600);
}

async function loadLessonContent(topic) {
  const contentEl = document.getElementById('lesson-content');
  const progress  = document.getElementById('lesson-progress');

  contentEl.innerHTML = '<div class="loading-dots"><span></span><span></span><span></span></div>';
  progress.style.width = '0%';
  document.getElementById('take-test-wrap')?.setAttribute('hidden', '');

  const grade = currentGrade ? gradeLabels[currentGrade] : 'общообразователно ниво';
  currentGradeLabel = grade;
  const subj  = subjects.find(s => s.id === currentSubject);

  const prompt = `Създай ясен и увлекателен урок на БЪЛГАРСКИ ЕЗИК за темата "${topic}" в предмет ${subj?.name} за ученик от ${grade}.

Форматирай отговора като HTML използвайки само тези елементи (без html/body тагове):
- <h2> за заглавието
- <p> за параграфи
- <h3> за подтеми
- <ul><li> за списъци
- <div class="highlight-box"> за ключови понятия
- <div class="info-box"> за интересни факти

Изисквания: подходящо за класа, ясно с реални примери, около 350 думи, завърши с "Основен извод" в highlight-box. Върни САМО HTML, без обяснения.`;

  try {
    progress.style.width = '40%';
    const response = await fetch('/generate-lesson', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic: topic,
        subject: subj?.name,
        grade: grade
      })
    });
    if (!response.ok) throw new Error('API error');
    const data = await response.json();
    const html = data.html;
    progress.style.width = '100%';

    if (!html) throw new Error('empty');

    const clean = sanitizeHtml(html.replace(/```html|```/g, '').trim());
    currentLessonContent = clean;
    contentEl.innerHTML  = clean;
    renderRichContent(contentEl);
    document.getElementById('take-test-wrap')?.removeAttribute('hidden');

    const toggleBtn = document.getElementById('toggle-topics-btn');
    if (window.matchMedia('(max-width: 900px)').matches) {
      document.getElementById('lesson-topic-select')?.classList.add('topic-select-collapsed');
      toggleBtn?.removeAttribute('hidden');
      if (toggleBtn) toggleBtn.textContent = 'Смени урока';
      window.scrollTo(0, 0);
    }

    setTimeout(() => { progress.style.width = '0%'; }, 900);
  } catch (err) {
    progress.style.width = '0%';
    contentEl.innerHTML = `
      <div class="highlight-box">
        <h2>${topic}</h2>
        <p>Грешка при зареждане. Провери дали FastAPI сървърът работи.</p>
      </div>`;
  }
}

function saveLesson() {
  if (!currentTopic) {
    showToast('Няма урок за запазване!', true);
    return;
  }

  const subj  = subjects.find(s => s.id === currentSubject);
  const grade = currentGrade ? gradeLabels[currentGrade] : 'Общо';

  const lesson = {
    id: Date.now(),
    unit: currentUnit,
    topic: currentTopic,
    subject: subj?.name || '',
    subjectId: currentSubject,
    grade,
    content: currentLessonContent,
    savedAt: new Date().toLocaleDateString('bg-BG', { day: 'numeric', month: 'long', year: 'numeric' }),
  };

  savedLessons = savedLessons.filter(l => !(l.topic === lesson.topic && l.grade === lesson.grade && l.unit === lesson.unit));
  savedLessons.unshift(lesson);
  localStorage.setItem('luminary_saved', JSON.stringify(savedLessons));
  showToast(`"${currentTopic}" е запазен!`);
}

function renderSaved() {
  const container = document.getElementById('saved-container');

  if (!savedLessons.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">С</div>
        <h3>Все още няма запазени уроци</h3>
        <p>Когато запазиш урок, той ще се появи тук.</p>
      </div>`;
    return;
  }

  container.innerHTML = '<div class="saved-grid">' +
    savedLessons.map(l => `
      <div class="saved-card" onclick="loadSavedLesson(${l.id})">
        <div class="saved-card-meta">
          <span class="badge">${l.subject}</span>
          <span class="badge">${l.grade}</span>
          <span style="margin-left:auto">${l.savedAt}</span>
        </div>
        <div class="saved-card-title">${l.topic}</div>
        <div class="saved-card-preview">${l.content.replace(/<[^>]+>/g, '').substring(0, 130)}…</div>
      </div>
    `).join('') + '</div>';
}

function loadSavedLesson(id) {
  const lesson = savedLessons.find(l => l.id === id);
  if (!lesson) return;

  currentSubject       = lesson.subjectId;
  currentUnit          = lesson.unit;
  currentTopic         = lesson.topic;
  currentLessonContent = lesson.content;
  currentGradeLabel    = lesson.grade;

  navigate('lesson');
  document.getElementById('lesson-breadcrumb').textContent = `${lesson.subject} · ${lesson.grade}`;
  document.getElementById('lesson-title').textContent      = lesson.unit;

  document.getElementById('step-unit')?.classList.add('active');
  document.getElementById('step-topic')?.classList.add('active');

  const gradeKey = lesson.grade;
  let units = [];
  const names = getDataSubjectNames(lesson.subjectId);
  for (const name of names) {
    const dataSubj = topicsBySubject[name];
    if (dataSubj && dataSubj[gradeKey]) {
      units = dataSubj[gradeKey];
      break;
    }
  }
  
  const pills  = document.getElementById('topic-pills');
  pills.innerHTML = units.map((u, idx) => `
    <div class="topic-pill ${u.unit === lesson.unit ? 'active' : ''}" onclick="selectUnit('${u.unit}', ${idx}, this)">
      <span class="pill-label">${u.unit}</span>
      <span class="pill-count">${(u.topics?.length || 0)} теми</span>
    </div>
  `).join('');

  const currentUnitData = units.find(u => u.unit === lesson.unit);
  if (currentUnitData && currentUnitData.topics) {
    const topicsHtml = `
      <h3>Теми в раздела:</h3>
      <div class="topic-grid">
        ${currentUnitData.topics.map(t => `
          <div class="topic-card ${t === lesson.topic ? 'active' : ''}" onclick="selectTopic('${t.replace(/'/g, "\\'")}', this)">
            <div class="topic-card-title">${t}</div>
            <div class="topic-card-meta">Кликни, за да започнеш урока</div>
          </div>
        `).join('')}
      </div>
    `;
    document.getElementById('lesson-content').innerHTML = topicsHtml + '<br>' + lesson.content;
  } else {
    document.getElementById('lesson-content').innerHTML  = lesson.content;
  }
  renderRichContent(document.getElementById('lesson-content'));
  document.getElementById('take-test-wrap')?.removeAttribute('hidden');

  document.getElementById('lesson-progress').style.width = '0%';
  document.getElementById('ai-chat').innerHTML = `
    <div class="chat-msg ai">
      Добре дошъл обратно! Преглеждаш урока за <strong>${lesson.topic}</strong>. Попитай ме каквото искаш!
    </div>`;
}

async function sendAIMessage() {
  const input = document.getElementById('ai-input');
  const msg   = input.value.trim();
  if (!msg) return;
  input.value = '';
  input.style.height = 'auto';
  if (window.matchMedia('(pointer: coarse)').matches) input.blur();
  sendAIChat(msg);
}

function sendPromptChip(el) {
  const text  = el.textContent.trim();
  const grade = currentGrade ? gradeLabels[currentGrade] : 'общо ниво';
  const map   = {
    'Обясни по-просто': `Обясни "${currentTopic}" по най-простия начин за ученик от ${grade}.`,
    'Дай ми пример':   `Дай ми реален пример от живота за "${currentTopic}".`,
    'Изпитай ме':      `Изпитай ме по "${currentTopic}" с един въпрос.`,
    'Защо е важно?':   `Защо е важна темата "${currentTopic}" в реалния живот?`,
  };
  sendAIChat(map[text] || text);
}

async function sendAIChat(userMsg) {
  const chat = document.getElementById('ai-chat');
  const btn  = document.getElementById('ai-send-btn');
  btn.disabled = true;

  const userEl = document.createElement('div');
  userEl.className   = 'chat-msg user';
  userEl.textContent = userMsg;
  chat.appendChild(userEl);

  const loadingEl = document.createElement('div');
  loadingEl.className = 'chat-msg ai';
  loadingEl.innerHTML = '<div class="loading-dots" style="padding:4px 0;justify-content:flex-start"><span></span><span></span><span></span></div>';
  chat.appendChild(loadingEl);
  chat.scrollTop = chat.scrollHeight;

  const grade      = currentGrade ? gradeLabels[currentGrade] : 'общообразователно ниво';
  const subj       = subjects.find(s => s.id === currentSubject);
  const lessonText = currentLessonContent.replace(/<[^>]+>/g, '').substring(0, 500);

  const prompt = `Ти си учител, който помага на ученик от ${grade} да разбере "${currentTopic}" в предмет ${subj?.name}.

Контекст от урока: ${lessonText}

Въпрос: ${userMsg}

Отговори на БЪЛГАРСКИ с прост и топъл тон. Максимум 3-4 изречения. Без markdown форматиране. Завърши с насърчение или следващ въпрос.`;

  try {
    const response = await fetch('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: userMsg,
        topic: currentTopic,
        subject: subj?.name,
        grade: grade,
        lesson_text: lessonText
      })
    });
    if (!response.ok) throw new Error('API error');
    const data = await response.json();
    const reply = data.reply;
    loadingEl.innerHTML = sanitizeHtml(reply || 'Неуспешен отговор. Опитай пак.');
    renderRichContent(loadingEl);
  } catch (err) {
    loadingEl.textContent = 'Грешка при свързване. Провери дали FastAPI сървърът работи.';
  }

  btn.disabled = false;
  chat.scrollTop = chat.scrollHeight;
}

function showToast(msg, isError = false) {
  const t = document.getElementById('toast');
  document.getElementById('toast-msg').textContent = msg;
  t.style.borderColor = isError ? 'var(--danger)' : 'var(--success)';
  t.style.color       = isError ? 'var(--danger)' : 'var(--success)';
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

/* ================= END-OF-LESSON ASSESSMENT ================= */

async function startAssessment() {
  if (!currentLessonContent) {
    showToast('Няма зареден урок за тест!', true);
    return;
  }
  const subj = subjects.find(s => s.id === currentSubject);
  const btn  = document.getElementById('take-test-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Подготвяне на теста…'; }

  const plainLesson = currentLessonContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  try {
    const response = await fetch('/generate-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lesson_text: plainLesson,
        topic: currentTopic || currentUnit,
        subject: subj?.name,
        grade: currentGradeLabel,
        num_questions: 8
      })
    });
    if (!response.ok) throw new Error('API error');
    const data = await response.json();
    if (!data.questions || !data.questions.length) throw new Error('empty');

    currentAssessment = data;
    testAnswers = {};
    testCurrentIndex = 0;
    testResults = null;
    testReadOnlyMode = false;

    navigate('test');
    renderTestQuestion();
  } catch (err) {
    showToast('Неуспешно генериране на тест. Опитай пак.', true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Вземи тест'; }
  }
}

function testOptionsFor(question) {
  if (question.type === 'multiple_choice' || question.type === 'true_false') {
    return question.options && question.options.length ? question.options : (question.type === 'true_false' ? ['Вярно', 'Невярно'] : []);
  }
  return null;
}

function renderTestQuestion() {
  const panel = document.getElementById('test-panel');
  const total = currentAssessment.questions.length;
  const q = currentAssessment.questions[testCurrentIndex];
  const savedAnswer = testAnswers[q.id];
  const options = testOptionsFor(q);
  const progressPct = Math.round(((testCurrentIndex) / total) * 100);

  let controlsHtml = '';
  if (options) {
    controlsHtml = `<div class="test-options">` + options.map((opt, idx) => `
      <button type="button" class="test-option ${savedAnswer === opt ? 'selected' : ''}" onclick="selectTestOption(${idx})">${escapeXml(opt)}</button>
    `).join('') + `</div>`;
  } else {
    const hint = (q.type === 'numeric' || q.type === 'expression')
      ? 'Ако има повече от една стойност, раздели ги със запетая (напр. 2, 3).'
      : 'Напиши кратък отговор.';
    controlsHtml = `
      <input type="text" class="test-input" id="test-free-input" placeholder="Твоят отговор..." value="${savedAnswer ? escapeXml(savedAnswer) : ''}" oninput="testAnswers[${q.id}] = this.value">
      <div class="test-input-hint">${hint}</div>
    `;
  }

  const isLast = testCurrentIndex === total - 1;

  panel.innerHTML = `
    <div class="test-progress">Въпрос ${testCurrentIndex + 1} от ${total}</div>
    <div class="test-progress-bar-wrap"><div class="test-progress-bar" style="width:${progressPct}%"></div></div>
    <div class="test-topic-tag">${escapeXml(q.topic)}</div>
    <div class="test-question-text">${escapeXml(q.question)}</div>
    ${controlsHtml}
    <div class="test-nav">
      <button class="btn btn-ghost btn-sm" onclick="testPrev()" ${testCurrentIndex === 0 ? 'disabled style="opacity:.35;cursor:not-allowed"' : ''}>Назад</button>
      <button class="btn btn-primary btn-sm" onclick="${isLast ? 'finishTest()' : 'testNext()'}">${isLast ? 'Завърши теста' : 'Напред'}</button>
    </div>
  `;
  renderRichContent(panel);
}

function selectTestOption(optionIndex) {
  const q = currentAssessment.questions[testCurrentIndex];
  const options = testOptionsFor(q);
  testAnswers[q.id] = options[optionIndex];
  renderTestQuestion();
}

function testNext() {
  if (testCurrentIndex < currentAssessment.questions.length - 1) {
    testCurrentIndex++;
    renderTestQuestion();
  }
}

function testPrev() {
  if (testCurrentIndex > 0) {
    testCurrentIndex--;
    renderTestQuestion();
  }
}

async function finishTest() {
  const panel = document.getElementById('test-panel');
  panel.innerHTML = '<div class="loading-dots"><span></span><span></span><span></span></div>';

  try {
    const response = await fetch('/evaluate-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questions: currentAssessment.questions, answers: testAnswers })
    });
    if (!response.ok) throw new Error('API error');
    testResults = await response.json();

    const subj = subjects.find(s => s.id === currentSubject);
    testHistory.unshift({
      id: Date.now(),
      topic: currentTopic || currentUnit,
      subject: subj?.name || '',
      grade: currentGradeLabel,
      savedAt: new Date().toLocaleDateString('bg-BG', { day: 'numeric', month: 'long', year: 'numeric' }),
      assessment: currentAssessment,
      answers: testAnswers,
      results: testResults
    });
    testHistory = testHistory.slice(0, 30);
    localStorage.setItem('luminary_test_history', JSON.stringify(testHistory));

    renderTestResults();
  } catch (err) {
    panel.innerHTML = `<div class="highlight-box"><p>Грешка при оценяване на теста. Опитай пак.</p></div>`;
  }
}

function scoreMessage(pct) {
  if (pct >= 85) return 'Отлична работа! Разбираш материала много добре.';
  if (pct >= 60) return 'Добра работа! Има някои области за допълнителна практика.';
  return 'Продължавай да тренираш — прегледай обясненията по-долу за темите, в които сгреши.';
}

function renderTestResults() {
  const panel = document.getElementById('test-panel');
  const r = testResults;

  const breakdownHtml = Object.entries(r.byTopic).map(([topic, stats]) => {
    const good = stats.percentage >= 60;
    return `
      <div class="skill-row">
        <div class="skill-row-icon">${good ? '✅' : '❌'}</div>
        <div class="skill-row-body">
          <div class="skill-row-top">
            <span class="skill-row-name">${escapeXml(topic)}</span>
            <span class="skill-row-fraction">${stats.correct}/${stats.total} · ${stats.percentage}%</span>
          </div>
          <div class="skill-bar-track"><div class="skill-bar-fill ${good ? 'good' : 'weak'}" style="width:${stats.percentage}%"></div></div>
        </div>
      </div>
    `;
  }).join('');

  const reviewHtml = r.results.map(res => {
    const userAnswerText = (res.userAnswer === undefined || res.userAnswer === null || res.userAnswer === '')
      ? '(без отговор)'
      : (Array.isArray(res.userAnswer) ? res.userAnswer.join(', ') : String(res.userAnswer));
    const correctAnswerText = Array.isArray(res.correctAnswer) ? res.correctAnswer.join(', ') : String(res.correctAnswer);
    return `
      <div class="review-item ${res.isCorrect ? 'correct' : 'incorrect'}">
        <div class="review-badge ${res.isCorrect ? 'correct' : 'incorrect'}">${res.isCorrect ? '✅ Правилно' : '❌ Грешно'}</div>
        <div class="review-question">${escapeXml(res.question)}</div>
        <div class="review-row">
          <span class="review-row-label">Твоят отговор</span>
          <span class="${res.isCorrect ? '' : 'review-answer-wrong'}">${escapeXml(userAnswerText)}</span>
        </div>
        ${res.isCorrect ? '' : `
        <div class="review-row">
          <span class="review-row-label">Верен отговор</span>
          <span class="review-answer-right">${escapeXml(correctAnswerText)}</span>
        </div>`}
        <div class="review-explanation">${escapeXml(res.explanation)}</div>
      </div>
    `;
  }).join('');

  panel.innerHTML = `
    <div class="test-score-hero">
      <div class="test-score-number">${r.score} / ${r.total}</div>
      <div class="test-score-percentage">${r.percentage}%</div>
      <div class="test-score-message">${scoreMessage(r.percentage)}</div>
    </div>

    <h2 class="section-title">Резултати по теми</h2>
    <div class="skill-breakdown">${breakdownHtml}</div>

    <h2 class="section-title">Преглед на въпросите</h2>
    <div class="review-section">${reviewHtml}</div>

    <div style="display:flex;justify-content:center;margin-top:32px">
      <button class="btn btn-ghost" onclick="${testReadOnlyMode ? "navigate('saved')" : "navigate('lesson')"}">${testReadOnlyMode ? 'Назад към историята' : 'Назад към урока'}</button>
    </div>
  `;
  renderRichContent(panel);
}

function viewSavedTestResult(id) {
  const entry = testHistory.find(h => h.id === id);
  if (!entry) return;
  currentAssessment = entry.assessment;
  testAnswers = entry.answers;
  testResults = entry.results;
  testReadOnlyMode = true;
  navigate('test');
  renderTestResults();
}

function renderTestHistory() {
  const container = document.getElementById('test-history-container');
  if (!container) return;
  if (!testHistory.length) {
    container.innerHTML = `<div class="empty-state"><p>Все още няма завършени тестове.</p></div>`;
    return;
  }
  container.innerHTML = testHistory.map(h => `
    <div class="test-history-card" onclick="viewSavedTestResult(${h.id})">
      <div>
        <div class="saved-card-meta">
          <span class="badge">${escapeXml(h.subject)}</span>
          <span class="badge">${escapeXml(h.grade)}</span>
          <span style="margin-left:auto">${escapeXml(h.savedAt)}</span>
        </div>
        <div class="saved-card-title">${escapeXml(h.topic)}</div>
      </div>
      <div class="test-history-score">${h.results.score}/${h.results.total} · ${h.results.percentage}%</div>
    </div>
  `).join('');
}

renderHome();
navigate('home');

/* Keep the chat input above the on-screen keyboard on mobile */
(function () {
  const aiInputEl = document.getElementById('ai-input');
  if (!aiInputEl) return;
  const keepVisible = () => {
    if (document.activeElement === aiInputEl) {
      aiInputEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  };
  aiInputEl.addEventListener('focus', () => setTimeout(keepVisible, 300));
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', keepVisible);
  }
})();