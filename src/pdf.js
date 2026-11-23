/* ============ PDF text extraction (text-based PDFs only) ============ */
async function pdfInflate(bytes){
  const tryMode = async (mode, b) => { const ds = new DecompressionStream(mode); const w = ds.writable.getWriter(); w.write(b).catch(() => {}); w.close().catch(() => {}); return new Uint8Array(await new Response(ds.readable).arrayBuffer()); };
  try { return await tryMode('deflate', bytes); } catch (e) {}
  try { return await tryMode('deflate-raw', bytes.subarray(2)); } catch (e) {}
  return null;
}
function pdfLatin1(u8){ let s = ''; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return s; }
class PdfLex {
  constructor(s, p = 0){ this.s = s; this.p = p; }
  ws(){ const s = this.s; for (;;){ const c = s.charCodeAt(this.p); if (c === 32 || c === 10 || c === 13 || c === 9 || c === 12 || c === 0) this.p++; else if (c === 37){ while (this.p < s.length && s[this.p] !== '\n' && s[this.p] !== '\r') this.p++; } else break; } }
  next(){
    this.ws(); const s = this.s; if (this.p >= s.length) return null; const c = s[this.p];
    if (c === '/'){ let q = ++this.p; while (q < s.length && !/[\s\/\[\]<>()%]/.test(s[q])) q++; const n = s.slice(this.p, q).replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))); this.p = q; return { t: 'name', v: n }; }
    if (c === '('){ let d = 1, q = this.p + 1, out = ''; while (q < s.length && d > 0){ const ch = s[q];
        if (ch === '\\'){ const n = s[q + 1]; q += 2; if (n === 'n') out += '\n'; else if (n === 'r') out += '\r'; else if (n === 't') out += '\t'; else if (n === 'b') out += '\b'; else if (n === 'f') out += '\f'; else if (/[0-7]/.test(n)){ let o = n; while (o.length < 3 && /[0-7]/.test(s[q])) o += s[q++]; out += String.fromCharCode(parseInt(o, 8) & 255); } else if (n === '\r'){ if (s[q] === '\n') q++; } else if (n === '\n'){} else out += n; continue; }
        if (ch === '(') d++; else if (ch === ')'){ d--; if (!d){ q++; break; } }
        out += ch; q++; }
      this.p = q; return { t: 'str', v: out }; }
    if (c === '<'){ if (s[this.p + 1] === '<'){ this.p += 2; return { t: '<<' }; } const e = s.indexOf('>', this.p); let h = s.slice(this.p + 1, e).replace(/\s+/g, ''); if (h.length % 2) h += '0'; let out = ''; for (let i = 0; i < h.length; i += 2) out += String.fromCharCode(parseInt(h.substr(i, 2), 16)); this.p = e + 1; return { t: 'str', v: out, hex: true }; }
    if (c === '>'){ if (s[this.p + 1] === '>'){ this.p += 2; return { t: '>>' }; } this.p++; return { t: '>' }; }
    if (c === '[' || c === ']' || c === '{' || c === '}'){ this.p++; return { t: c }; }
    let q = this.p; while (q < s.length && !/[\s\/\[\]<>()%{}]/.test(s[q])) q++;
    const w = s.slice(this.p, q); this.p = q;
    if (/^[-+]?(\d+\.?\d*|\.\d+)$/.test(w)) return { t: 'num', v: parseFloat(w) };
    return { t: 'op', v: w };
  }
}
function pdfParseValue(lx, tok){
  tok = tok || lx.next(); if (!tok) return null;
  if (tok.t === 'num'){
    const save = lx.p; const t2 = lx.next();
    if (t2 && t2.t === 'num' && Number.isInteger(tok.v) && Number.isInteger(t2.v)){ const t3 = lx.next(); if (t3 && t3.t === 'op' && t3.v === 'R') return { ref: tok.v }; }
    lx.p = save; return tok.v;
  }
  if (tok.t === 'name') return { name: tok.v };
  if (tok.t === 'str') return tok.v;
  if (tok.t === '[') { const a = []; for (;;){ const t = lx.next(); if (!t || t.t === ']') break; a.push(pdfParseValue(lx, t)); } return a; }
  if (tok.t === '<<'){ const d = {}; for (;;){ const k = lx.next(); if (!k || k.t === '>>') break; if (k.t !== 'name') continue; d[k.v] = pdfParseValue(lx); } return d; }
  if (tok.t === 'op'){ if (tok.v === 'true') return true; if (tok.v === 'false') return false; return null; }
  return null;
}
async function pdfToGrid(buf){
  const u8 = new Uint8Array(buf), txt = pdfLatin1(u8);
  if (txt.slice(0, 5) !== '%PDF-') throw new Error('not a PDF file');
  const objs = {};
  const re = /(\d+)\s+(\d+)\s+obj\b/g; let m;
  const addObj = (n, val, stream) => { objs[n] = { val, stream }; };
  while ((m = re.exec(txt))){
    const start = re.lastIndex, lx = new PdfLex(txt, start); let val;
    try { val = pdfParseValue(lx); } catch (e) { continue; }
    let stream = null;
    lx.ws();
    if (val && typeof val === 'object' && !Array.isArray(val) && txt.startsWith('stream', lx.p)){
      let sp = lx.p + 6; if (txt[sp] === '\r') sp++; if (txt[sp] === '\n') sp++;
      let end = txt.indexOf('endstream', sp); if (end < 0) end = txt.length;
      let e2 = end; if (txt[e2 - 1] === '\n') e2--; if (txt[e2 - 1] === '\r') e2--;
      stream = u8.subarray(sp, e2); re.lastIndex = end;
    }
    addObj(+m[1], val, stream);
  }
  const R = v => { let n = 0; while (v && typeof v === 'object' && v.ref !== undefined && n++ < 20) v = objs[v.ref] ? objs[v.ref].val : null; return v; };
  const nm = v => (v && v.name) || '';
  async function streamData(o){
    if (!o || !o.stream) return null;
    const d = o.val || {}; let f = R(d.Filter); const fl = Array.isArray(f) ? f.map(x => nm(R(x))) : f ? [nm(f)] : [];
    let b = o.stream;
    for (const x of fl){ if (x === 'FlateDecode' || x === 'Fl'){ b = await pdfInflate(b); if (!b) return null; } else if (x === 'ASCIIHexDecode'){ b = Uint8Array.from(pdfLatin1(b).replace(/[^0-9a-fA-F]/g, '').match(/../g) || [], h => parseInt(h, 16)); } else return null; }
    return b;
  }
  // object streams
  for (const n of Object.keys(objs)){
    const o = objs[n], d = o.val;
    if (d && d.Type && nm(d.Type) === 'ObjStm' && o.stream){
      const b = await streamData(o); if (!b) continue; const s = pdfLatin1(b), N = R(d.N), F = R(d.First);
      const lx = new PdfLex(s, 0), pairs = []; for (let i = 0; i < N; i++){ const a = lx.next(), c = lx.next(); if (!a || !c) break; pairs.push([a.v, c.v]); }
      pairs.forEach(([num, off]) => { try { const l2 = new PdfLex(s, F + off); if (!objs[num]) addObj(num, pdfParseValue(l2), null); } catch (e) {} });
    }
  }
  // pages in order
  let pages = [];
  const cat = Object.values(objs).find(o => o.val && o.val.Type && nm(o.val.Type) === 'Catalog');
  const walk = (node, inh, depth) => {
    node = R(node); if (!node || depth > 30) return;
    const res = node.Resources !== undefined ? node.Resources : inh;
    if (node.Kids){ R(node.Kids).forEach(k => walk(k, res, depth + 1)); }
    else pages.push({ node, res });
  };
  if (cat && cat.val.Pages) walk(cat.val.Pages, null, 0);
  if (!pages.length) Object.keys(objs).map(Number).sort((a, b) => a - b).forEach(n => { const d = objs[n].val; if (d && d.Type && nm(d.Type) === 'Page') pages.push({ node: d, res: d.Resources }); });
  const fontCache = new Map();
  async function loadFont(ref){
    const key = ref && ref.ref !== undefined ? ref.ref : null; if (key !== null && fontCache.has(key)) return fontCache.get(key);
    const fd = R(ref) || {}; const sub = nm(R(fd.Subtype)); const f = { composite: sub === 'Type0', map: null, w: {}, dw: 1000, first: 0, widths: null, mw: 600 };
    if (fd.ToUnicode){ const b = await streamData(objs[fd.ToUnicode.ref]); if (b){ const s = pdfLatin1(b); f.map = {};
        const u16 = h => { let o = ''; for (let i = 0; i < h.length; i += 4) o += String.fromCharCode(parseInt(h.substr(i, 4), 16)); return o; };
        let mm; const rb = /beginbfchar([\s\S]*?)endbfchar/g;
        while ((mm = rb.exec(s))){ const pr = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g; let q; while ((q = pr.exec(mm[1]))) f.map[parseInt(q[1], 16)] = u16(q[2].length < 4 ? q[2].padStart(4, '0') : q[2]); }
        const rr = /beginbfrange([\s\S]*?)endbfrange/g;
        while ((mm = rr.exec(s))){ const pr = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<([0-9a-fA-F]+)>|\[([^\]]*)\])/g; let q;
          while ((q = pr.exec(mm[1]))){ const lo = parseInt(q[1], 16), hi = parseInt(q[2], 16);
            if (q[4]){ const base = u16(q[4].length < 4 ? q[4].padStart(4, '0') : q[4]); for (let c = lo; c <= hi && c - lo < 65536; c++) f.map[c] = base.slice(0, -1) + String.fromCharCode(base.charCodeAt(base.length - 1) + c - lo); }
            else { const arr = (q[5].match(/<([0-9a-fA-F]+)>/g) || []); arr.forEach((h, n) => { f.map[lo + n] = u16(h.slice(1, -1).padStart(4, '0')); }); } } }
      } }
    if (f.composite){
      const df = R(R(fd.DescendantFonts) && R(fd.DescendantFonts)[0]) || {}; if (df.DW !== undefined) f.dw = R(df.DW);
      const W = R(df.W); if (Array.isArray(W)){ for (let i = 0; i < W.length;){ const c = R(W[i]), nx = R(W[i + 1]); if (Array.isArray(nx)){ nx.forEach((w, k) => { f.w[c + k] = R(w); }); i += 2; } else { const w = R(W[i + 2]); for (let k = c; k <= nx && k - c < 70000; k++) f.w[k] = w; i += 3; } } }
    } else {
      const W = R(fd.Widths); f.first = R(fd.FirstChar) || 0; if (Array.isArray(W)) f.widths = W.map(R);
      const enc = R(fd.Encoding); f.diff = {};
      if (enc && enc.Differences){ let c = 0; R(enc.Differences).forEach(x => { x = R(x); if (typeof x === 'number') c = x; else if (x && x.name){ const g = x.name; let u = null; const GN = { space: ' ', period: '.', comma: ',', hyphen: '-', minus: '-', slash: '/', colon: ':', parenleft: '(', parenright: ')', underscore: '_', percent: '%', plus: '+', zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ampersand: '&', at: '@', numbersign: '#', quotesingle: "'", quotedbl: '"' };
            if (GN[g] !== undefined) u = GN[g]; else if (g.length === 1) u = g; else if (/^uni[0-9A-F]{4}$/.test(g)) u = String.fromCharCode(parseInt(g.slice(3), 16)); if (u !== null) f.diff[c] = u; c++; } }); }
    }
    if (key !== null) fontCache.set(key, f); return f;
  }
  const mul = (a, b) => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];
  const items = []; let pageNo = 0;
  for (const pg of pages){
    pageNo++;
    const res = R(pg.res) || {}, fonts = R(res.Font) || {};
    let cont = R(pg.node.Contents); if (!Array.isArray(cont)) cont = [pg.node.Contents]; 
    let content = '';
    for (const c of cont){ const o = c && c.ref !== undefined ? objs[c.ref] : null; const b = await streamData(o); if (b) content += pdfLatin1(b) + '\n'; }
    const lx = new PdfLex(content, 0); let ctm = [1, 0, 0, 1, 0, 0]; const stack = [];
    let Tm = [1, 0, 0, 1, 0, 0], Tlm = Tm, font = null, fs = 10, lead = 0, tc = 0, tw = 0, th = 1, rise = 0; const ops = [];
    const fcache = {};
    const getFont = async nme => { if (!(nme in fcache)) fcache[nme] = fonts[nme] ? await loadFont(fonts[nme]) : null; return fcache[nme]; };
    const showStr = (s, run) => {
      const f = font || { composite: false, widths: null, mw: 600 }; const step = f.composite ? 2 : 1;
      for (let i = 0; i < s.length; i += step){
        const code = step === 2 ? (s.charCodeAt(i) << 8) | s.charCodeAt(i + 1) : s.charCodeAt(i);
        let ch = f.map && f.map[code] !== undefined ? f.map[code] : (f.diff && f.diff[code] !== undefined ? f.diff[code] : (f.composite ? '' : String.fromCharCode(code)));
        let w = f.composite ? (f.w[code] !== undefined ? f.w[code] : f.dw) : (f.widths && code - f.first >= 0 && f.widths[code - f.first] != null ? f.widths[code - f.first] : (code === 32 ? 278 : f.mw));
        run.text += ch;
        const tx = (w / 1000 * fs + tc + (code === 32 && step === 1 ? tw : 0)) * th; Tm = mul([1, 0, 0, 1, tx, 0], Tm);
      }
    };
    const begin = () => { const M = mul(Tm, ctm); return { text: '', x: M[4], y: M[5] + rise * M[3], fsz: Math.abs(fs * Math.hypot(M[2], M[3])) || fs }; };
    const end = run => { const M = mul(Tm, ctm); run.x2 = M[4]; if (run.text.trim()) items.push({ page: pageNo, x: run.x, y: run.y, x2: Math.max(run.x2, run.x), text: run.text, fs: run.fsz }); };
    for (;;){
      const t = lx.next(); if (!t) break;
      if (t.t !== 'op'){ ops.push(t.t === '[' || t.t === '<<' ? pdfParseValue(lx, t) : t.t === 'num' ? t.v : t.t === 'name' ? { name: t.v } : t.v); continue; }
      const op = t.v, a = ops;
      switch (op){
        case 'q': stack.push(ctm.slice()); break;
        case 'Q': if (stack.length) ctm = stack.pop(); break;
        case 'cm': if (a.length >= 6) ctm = mul(a.slice(-6), ctm); break;
        case 'BT': Tm = Tlm = [1, 0, 0, 1, 0, 0]; break;
        case 'Tf': font = await getFont(a[a.length - 2] && a[a.length - 2].name); fs = a[a.length - 1]; break;
        case 'Td': Tlm = mul([1, 0, 0, 1, a[a.length - 2], a[a.length - 1]], Tlm); Tm = Tlm; break;
        case 'TD': lead = -a[a.length - 1]; Tlm = mul([1, 0, 0, 1, a[a.length - 2], a[a.length - 1]], Tlm); Tm = Tlm; break;
        case 'Tm': if (a.length >= 6){ Tm = Tlm = a.slice(-6); } break;
        case 'T*': Tlm = mul([1, 0, 0, 1, 0, -lead], Tlm); Tm = Tlm; break;
        case 'TL': lead = a[a.length - 1]; break;
        case 'Tc': tc = a[a.length - 1]; break;
        case 'Tw': tw = a[a.length - 1]; break;
        case 'Tz': th = a[a.length - 1] / 100; break;
        case 'Ts': rise = a[a.length - 1]; break;
        case 'Tj': { const r = begin(); showStr(String(a[a.length - 1] || ''), r); end(r); break; }
        case "'": Tlm = mul([1, 0, 0, 1, 0, -lead], Tlm); Tm = Tlm; { const r = begin(); showStr(String(a[a.length - 1] || ''), r); end(r); } break;
        case '"': Tlm = mul([1, 0, 0, 1, 0, -lead], Tlm); Tm = Tlm; { const r = begin(); showStr(String(a[a.length - 1] || ''), r); end(r); } break;
        case 'TJ': { const arr = a[a.length - 1]; if (Array.isArray(arr)){ let r = begin();
            for (const x of arr){ if (typeof x === 'string') showStr(x, r); else if (typeof x === 'number'){ const adv = -x / 1000 * fs * th; if (x < -180) r.text += ' '; Tm = mul([1, 0, 0, 1, adv, 0], Tm); } }
            end(r); } break; }
        case 'BI': { const e = content.indexOf('\nEI', lx.p); lx.p = e < 0 ? content.length : e + 3; break; }
        default: break;
      }
      ops.length = 0;
    }
  }
  if (!items.length) throw new Error('no readable text found – this PDF may be a scanned image (needs OCR) or use an unsupported encoding');
  // ---- layout: lines -> cells -> columns
  const rowsOut = [], cells = [];
  const byPage = {}; items.forEach(it => (byPage[it.page] = byPage[it.page] || []).push(it));
  Object.keys(byPage).map(Number).sort((a, b) => a - b).forEach(pn => {
    const its = byPage[pn].sort((a, b) => b.y - a.y || a.x - b.x); let line = [], ly = null;
    const flush = () => {
      if (!line.length) return; line.sort((a, b) => a.x - b.x); const cs = [];
      for (const it of line){ const last = cs[cs.length - 1];
        if (last && it.x - last.x2 < Math.max(it.fs, last.fs) * 0.6){ const gap = it.x - last.x2; last.text += (gap > Math.max(it.fs, 1) * 0.12 && !/\s$/.test(last.text) ? ' ' : '') + it.text; last.x2 = Math.max(last.x2, it.x2); }
        else cs.push({ x: it.x, x2: it.x2, text: it.text, fs: it.fs }); }
      cs.forEach(c => { c.text = c.text.replace(/\s+/g, ' ').trim(); c.num = /^[-(+]?\s?\d[\d ,]*[.,]\d{2}\)?\s?(CR|DR|Cr|Dr|cr|dr)?\s?-?$/.test(c.text) || /^[-(]?\d{1,3}(,\d{3})+\)?$/.test(c.text); });
      rowsOut.push(cs.filter(c => c.text)); line = []; ly = null;
    };
    for (const it of its){ if (ly !== null && Math.abs(it.y - ly) > Math.max(2, it.fs * 0.4)) flush(); if (ly === null) ly = it.y; line.push(it); }
    flush();
  });
  rowsOut.forEach(r => r.forEach(c => cells.push(c)));
  const cluster = (vals, tol) => { const v = vals.slice().sort((a, b) => a - b), cl = []; v.forEach(x => { const l = cl[cl.length - 1]; if (l && x - l.max <= tol){ l.max = x; l.n++; l.sum += x; } else cl.push({ min: x, max: x, n: 1, sum: x }); }); return cl.map(c => c.sum / c.n); };
  const colsT = cluster(cells.filter(c => !c.num).map(c => c.x), 9), colsN = cluster(cells.filter(c => c.num).map(c => c.x2), 9);
  const cols = [...colsT.map(x => ({ k: 't', x })), ...colsN.map(x => ({ k: 'n', x }))].sort((a, b) => a.x - b.x);
  const nearest = (c) => { let best = -1, bd = 1e9; cols.forEach((col, n) => { if (col.k !== (c.num ? 'n' : 't')) return; const d = Math.abs(col.x - (c.num ? c.x2 : c.x)); if (d < bd){ bd = d; best = n; } }); return best; };
  return rowsOut.map(r => { const out = new Array(cols.length).fill(''); r.forEach(c => { const n = nearest(c); if (n < 0) return; out[n] = out[n] ? out[n] + ' ' + c.text : c.text; }); return out; }).filter(r => r.some(x => x));
}
