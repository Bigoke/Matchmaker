// <ENGINE>
'use strict';
/* ============ text helpers ============ */
const STOP = new Set(['die','the','van','en','and','of','at','op','vir','by','prepared','trial','balance']);
const LEGAL = new Set(['pty','ltd','cc','bk','bpk','trust','co','inc','edms','beperk','limited','proprietary','npc','vennote']);
function round2(x){ return Math.round((x + (x>=0?1:-1)*1e-9) * 100) / 100; }
function norm(s){
  s = String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  s = s.replace(/[’'`´]/g, '');
  s = s.replace(/\bt\s*\/\s*a\b/g, ' ');
  s = s.replace(/[&+@\/]/g, ' ');
  s = s.replace(/\b(19|20)\d{2}\b/g, ' ');
  return s.replace(/[^a-z0-9]+/g, ' ').trim();
}
function tokens(s){ return norm(s).split(' ').filter(t => t && !STOP.has(t)); }
function cleanName(title){
  let s = String(title || '');
  s = s.split('|')[0];
  s = s.replace(/prepared by.*$/i, '').replace(/trial balance.*$/i, '');
  s = s.replace(/\b(19|20)\d{2}\b/g, ' ').replace(/\s+/g, ' ').replace(/\s+[-–—]\s*$/, '').replace(/^\s*[-–—]\s+/, '').trim();
  s = s.replace(/\s+[-–—]\s+[-–—]\s+/g, ' - ').replace(/\s+/g, ' ').trim();
  return s;
}
const _osa = new Map();
function osa(a, b){
  if (a === b) return 0;
  const key = a < b ? a + '|' + b : b + '|' + a;
  const hit = _osa.get(key); if (hit !== undefined) return hit;
  const la = a.length, lb = b.length;
  let d = [];
  for (let i = 0; i <= la; i++){ d[i] = new Array(lb + 1); d[i][0] = i; }
  for (let j = 0; j <= lb; j++) d[0][j] = j;
  for (let i = 1; i <= la; i++) for (let j = 1; j <= lb; j++){
    const c = a[i-1] === b[j-1] ? 0 : 1;
    let v = Math.min(d[i-1][j] + 1, d[i][j-1] + 1, d[i-1][j-1] + c);
    if (i > 1 && j > 1 && a[i-1] === b[j-2] && a[i-2] === b[j-1]) v = Math.min(v, d[i-2][j-2] + 1);
    d[i][j] = v;
  }
  if (_osa.size > 200000) _osa.clear();
  _osa.set(key, d[la][lb]);
  return d[la][lb];
}
function simTok(a, b){
  if (a === b) return 1;
  if (/^\d+$/.test(a) || /^\d+$/.test(b)) return 0;
  const mn = Math.min(a.length, b.length), mx = Math.max(a.length, b.length);
  if (mn < 3) return 0;
  let s = 0;
  if (a.startsWith(b) || b.startsWith(a)) s = 0.7 + 0.3 * mn / mx;
  if (mn >= 3 && mx >= mn + 2){            // abbreviation: hldgs / holdings, prop / properties
    const sh = a.length < b.length ? a : b, lg = a.length < b.length ? b : a;
    if (sh[0] === lg[0]){ let p = 0; for (const ch of lg){ if (ch === sh[p]) p++; if (p === sh.length) break; } if (p === sh.length) s = Math.max(s, 0.78 + 0.1 * sh.length / lg.length); }
  }
  if (mn >= 4){
    let cp = 0; while (cp < mn && a[cp] === b[cp]) cp++;
    if (cp >= 5 && cp >= 0.75 * mn) s = Math.max(s, 0.55 + 0.45 * cp / mx);   // technology / technologies
    if (mx - mn > Math.max(3, mx * 0.4)) return s;
    s = Math.max(s, 1 - osa(a, b) / mx);
  }
  return s;
}
const _sh = [[0.65, 0], [0.75, 0.3], [0.875, 0.65], [0.92, 0.9], [1, 1]];
function sharpen(s){
  if (s >= 0.9999) return 1;
  if (s <= 0.65) return 0;
  for (let k = 1; k < _sh.length; k++) if (s <= _sh[k][0]){
    const [x0, y0] = _sh[k-1], [x1, y1] = _sh[k];
    return y0 + (y1 - y0) * (s - x0) / (x1 - x0);
  }
  return 1;
}

/* ============ aliases ============ */
function aliasTexts(c){
  const base = cleanName(c.name);
  const parts = base.split(/\s[-–—]\s?|\s?[-–—]\s|\bt\s*\/\s*a\b|[()]/i).map(s => s.trim()).filter(s => tokens(s).length);
  const out = new Set();
  if (parts.length) out.add(parts.join(' '));
  if (parts.length > 1){
    out.add(parts[0]);
    for (let k = 1; k < parts.length; k++){ out.add(parts[k]); if (parts.length > 2) out.add(parts[0] + ' ' + parts[k]); }
  }
  (c.aliases || []).forEach(a => { if (String(a).trim()) out.add(String(a).trim()); });
  return [...out];
}

/* ============ matcher ============ */
function buildMatcher(companies){
  const N = companies.length;
  const df = new Map();
  companies.forEach(c => {
    const set = new Set();
    [cleanName(c.name), ...(c.aliases || [])].forEach(t => tokens(t).forEach(x => set.add(x)));
    set.forEach(t => df.set(t, (df.get(t) || 0) + 1));
  });
  const idf = t => Math.max(0.3, Math.log((N + 1) / ((df.get(t) || 0) + 0.5)));
  const wt = t => idf(t) * (LEGAL.has(t) ? 0.25 : 1) * (t.length === 1 ? 0.4 : 1);
  // weight of a line word that no alias explains: unknown words are strong evidence of a different entity
  const nearLegal = t => t.length >= 3 && [...LEGAL].some(l => l.length >= 3 && Math.abs(l.length - t.length) <= 1 && osa(t, l) <= 1);
  const wLeft = t => !df.has(t) && nearLegal(t) ? 0.25 * idf(t) :  df.has(t) ? wt(t) * (!LEGAL.has(t) && df.get(t) >= 3 ? 0.55 : 1) : Math.max(wt(t), 3.2);
  const spansOf = (toks, w) => {
    const out = [];
    for (let i = 0; i < toks.length; i++){
      let str = '', ww = 0;
      for (let len = 1; len <= 6 && i + len <= toks.length; len++){
        str += toks[i + len - 1]; ww += w[i + len - 1];
        out.push({ i, len, s: str, w: ww });
      }
    }
    return out;
  };
  const profiles = companies.map(c => aliasTexts(c).map(txt => {
    const toks = tokens(txt);
    if (!toks.some(t => !LEGAL.has(t))) return null;
    const w = toks.map(wt);
    return { txt, toks, w, total: w.reduce((a, b) => a + b, 0), spans: spansOf(toks, w) };
  }).filter(Boolean));

  function scoreAlias(al, lt, lw, ls, ll){
    const base = [];
    for (const a of al.spans) for (const l of ls){
      const multi = a.len > 1 || l.len > 1;
      const sh = a.s === l.s ? 1 : ((multi && (Math.min(a.len, l.len) > 1 || Math.max(a.len, l.len) > 2)) ? 0 : sharpen(simTok(a.s, l.s)));
      if (sh > 0) base.push({ a, l, sh, g: sh * (a.w + 0.3 * l.w) });
    }
    if (!base.length) return 0;
    const run = exactFirst => {
      const cands = base.slice().sort((x, y) => (exactFirst ? ((y.sh === 1) - (x.sh === 1)) : 0) || y.g - x.g);
      const ua = new Array(al.toks.length).fill(false), ul = new Array(lt.length).fill(false);
      let ms = 0, mA = 0;
      for (const c of cands){
        let clash = false;
        for (let k = 0; k < c.a.len; k++) if (ua[c.a.i + k]) clash = true;
        for (let k = 0; k < c.l.len; k++) if (ul[c.l.i + k]) clash = true;
        if (clash) continue;
        for (let k = 0; k < c.a.len; k++) ua[c.a.i + k] = true;
        for (let k = 0; k < c.l.len; k++) ul[c.l.i + k] = true;
        ms += c.sh * c.a.w; mA += c.a.w;
      }
      let uL = 0; for (let k = 0; k < lt.length; k++) if (!ul[k]) uL += ll[k];
      if (ms <= 0) return 0;
      const P = ms / (mA + uL), R = ms / al.total;
      if (R < 0.45) return 0;
      return 2 * P * R / (P + R);
    };
    return Math.max(run(true), run(false));
  }
  const cache = new Map();
  function score(desc){
    const key = norm(desc);
    if (cache.has(key)) return cache.get(key);
    const variants = [String(desc)];
    const nb = String(desc).replace(/\([^)]*\)/g, ' ');
    if (nb !== String(desc)) variants.push(nb);
    const res = new Float64Array(N);
    for (const v of variants){
      const lt = tokens(v); if (!lt.length) continue;
      const lw = lt.map(wt), ll = lt.map(wLeft), ls = spansOf(lt, lw);
      for (let ci = 0; ci < N; ci++) for (const al of profiles[ci]){
        const s = scoreAlias(al, lt, lw, ls, ll);
        if (s > res[ci]) res[ci] = s;
      }
    }
    cache.set(key, res);
    return res;
  }
  return { score, profiles };
}

/* ============ model: match every TB line, build pair balances ============ */
function lineKey(co, ln){ return co.id + '|' + ln.code + '|' + norm(ln.desc); }
function groupOf(code){ return String(code).split(/[\/.\-]/)[0]; }
function isHeaderLine(ln){ return ln.net === 0 && ln.dr === 0 && ln.cr === 0 && /(^|[\/.\-])0+$/.test(ln.code); }

function buildModel(companies, overrides, settings){
  const thr = settings.threshold, amb = settings.ambiguity;
  const N = companies.length;
  const idx = new Map(companies.map((c, i) => [c.id, i]));
  const matcher = buildMatcher(companies);
  const res = companies.map(() => []);
  const bal = companies.map(() => companies.map(() => ({ sum: 0, lines: [] })));
  const loanGroups = companies.map(() => new Set());

  companies.forEach((co, i) => {
    co.lines.forEach((ln, k) => {
      const r = { i, k, status: 'skip', target: -1, score: 0, cands: [] };
      res[i][k] = r;
      if (isHeaderLine(ln) || !ln.desc) return;
      const ov = overrides[lineKey(co, ln)] !== undefined ? overrides[lineKey(co, ln)] : overrides['d:' + norm(ln.desc)];
      const sc = matcher.score(ln.desc);
      const order = [];
      for (let j = 0; j < N; j++) if (j !== i) order.push({ j, s: sc[j] });
      order.sort((a, b) => b.s - a.s);
      r.cands = order.slice(0, 4);
      if (ov === 'ignore'){ r.status = 'ignored'; return; }
      if (ov && idx.has(ov) && idx.get(ov) !== i){
        r.status = 'manual'; r.target = idx.get(ov); r.score = 1; return;
      }
      const b = order[0], s2 = order[1];
      if (b && b.s >= thr){
        if (s2 && b.s - s2.s < amb){ r.status = 'ambiguous'; r.score = b.s; }
        else { r.status = 'auto'; r.target = b.j; r.score = b.s; }
      } else if (b && b.s >= 0.4){ r.status = 'weak'; r.score = b.s; }
      else r.status = 'none';
    });
    co.lines.forEach((ln, k) => {
      const r = res[i][k];
      if (r.target >= 0){
        loanGroups[i].add(groupOf(ln.code));
        const cell = bal[i][r.target];
        cell.sum = round2(cell.sum + ln.net); cell.lines.push(k);
      }
    });
  });

  const tol = settings.tolerance;
  const pairs = [];
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++){
    const A = bal[i][j], B = bal[j][i];
    const aHas = A.lines.some(k => companies[i].lines[k].net !== 0);
    const bHas = B.lines.some(k => companies[j].lines[k].net !== 0);
    if (!aHas && !bHas) continue;
    const diff = round2(A.sum + B.sum);
    let status = 'agree';
    if (!aHas || !bHas) status = 'onesided';
    else if (Math.abs(diff) > tol) status = 'diff';
    pairs.push({ i, j, a: A.sum, b: B.sum, diff, status, aHas, bHas });
  }
  return { res, bal, pairs, loanGroups, N };
}

/* ============ TB parsing ============ */
function splitDelimited(text){
  text = String(text).replace(/^﻿/, '');
  const lines = text.split(/\r?\n/);
  const sample = lines.slice(0, 15).join('\n');
  const cnt = ch => (sample.match(new RegExp(ch === '\t' ? '\\t' : '\\' + ch, 'g')) || []).length;
  let d = '\t';
  if (!cnt('\t')){ d = cnt(';') > cnt(',') ? ';' : ','; }
  const rows = []; let row = [], cur = '', q = false;
  for (let p = 0; p < text.length; p++){
    const ch = text[p];
    if (q){
      if (ch === '"'){ if (text[p + 1] === '"'){ cur += '"'; p++; } else q = false; }
      else cur += ch;
    } else if (ch === '"' && cur === '') q = true;
    else if (ch === d){ row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r'){
      if (ch === '\r' && text[p + 1] === '\n') p++;
      row.push(cur); rows.push(row); row = []; cur = '';
    } else cur += ch;
  }
  row.push(cur); if (row.some(c => c !== '') || row.length > 1) rows.push(row);
  return rows;
}
function parseNum(v){
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  let s = String(v).replace(/[\u2212\u2013\u2014]/g, '-').replace(/[\s\u00a0 R$]/g, '');
  if (!s) return 0;
  let neg = false;
  if (/^\(.*\)$/.test(s)){ neg = true; s = s.slice(1, -1); }
  if (/-$/.test(s)){ neg = true; s = s.slice(0, -1); }
  if (/^-/.test(s)){ neg = !neg; s = s.slice(1); }
  s = s.replace(/(cr|dr)$/i, '');
  if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
  else if (s.includes(',')) s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  const n = parseFloat(s);
  if (!isFinite(n)) return 0;
  return neg ? -n : n;
}
const CODE_RE = /^[A-Za-z]{0,4}[-.]?\d{2,}(?:[\/.\-][A-Za-z0-9]+)?$/;
function parseTBGrid(grid){
  const warn = [];
  const g = grid.map(r => r.map(c => c == null ? '' : (typeof c === 'string' ? c.trim() : c)));
  let title = '';
  let firstData = g.findIndex(r => r.some(c => typeof c === 'string' && CODE_RE.test(c)));
  if (firstData < 0) firstData = g.length;
  const hdrRow = g.findIndex((r, i) => i < firstData && r.some(c => /^(dr|debits?|balance|amount)$/i.test(String(c))));
  const titleLimit = Math.min(6, hdrRow >= 0 ? hdrRow : firstData);
  for (let r = 0; r < titleLimit && !title; r++){
    for (const c of g[r]){
      const t = String(c);
      if (t && !/^trial balance\b/i.test(t) && !/^(last year|py\b|prior|account|acc|code|description|name|debits?|credits?|dr|cr|balance|amount|net)\b/i.test(t) && isNaN(parseFloat(t))){ title = t; break; }
    }
  }
  let ps = '', pe = '';
  const head = g.slice(0, 8).map(r => r.join(' ')).join(' ');
  const m = head.match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})\s*(?:to|-|–|tot)\s*(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/i);
  if (m){
    const f = (d, mo, y) => y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    ps = f(m[1], m[2], m[3]); pe = f(m[4], m[5], m[6]);
  }
  let hr = -1, cDR = -1, cCR = -1, cAcc = -1, cDesc = -1, cBal = -1;
  const isDR = t => /^(dr|debits?|debit amount)$/i.test(t), isCR = t => /^(cr|credits?|credit amount)$/i.test(t);
  for (let r = 0; r < Math.min(15, g.length); r++){
    const row = g[r].map(String);
    const d = row.findIndex(isDR), c = row.findIndex(isCR);
    if (d >= 0 && c >= 0){
      hr = r; cDR = d; cCR = c;
      const accs = row.map((t, i) => /^account$/i.test(t) ? i : -1).filter(i => i >= 0);
      if (accs.length >= 2){ cAcc = accs[0]; cDesc = accs[1]; }
      else if (accs.length === 1){ cAcc = accs[0]; cDesc = accs[0] + 1; }
      break;
    }
  }
  if (hr < 0){
    for (let r = 0; r < Math.min(15, g.length) && hr < 0; r++){
      const row = g[r].map(String); const b = row.findIndex(t => /^(balance|closing balance|net|net balance|amount|current|ytd)$/i.test(t));
      if (b >= 0 && row.some(t => /^(account|acc|code|description|name)/i.test(t))){
        hr = r; cBal = b;
        const accs = row.map((t, i) => /^(account|acc|code|account code|account no)/i.test(t) ? i : -1).filter(i => i >= 0);
        const dsc = row.findIndex(t => /^(description|account name|name|account description)$/i.test(t));
        if (accs.length){ cAcc = accs[0]; cDesc = dsc >= 0 ? dsc : (accs.length > 1 ? accs[1] : accs[0] + 1); }
      }
    }
  }
  const width = Math.max(0, ...g.map(r => r.length));
  if (cAcc < 0){
    const hits = new Array(width).fill(0);
    g.forEach(r => r.forEach((c, i) => { if (typeof c === 'string' && CODE_RE.test(c)) hits[i]++; }));
    const best = hits.indexOf(Math.max(...hits));
    if (hits[best] > 0){ cAcc = best; cDesc = best + 1; }
  }
  if (cAcc < 0) return { error: 'Could not find an account-code column (e.g. 0551/002). Paste the trial balance including the Account, Description, DR and CR columns.' };
  if (cBal < 0 && (cDR < 0 || cCR < 0)){ cCR = width - 1; cDR = width - 2; warn.push('No DR/CR headings found – assumed the last two columns are DR and CR.'); }
  const lines = [];
  for (let r = hr + 1; r < g.length; r++){
    const row = g[r];
    const code = String(row[cAcc] == null ? '' : row[cAcc]).trim();
    if (!CODE_RE.test(code)) continue;
    const desc = String(row[cDesc] == null ? '' : row[cDesc]).trim();
    let dr, cr;
    if (cBal >= 0){ const v = round2(parseNum(row[cBal])); dr = v > 0 ? v : 0; cr = v < 0 ? -v : 0; }
    else { dr = round2(parseNum(row[cDR])); cr = round2(parseNum(row[cCR])); }
    lines.push({ code, desc, dr, cr, net: round2(dr - cr) });
  }
  if (!lines.length) return { error: 'No account lines were recognised.' };
  const name = cleanName(title);
  return { title, name, periodStart: ps, periodEnd: pe, lines, warn, hasHeader: hr >= 0 };
}
function parseTBText(text){ return parseTBGrid(splitDelimited(text)); }

/* ============ zip / xlsx ============ */
async function inflateRaw(u8){
  const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function readZip(buf){
  const u8 = new Uint8Array(buf), dv = new DataView(buf);
  let e = u8.length - 22;
  while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('Not a valid Excel/zip file');
  const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true);
  const dec = new TextDecoder(); const files = {};
  for (let k = 0; k < n; k++){
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nl));
    const lnl = dv.getUint16(off + 26, true), lel = dv.getUint16(off + 28, true);
    const start = off + 30 + lnl + lel;
    files[name] = { method, data: u8.subarray(start, start + csize) };
    p += 46 + nl + el + cl;
  }
  return {
    has: n => !!files[n],
    names: () => Object.keys(files),
    async text(n){
      const f = files[n]; if (!f) return null;
      const d = f.method === 0 ? f.data : await inflateRaw(f.data);
      return new TextDecoder().decode(d);
    }
  };
}
const xmlDec = s => s.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos);/gi, (m, g) => {
  if (g[0] === '#') return String.fromCodePoint(g[1].toLowerCase() === 'x' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10));
  return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[g.toLowerCase()];
});
function colIdx(ref){ let n = 0; const m = ref.match(/^[A-Z]+/)[0]; for (const ch of m) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; }
async function readWorkbookSheets(buf){
  const z = await readZip(buf);
  const wb = await z.text('xl/workbook.xml'); if (!wb) throw new Error('This file has no workbook.xml – is it an Excel .xlsx/.xlsm file?');
  const rels = await z.text('xl/_rels/workbook.xml.rels') || '';
  const relMap = {};
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)){
    const id = (m[0].match(/\bId="([^"]*)"/) || [])[1], t = (m[0].match(/\bTarget="([^"]*)"/) || [])[1];
    if (id && t) relMap[id] = t.replace(/^\//, '').replace(/^(?!xl\/)/, 'xl/');
  }
  const sst = [];
  const ssx = await z.text('xl/sharedStrings.xml');
  if (ssx) for (const m of ssx.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)){
    let t = ''; for (const x of m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) t += x[1];
    sst.push(xmlDec(t));
  }
  const sheets = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)){
    const name = xmlDec((m[0].match(/\bname="([^"]*)"/) || [])[1] || '');
    const rid = (m[0].match(/\br:id="([^"]*)"/) || [])[1];
    const path = relMap[rid]; if (!path) continue;
    const xml = await z.text(path); if (!xml) continue;
    const rows = [];
    for (const rm of xml.matchAll(/<row\b[^>]*?\br="(\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)){
      const r = parseInt(rm[1], 10) - 1; const body = rm[2] || ''; const row = [];
      for (const cm of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)){
        const at = cm[1], inner = cm[2] || '';
        const ref = (at.match(/\br="([A-Z]+\d+)"/) || [])[1]; if (!ref) continue;
        const t = (at.match(/\bt="(\w+)"/) || [])[1];
        const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        let val = '';
        if (t === 'inlineStr'){ let s = ''; for (const x of inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) s += x[1]; val = xmlDec(s); }
        else if (v === undefined) val = '';
        else if (t === 's') val = sst[parseInt(v, 10)] || '';
        else if (t === 'str') val = xmlDec(v);
        else if (t === 'b') val = v === '1';
        else if (t === 'e') val = '';
        else { const n = parseFloat(v); val = isFinite(n) ? n : v; }
        row[colIdx(ref)] = val;
      }
      rows[r] = row;
    }
    for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
    sheets.push({ name, rows });
  }
  return sheets;
}

/* ============ zip writer (store only) ============ */
const _crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++){ let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8){ let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = _crcT[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function makeZip(files, asBytes){
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  const d = new Date();
  const dt = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF;
  const dd = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
  for (const f of files){
    const name = enc.encode(f.name), data = f.content instanceof Uint8Array ? f.content : enc.encode(f.content), crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, dt, true); lh.setUint16(12, dd, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint16(12, dt, true); ch.setUint16(14, dd, true); ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, off, true);
    central.push(new Uint8Array(ch.buffer), name);
    off += 30 + name.length + data.length;
  }
  const csize = central.reduce((a, b) => a + b.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, csize, true); e.setUint32(16, off, true);
  const all = [...parts, ...central, new Uint8Array(e.buffer)];
  if (asBytes){ const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0)); let o = 0; all.forEach(b => { out.set(b, o); o += b.length; }); return out; }
  return new Blob(all, { type: 'application/zip' });
}

/* ============ interest journal ============ */
function roundInterest(x, mode){
  const v = Math.round(x * 100 * 1e6) / 1e6;
  if (mode === 'down') return Math.trunc(v) / 100;
  return (v < 0 ? -Math.round(-v) : Math.round(v)) / 100;
}
function defaultAccounts(code){
  return String(code || '').charAt(0) === '0'
    ? { recv: '0130/000', paid: '0371/000', contra: '0999/000' }
    : { recv: '2750/000', paid: '3900/000', contra: '9990/000' };
}
function fmtDate(iso, style){
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return ({ dmy: `${d}/${m}/${y}`, ymd: `${y}/${m}/${d}`, iso: `${y}-${m}-${d}`, dmyd: `${d}-${m}-${y}`, mdy: `${m}/${d}/${y}` })[style] || iso;
}
function csvCell(v){ const s = String(v == null ? '' : v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function buildJournalCSV(entries, o){
  // entries: [{account, desc, amount}] amount>0 = debit, <0 = credit
  const rows = [];
  const date = fmtDate(o.date, o.dateStyle);
  const sep = o.delimiter === 'semi' ? ';' : o.delimiter === 'tab' ? '\t' : ',';
  const done = () => rows.map(r => r.map(c => { const s = String(c == null ? '' : c); return (new RegExp('["\\r\\n' + (sep === '\t' ? '\\t' : sep) + ']')).test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(sep)).join('\r\n') + '\r\n';
  if (['xero', 'qbo', 'custom'].includes(o.format)){ extraFormats(entries, o, rows); return done(); }
  if (o.format === 'pastel'){
    if (o.header) rows.push(['Period', 'Date', 'Type', 'Account', 'Reference', 'Description', 'Amount', 'Contra Account']);
    entries.forEach(e => rows.push([o.period, e.date ? fmtDate(e.date, o.dateStyle) : date, 'G', e.account, e.ref || o.ref, e.desc, e.amount.toFixed(2), e.contra || o.contra]));
  } else {
    rows.push(['Date', 'Reference', 'Description', 'Account', 'Debit', 'Credit']);
    entries.forEach(e => rows.push([e.date ? fmtDate(e.date, o.dateStyle) : date, e.ref || o.ref, e.desc, e.account, e.amount > 0 ? e.amount.toFixed(2) : '', e.amount < 0 ? (-e.amount).toFixed(2) : '']));
  }
  return done();
}

/* ============ dates ============ */
const MONTHS = { jan:1, feb:2, mar:3, apr:4, may:5, mei:5, jun:6, jul:7, aug:8, sep:9, sept:9, oct:10, okt:10, nov:11, dec:12, des:12, mrt:3, maa:3 };
const pad2 = n => String(n).padStart(2, '0');
function validISO(y, m, d){
  if (!(y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return '';
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return '';
  return y + '-' + pad2(m) + '-' + pad2(d);
}
function parseDate(v, order){
  if (v == null || v === '') return '';
  if (typeof v === 'number'){
    if (v > 20000 && v < 80000){ const d = new Date(Math.round((v - 25569) * 86400000)); return validISO(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); }
    return '';
  }
  const s = String(v).trim(); let m;
  if (!s) return '';
  if ((m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?!\d)/))) return validISO(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[-\/. ](\d{1,2})[-\/. ](\d{2,4})(?!\d)/))){
    let a = +m[1], b = +m[2], y = +m[3]; if (y < 100) y += 2000;
    let r = order === 'mdy' ? validISO(y, a, b) : validISO(y, b, a);
    if (!r) r = order === 'mdy' ? validISO(y, b, a) : validISO(y, a, b);
    return r;
  }
  if ((m = s.match(/^(\d{1,2})[-\/. ]([A-Za-z]{3,9})\.?[-\/. ,]*(\d{2,4})/))){
    const mo = MONTHS[m[2].toLowerCase().slice(0, m[2].length > 3 && MONTHS[m[2].toLowerCase()] ? undefined : 3)]; let y = +m[3]; if (y < 100) y += 2000;
    return mo ? validISO(y, mo, +m[1]) : '';
  }
  if ((m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/))){ const mo = MONTHS[m[1].toLowerCase().slice(0, 3)]; return mo ? validISO(+m[3], mo, +m[2]) : ''; }
  if (/^\d{8}$/.test(s)) return validISO(+s.slice(0, 4), +s.slice(4, 6), +s.slice(6, 8));
  return '';
}

/* ============ ledger parsing ============ */
const ROLE_RE = {
  date: /^(date|datum|trans(action)? date|posting date|doc(ument)? date|tran date|invoice date|dt)$/i,
  ref: /^(ref|reference|ref no|ref\.?|document|doc|doc no|document no|document number|invoice|invoice no|inv|inv no|number|no|nr|verw|verwysing|nommer|voucher|cheque|cheque no|transaction ref|trans no|source|tran no)$/i,
  desc: /^(description|desc|narration|narrative|details?|particulars|memo|text|beskrywing|transaction|transaction description|comment|remarks?|reference text)$/i,
  debit: /^(dr|debit|debits|debiet|debit amount|dr amount)$/i,
  credit: /^(cr|credit|credits|krediet|credit amount|cr amount)$/i,
  amount: /^(amount|value|bedrag|transaction amount|net amount|amt)$/i,
  balance: /^(balance|running balance|saldo|bal|closing balance)$/i
};
const NUMLIKE = /^[\s\-\(R$€£]*\d[\d\s,.]*\)?-?\s*(cr|dr)?$/i;
function guessLedgerMap(grid){
  const g = grid.map(r => r.map(c => c == null ? '' : c));
  const width = Math.max(0, ...g.map(r => r.length));
  const map = { date: -1, ref: -1, desc: -1, debit: -1, credit: -1, amount: -1, balance: -1 };
  let hdr = -1;
  for (let r = 0; r < Math.min(20, g.length); r++){
    const cells = g[r].map(c => String(c).trim());
    const hits = {}; let n = 0;
    cells.forEach((t, i) => { if (!t) return; for (const k in ROLE_RE) if (ROLE_RE[k].test(t) && hits[k] === undefined){ hits[k] = i; n++; break; } });
    if (n >= 2 && (hits.date !== undefined || hits.amount !== undefined || hits.debit !== undefined)){ hdr = r; Object.assign(map, hits); break; }
  }
  const body = g.slice(hdr + 1).filter(r => r.some(c => String(c).trim() !== '')).slice(0, 80);
  const st = [];
  for (let c = 0; c < width; c++){
    let ne = 0, dt = 0, nu = 0, len = 0, ser = 0, intc = 0;
    body.forEach(r => { const v = r[c]; if (v === '' || v == null) return; ne++;
      const s = String(v).trim(); len += s.length;
      if (typeof v === 'string' && parseDate(s, 'dmy') && !/^\d{5}$/.test(s)) dt++;
      if (typeof v === 'number' || NUMLIKE.test(s)){ nu++; const n = typeof v === 'number' ? v : parseNum(s); if (Number.isInteger(n) && n > 36000 && n < 73100) ser++; if (Number.isInteger(n)) intc++; }
    });
    st.push({ ne, dt: ne ? dt / body.length : 0, nu: ne ? nu / ne : 0, fill: ne / Math.max(1, body.length), len: ne ? len / ne : 0, ser: ne ? ser / ne : 0 });
  }
  const used = new Set(Object.values(map).filter(i => i >= 0));
  if (map.date < 0){
    let best = -1, bs = 0.4;
    st.forEach((s, c) => { if (!used.has(c) && s.dt > bs){ bs = s.dt; best = c; } });
    if (best < 0) st.forEach((s, c) => { if (!used.has(c) && s.ser > 0.8 && s.fill > 0.5 && best < 0){ best = c; } });
    if (best >= 0){ map.date = best; used.add(best); }
  }
  const textCols = st.map((s, c) => ({ s, c })).filter(x => !used.has(x.c) && x.s.nu < 0.5 && x.s.ne > 0);
  if (map.desc < 0 && textCols.length){
    const d = textCols.slice().sort((a, b) => b.s.len - a.s.len)[0]; map.desc = d.c; used.add(d.c);
  }
  if (map.ref < 0){
    const t = textCols.filter(x => !used.has(x.c)).sort((a, b) => a.s.len - b.s.len)[0]; if (t){ map.ref = t.c; used.add(t.c); }
  }
  const numCols = st.map((s, c) => ({ s, c })).filter(x => !used.has(x.c) && x.s.nu >= 0.5 && x.s.fill > 0.05);
  if (map.debit < 0 && map.credit < 0 && map.amount < 0 && numCols.length){
    if (numCols.length === 1) map.amount = numCols[0].c;
    else {
      const a = numCols[numCols.length >= 3 ? numCols.length - 3 : 0], b = numCols[numCols.length >= 3 ? numCols.length - 2 : 1];
      if (a.s.fill < 0.85 && b.s.fill < 0.85){ map.debit = a.c; map.credit = b.c; if (numCols.length >= 3 && map.balance < 0) map.balance = numCols[numCols.length - 1].c; }
      else { map.amount = a.c; if (map.balance < 0) map.balance = b.c; }
    }
  }
  return { hdr, map, width };
}
function buildLedger(grid, map, o){
  o = o || {};
  const items = []; let skipped = 0;
  const hdr = o.hdr == null ? -1 : o.hdr;
  const skipRe = /^\s*(opening|closing|balance\b|bal\b|brought forward|carried forward|b\/f|c\/f|bal b|bal c|total|sub-?total|saldo|openingsaldo|sluitingsaldo)/i;
  for (let r = hdr + 1; r < grid.length; r++){
    const row = grid[r] || [];
    if (!row.some(c => String(c == null ? '' : c).trim() !== '')) continue;
    const get = i => i >= 0 ? row[i] : '';
    let amt = 0;
    if (map.debit >= 0 || map.credit >= 0) amt = round2(parseNum(get(map.debit)) - parseNum(get(map.credit)));
    else if (map.amount >= 0){
      const raw = get(map.amount); amt = round2(parseNum(raw));
      if (typeof raw === 'string' && /cr\s*$/i.test(raw.trim())) amt = -Math.abs(amt);
      if (o.negDebit) amt = -amt;
    }
    const ref = String(get(map.ref) == null ? '' : get(map.ref)).trim(), desc = String(get(map.desc) == null ? '' : get(map.desc)).trim();
    const date = parseDate(get(map.date), o.dateOrder);
    if (amt === 0) continue;
    if (o.skipBal !== false && !date && !ref && !desc){ skipped++; continue; }
    if (o.skipBal !== false && !date && row.some(c => typeof c === 'string' && skipRe.test(c))){ skipped++; continue; }
    if (o.skipBal !== false && skipRe.test(desc || ref) && !date){ skipped++; continue; }
    if (o.skipBal !== false && skipRe.test(desc) && /^\s*(opening|closing|brought|carried|b\/f|c\/f|bal)/i.test(desc)){ skipped++; continue; }
    items.push({ date, ref, desc, amt, row: r + 1 });
  }
  return { items, skipped };
}

/* ============ ledger matching ============ */
function matchLedgers(A, B, o){
  o = o || {};
  const tolC = Math.round((o.tol || 0) * 100), win = o.days == null ? 30 : o.days, sgn = o.mirror === false ? 1 : -1;
  const nA = A.length, nB = B.length;
  const alnum = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const digs = (s, min) => (String(s || '').match(/\d+/g) || []).map(x => x.replace(/^0+/, '')).filter(x => x.length >= min);
  const invNums = x => { const t = (String(x.ref || '') + ' ' + String(x.desc || '')).replace(/\b\d{1,4}[-\/.]\d{1,2}[-\/.]\d{1,4}\b/g, ' '); return new Set((t.match(/\d+/g) || []).map(d => d.replace(/^0+/, '')).filter(d => d.length >= 3 && d.length <= 12)); };
  const prep = (x, sg) => ({ c: Math.round(x.amt * sg * 100), day: x.date ? Date.parse(x.date) / 864e5 : null, ref: alnum(x.ref), rd: new Set(digs(x.ref, 3)), dd: new Set([...digs(x.ref, 3), ...digs(x.desc, 4)]), toks: new Set(tokens(x.desc)), inv: invNums(x) });
  const pa = A.map(x => prep(x, 1)), pb = B.map(x => prep(x, sgn));
  const usedA = new Array(nA).fill(false), usedB = new Array(nB).fill(false);
  const matches = []; const rej = new Set(o.rejected || []);
  (o.manual || []).forEach(m => {
    if (m.a.every(i => i < nA && !usedA[i]) && m.b.every(i => i < nB && !usedB[i])){
      m.a.forEach(i => usedA[i] = true); m.b.forEach(i => usedB[i] = true); matches.push({ a: m.a.slice(), b: m.b.slice(), method: m.method || 'Manual match', conf: m.conf || 100 });
    }
  });
  const order = [...Array(nB).keys()].sort((x, y) => pb[x].c - pb[y].c), bc = order.map(i => pb[i].c);
  const lower = v => { let lo = 0, hi = bc.length; while (lo < hi){ const mid = (lo + hi) >> 1; if (bc[mid] < v) lo = mid + 1; else hi = mid; } return lo; };
  const days = (i, j) => (pa[i].day == null || pb[j].day == null) ? 0 : Math.abs(pa[i].day - pb[j].day);
  function refScore(i, j){
    const a = pa[i], b = pb[j];
    if (a.ref.length >= 3 && b.ref.length >= 3){
      if (a.ref === b.ref) return 3;
      for (const k of a.rd) if (b.rd.has(k)) return 2.5;
      if (Math.min(a.ref.length, b.ref.length) >= 4 && (a.ref.includes(b.ref) || b.ref.includes(a.ref))) return 2;
    }
    for (const k of a.dd) if (b.dd.has(k)) return 1.5;
    return 0;
  }
  function descSim(i, j){
    const a = pa[i].toks, b = pb[j].toks; if (!a.size || !b.size) return 0;
    let n = 0; for (const t of a) if (b.has(t)) n++;
    return n / (a.size + b.size - n);
  }
  function pass(method, fn){
    const cand = [];
    for (let i = 0; i < nA; i++){
      if (usedA[i]) continue; const c = pa[i].c; let best = [];
      for (let p = lower(c - tolC); p < nB && bc[p] <= c + tolC; p++){
        const j = order[p]; if (usedB[j] || rej.has(i + '|' + j)) continue;
        const r = fn(i, j); if (r) best.push([r[0], i, j, r[1]]);
      }
      if (best.length > 8){ best.sort((x, y) => y[0] - x[0]); best = best.slice(0, 8); }
      for (const b of best) cand.push(b);
    }
    cand.sort((x, y) => y[0] - x[0]);
    for (const [s, i, j, conf] of cand){
      if (usedA[i] || usedB[j]) continue;
      usedA[i] = usedB[j] = true; matches.push({ a: [i], b: [j], method, conf: Math.round(conf) });
    }
  }
  pass('Reference + amount', (i, j) => { const rs = refScore(i, j); return rs >= 2 ? [rs * 10 - Math.min(days(i, j), 365) * 0.01, 99] : null; });
  pass('Same date + amount', (i, j) => { if (days(i, j) > 0) return null; const rs = refScore(i, j), ds = descSim(i, j); return [rs * 5 + ds * 3, rs > 0 || ds >= 0.3 ? 92 : 78]; });
  pass('Reference/description + amount', (i, j) => { const d = days(i, j); if (d > win) return null; const rs = refScore(i, j), ds = descSim(i, j); if (!(rs > 0 || ds >= 0.5)) return null; return [rs * 5 + ds * 3 - d * 0.05, Math.max(60, 82 - d * 0.3)]; });
  // reference matches but the amount differs
  {
    const idx = new Map();
    pb.forEach((b, j) => { if (usedB[j]) return; const keys = new Set(b.rd); if (b.ref.length >= 4) keys.add(b.ref); keys.forEach(k => { if (!idx.has(k)) idx.set(k, []); idx.get(k).push(j); }); });
    const cand = [];
    pa.forEach((a, i) => {
      if (usedA[i]) return; const keys = new Set(a.rd); if (a.ref.length >= 4) keys.add(a.ref);
      keys.forEach(k => (idx.get(k) || []).forEach(j => {
        if (usedB[j] || rej.has(i + '|' + j) || Math.sign(a.c) !== Math.sign(pb[j].c)) return;
        const d = days(i, j); if (d > Math.max(win * 3, 90)) return;
        const rs = refScore(i, j); if (rs < 2) return;
        cand.push([rs * 10 - d * 0.02, i, j]);
      }));
    });
    cand.sort((x, y) => y[0] - x[0]);
    for (const [s, i, j] of cand){ if (usedA[i] || usedB[j]) continue; usedA[i] = usedB[j] = true; matches.push({ a: [i], b: [j], method: 'Reference match – amount differs', conf: 60 }); }
  }

  // payment/credit that lists several invoice numbers against items on the other side that carry those numbers
  function byInvoice(fromA){
    const P = fromA ? pa : pb, Q = fromA ? pb : pa, uP = fromA ? usedA : usedB, uQ = fromA ? usedB : usedA;
    for (let i = 0; i < P.length; i++){
      if (uP[i] || P[i].c === 0 || P[i].inv.size < 2) continue;
      const target = P[i].c;
      let cands = [];
      for (let j = 0; j < Q.length; j++){
        if (uQ[j] || Math.sign(Q[j].c) !== Math.sign(target) || Math.abs(Q[j].c) > Math.abs(target) + tolC) continue;
        if (fromA ? rej.has(i + '|' + j) : rej.has(j + '|' + i)) continue;
        let hit = false; for (const k of Q[j].inv) if (P[i].inv.has(k)) { hit = true; break; }
        if (hit) cands.push(j);
      }
      if (cands.length < 2 || cands.length > 14) continue;
      let found = null;
      const tot = cands.reduce((s, j) => s + Q[j].c, 0);
      if (Math.abs(tot - target) <= tolC) found = cands;
      else {
        const n = cands.length, lim = Math.min(n, 12);
        for (let mask = 3; mask < (1 << lim) && !found; mask++){
          let s2 = 0, cnt = 0; for (let b = 0; b < lim; b++) if (mask & (1 << b)){ s2 += Q[cands[b]].c; cnt++; }
          if (cnt >= 2 && Math.abs(s2 - target) <= tolC) found = cands.filter((_, b) => mask & (1 << b));
        }
      }
      if (found){ uP[i] = true; found.forEach(j => uQ[j] = true); matches.push(fromA ? { a: [i], b: found, method: 'Grouped by invoice numbers', conf: 88 } : { a: found, b: [i], method: 'Grouped by invoice numbers', conf: 88 }); }
    }
  }
  if (o.grouped !== false){ byInvoice(true); byInvoice(false); }
  // grouped: one item against two or three on the other side
  function group(fromA){
    const P = fromA ? pa : pb, Q = fromA ? pb : pa, uP = fromA ? usedA : usedB, uQ = fromA ? usedB : usedA;
    const dayP = i => P[i].day;
    const rs = (i, j) => fromA ? refScore(i, j) : refScore(j, i);
    for (let i = 0; i < P.length; i++){
      if (uP[i]) continue; const target = P[i].c; if (target === 0) continue;
      let cands = [];
      for (let j = 0; j < Q.length; j++){
        if (uQ[j] || Math.sign(Q[j].c) !== Math.sign(target) || Math.abs(Q[j].c) >= Math.abs(target)) continue;
        if (fromA ? rej.has(i + '|' + j) : rej.has(j + '|' + i)) continue;
        const dd = (dayP(i) == null || Q[j].day == null) ? 0 : Math.abs(dayP(i) - Q[j].day), r = rs(i, j);
        if (dd > win && r === 0) continue;
        cands.push({ j, r, dd });
      }
      if (cands.length < 2) continue;
      cands.sort((x, y) => y.r - x.r || x.dd - y.dd); cands = cands.slice(0, 40);
      let found = null;
      outer:
      for (let x = 0; x < cands.length; x++) for (let y = x + 1; y < cands.length; y++){
        const s2 = Q[cands[x].j].c + Q[cands[y].j].c;
        if (Math.abs(s2 - target) <= tolC){ found = [cands[x].j, cands[y].j]; break outer; }
        if (cands[x].r > 0 || cands[y].r > 0) for (let z = y + 1; z < cands.length; z++){
          if (Math.abs(s2 + Q[cands[z].j].c - target) <= tolC){ found = [cands[x].j, cands[y].j, cands[z].j]; break outer; }
        }
      }
      if (found){ uP[i] = true; found.forEach(j => uQ[j] = true); matches.push(fromA ? { a: [i], b: found, method: 'Grouped (1 to many)', conf: 55 } : { a: found, b: [i], method: 'Grouped (many to 1)', conf: 55 }); }
    }
  }
  if (o.grouped !== false){ group(true); group(false); }
  pass('Amount only (probable)', (i, j) => { const d = days(i, j); if (d > win) return null; return [-d + descSim(i, j), Math.max(45, 66 - Math.min(d, 30) * 0.5)]; });
  matches.forEach(m => {
    const sa = m.a.reduce((s, i) => s + pa[i].c, 0), sb = m.b.reduce((s, j) => s + pb[j].c, 0);
    m.diff = (sa - sb) / 100;
    const ds = []; m.a.forEach(i => m.b.forEach(j => ds.push(days(i, j)))); m.days = Math.round(Math.max(...ds));
    m.status = Math.abs(sa - sb) <= tolC ? 'matched' : 'diff';
  });
  const unA = [], unB = []; usedA.forEach((u, i) => { if (!u) unA.push(i); }); usedB.forEach((u, j) => { if (!u) unB.push(j); });
  const sumA = pa.reduce((s, x) => s + x.c, 0) / 100, sumB = pb.reduce((s, x) => s + x.c, 0) / 100;
  matches.sort((x, y) => Math.min(...x.a) - Math.min(...y.a));
  return { matches, unA, unB, sumA, sumB, effB: B.map((x, j) => pb[j].c / 100) };
}

/* ============ xlsx writer ============ */
const xmlEsc = s => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
function colLetter(n){ let s = ''; n++; while (n > 0){ const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
function makeXlsx(sheets, asBytes){
  const files = [];
  const usedNames = new Set();
  const sheetXml = sheets.map(sh => {
    let r = 0; const rows = [];
    const cell = (c, v, st) => {
      if (v === '' || v == null) return '';
      const ref = colLetter(c) + (r + 1);
      if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}"${st ? ` s="${st}"` : ''}><v>${v}</v></c>`;
      return `<c r="${ref}"${st ? ` s="${st}"` : ''} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
    };
    const push = (cells, ht) => { rows.push(`<row r="${r + 1}">${cells}</row>`); r++; };
    if (sh.title){ push(cell(0, sh.title, 5)); if (sh.subtitle) push(cell(0, sh.subtitle, 0)); r++; }
    const hdrRow = r + 1;
    if (!sh.plain || (sh.head && sh.head.length)) push(sh.head.map((h, c) => cell(c, h, sh.plain ? 4 : 1)).join(''));
    const money = new Set(sh.money || []);
    const TN = { ok: [6, 9], bad: [7, 10], warn: [8, 11] };
    sh.rows.forEach((row, n) => { const tn = sh.tone && TN[sh.tone[n]]; push(row.map((v, c) => cell(c, v, tn ? (typeof v === 'number' && money.has(c) ? tn[1] : tn[0]) : (typeof v === 'number' && money.has(c) ? 2 : 0))).join('')); });
    if (sh.total) push(sh.total.map((v, c) => cell(c, v, typeof v === 'number' && money.has(c) ? 3 : 4)).join(''));
    const lastCol = colLetter(Math.max(0, (sh.head && sh.head.length ? sh.head : (sh.rows[0] || [])).length - 1)), lastRow = hdrRow + sh.rows.length;
    const widths = (sh.head && sh.head.length ? sh.head : (sh.rows[0] || [])).map((h, c) => { let w = String(h).length; sh.rows.slice(0, 300).forEach(row => { const v = row[c]; const l = typeof v === 'number' ? 14 : String(v == null ? '' : v).length; if (l > w) w = l; }); return Math.min(60, Math.max(9, w + 2)); });
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${sh.plain ? '' : `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${hdrRow}" topLeftCell="A${hdrRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`}<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${rows.join('')}</sheetData>${sh.rows.length && !sh.plain ? `<autoFilter ref="A${hdrRow}:${lastCol}${lastRow}"/>` : ''}${sh.plain ? '' : '<pageSetup orientation="landscape" fitToHeight="0"/>'}</worksheet>`;
  });
  const names = sheets.map(sh => {
    let n = String(sh.name || 'Sheet').replace(/[\[\]:*?\/\\]/g, ' ').trim().slice(0, 31) || 'Sheet', k = 2, base = n;
    while (usedNames.has(n.toLowerCase())){ n = base.slice(0, 28) + ' ' + k++; }
    usedNames.add(n.toLowerCase()); return n;
  });
  files.push({ name: '[Content_Types].xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` });
  files.push({ name: '_rels/.rels', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` });
  files.push({ name: 'xl/workbook.xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${xmlEsc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` });
  files.push({ name: 'xl/_rels/workbook.xml.rels', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` });
  files.push({ name: 'xl/styles.xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00;[Red]\\-#,##0.00"/></numFmts><fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts><fills count="6"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1D6B52"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE3F1EA"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFBE3E0"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF1D6"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="12"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="2" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="4" borderId="0" xfId="0" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="5" borderId="0" xfId="0" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="4" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="5" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>` });
  sheetXml.forEach((x, i) => files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, content: x }));
  return makeZip(files, asBytes);
}


/* ============ v3 additions ============ */
function calcInterest(base, o){
  const m = o.months, rt = o.rate;
  if (!o.compound && !o.threshold && !(o.rate2 !== '' && o.rate2 != null && o.changeAfter > 0 && o.changeAfter < m))
    return roundInterest(base * rt / 100 * m / 12, o.rounding);
  let b = Math.abs(base) - (o.threshold || 0); if (b <= 0) return 0;
  const sg = base < 0 ? -1 : 1;
  const segs = (o.rate2 !== '' && o.rate2 != null && o.changeAfter > 0 && o.changeAfter < m) ? [[rt, o.changeAfter], [Number(o.rate2), m - o.changeAfter]] : [[rt, m]];
  let bal = b, tot = 0;
  for (const [r, n] of segs){
    if (o.compound){ const g = bal * (Math.pow(1 + r / 1200, n) - 1); tot += g; bal += g; }
    else tot += bal * r / 100 * n / 12;
  }
  return roundInterest(sg * tot, o.rounding);
}
function ageDays(date, asOf){ if (!date || !asOf) return null; return Math.round((Date.parse(asOf) - Date.parse(date)) / 864e5); }
const AGE_BUCKETS = ['Current (0–30)', '31–60', '61–90', '91–120', '121+', 'No date'];
function ageBucket(d){ if (d == null) return 5; if (d <= 30) return 0; if (d <= 60) return 1; if (d <= 90) return 2; if (d <= 120) return 3; return 4; }
function tbChecks(co){
  const sum = round2(co.lines.reduce((a, l) => a + l.net, 0));
  const abs = co.lines.reduce((a, l) => a + Math.abs(l.net), 0);
  const tot = co.lines.filter(l => /^\W*(grand\s+)?totals?\W*$|^\W*total\b.*\b(debit|credit|dr|cr)\b/i.test(l.desc) || (l.code === '' && /total/i.test(l.desc)));
  // a single line equal to half the absolute sum of the others looks like a pasted total row
  const suspicious = co.lines.filter(l => { if (l.net === 0 || co.lines.length < 6) return false; const others = abs - Math.abs(l.net); return others > 0 && Math.abs(Math.abs(l.net) - others / 2) < 0.01 && /total|balance|sum/i.test(l.desc); });
  return { sum, balanced: Math.abs(sum) <= 0.5, totalRows: [...new Set([...tot, ...suspicious])] };
}
function extraFormats(entries, o, rows){
  const date = fmtDate(o.date, o.dateStyle), dr = e => e.amount > 0 ? e.amount.toFixed(2) : '', cr = e => e.amount < 0 ? (-e.amount).toFixed(2) : '';
  if (o.format === 'xero'){
    rows.push(['*Narration', '*Date', 'Description', '*AccountCode', '*TaxRate', '*Amount']);
    entries.forEach(e => rows.push([(o.ref + ' ' + (o.narr || '')).trim(), date, e.desc, e.account, 'Tax Exempt', e.amount.toFixed(2)]));
  } else if (o.format === 'qbo'){
    rows.push(['*JournalNo', '*JournalDate', '*AccountName', '*Debits', '*Credits', 'Description', 'Name']);
    entries.forEach(e => rows.push([o.ref, date, e.account, dr(e), cr(e), e.desc, e.tname || '']));
  } else if (o.format === 'custom'){
    const F = { period: ['Period', e => o.period], date: ['Date', e => fmtDate(e.date || o.date, o.dateStyle)], type: ['Type', () => 'G'], account: ['Account', e => e.account], ref: ['Reference', e => e.ref || o.ref], desc: ['Description', e => e.desc], debit: ['Debit', dr], credit: ['Credit', cr], amount: ['Amount', e => e.amount.toFixed(2)], contra: ['Contra account', () => o.contra], company: ['Company / line', e => e.tname || ''], other: ['Other company', e => e.tname || ''] };
    const cols = (o.custom && o.custom.length ? o.custom : ['date', 'ref', 'desc', 'account', 'debit', 'credit']).filter(k => F[k]);
    if (o.header !== false) rows.push(cols.map(k => (o.customHdr && o.customHdr[k]) || F[k][0]));
    entries.forEach(e => rows.push(cols.map(k => F[k][1](e))));
  } else return false;
  return true;
}

/* ============ PDF text extraction (text-based PDFs only) ============ */
function pdfA85(str){
  str = str.replace(/^\s*<~/, ''); const e = str.indexOf('~>'); if (e >= 0) str = str.slice(0, e);
  const out = []; let grp = [];
  for (const ch of str){ if (/\s/.test(ch)) continue; if (ch === 'z' && !grp.length){ out.push(0, 0, 0, 0); continue; } grp.push(ch.charCodeAt(0) - 33);
    if (grp.length === 5){ let v = 0; for (const d of grp) v = v * 85 + d; out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); grp = []; } }
  if (grp.length > 1){ const n = grp.length; while (grp.length < 5) grp.push(84); let v = 0; for (const d of grp) v = v * 85 + d; const b = [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]; out.push(...b.slice(0, n - 1)); }
  return Uint8Array.from(out);
}
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
    for (const x of fl){ if (x === 'FlateDecode' || x === 'Fl'){ b = await pdfInflate(b); if (!b) return null; } else if (x === 'ASCII85Decode' || x === 'A85'){ b = pdfA85(pdfLatin1(b)); } else if (x === 'ASCIIHexDecode'){ b = Uint8Array.from(pdfLatin1(b).replace(/[^0-9a-fA-F]/g, '').match(/../g) || [], h => parseInt(h, 16)); } else return null; }
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
  const nums = cells.filter(c => c.num).sort((a, b) => a.x2 - b.x2), nspans = [];
  nums.forEach(c => { const l = nspans[nspans.length - 1]; if (l && c.x2 - l.max <= 9){ l.max = c.x2; l.n++; l.sum += c.x2; l.left = Math.min(l.left, c.x); } else nspans.push({ max: c.x2, n: 1, sum: c.x2, left: c.x }); });
  nspans.forEach(sp => { sp.x = sp.sum / sp.n; });
  // short text over a numeric column (e.g. the heading "Debit") belongs to that column
  cells.forEach(c => { if (c.num || c.text.length > 18) return; let best = null, bo = 0; nspans.forEach((sp, n) => { const ov = Math.min(c.x2, sp.x + 3) - Math.max(c.x, sp.left - 3); if (ov > bo){ bo = ov; best = n; } }); if (best !== null && bo >= 0.5 * (c.x2 - c.x)) c.forceN = best; });
  const colsT = cluster(cells.filter(c => !c.num && c.forceN === undefined).map(c => c.x), 9);
  const cols = [...colsT.map(x => ({ k: 't', x })), ...nspans.map(sp => ({ k: 'n', x: sp.x }))].sort((a, b) => a.x - b.x);
  const nearest = (c) => { if (c.forceN !== undefined) return cols.findIndex(col => col.k === 'n' && col.x === nspans[c.forceN].x); let best = -1, bd = 1e9; cols.forEach((col, n) => { if (col.k !== (c.num ? 'n' : 't')) return; const d = Math.abs(col.x - (c.num ? c.x2 : c.x)); if (d < bd){ bd = d; best = n; } }); return best; };
  return rowsOut.map(r => { const out = new Array(cols.length).fill(''); r.forEach(c => { const n = nearest(c); if (n < 0) return; out[n] = out[n] ? out[n] + ' ' + c.text : c.text; }); return out; }).filter(r => r.some(x => x));
}

/* ============ export mapper ============ */
const MAP_DATES = { 'dd/mm/yyyy': 'dd/mm/yyyy', 'dd-mm-yyyy': 'dd-mm-yyyy', 'dd.mm.yyyy': 'dd.mm.yyyy', 'yyyy-mm-dd': 'yyyy-mm-dd', 'yyyy/mm/dd': 'yyyy/mm/dd', 'mm/dd/yyyy': 'mm/dd/yyyy', 'yyyymmdd': 'yyyymmdd', 'dd mmm yyyy': 'dd mmm yyyy', 'd/m/yyyy': 'd/m/yyyy', 'dd/mm/yy': 'dd/mm/yy' };
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function mapDate(iso, f){
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const [y, m, d] = iso.split('-');
  return String(f || 'dd/mm/yyyy').replace(/yyyy|yy|mmm|mm|dd|d|m/g, t => ({ yyyy: y, yy: y.slice(2), mmm: MONTH_ABBR[+m - 1], mm: m, dd: d, d: String(+d), m: String(+m) })[t]);
}
function mapNum(v, m){
  const dec = m.decimals == null ? 2 : m.decimals, neg = v < 0, a = Math.abs(v);
  let t = a.toFixed(dec); let [i, f] = t.split('.');
  if (m.thousand) i = i.replace(/\B(?=(\d{3})+(?!\d))/g, m.thousand);
  t = f ? i + (m.decSep || '.') + f : i;
  if (!neg || a === 0) return t;
  return m.neg === 'brackets' ? '(' + t + ')' : m.neg === 'trail' ? t + '-' : '-' + t;
}
const MAP_SOURCES = [
  ['Journal', [['date', 'Date'], ['period', 'Period (month number)'], ['year', 'Year'], ['month', 'Month'], ['ref', 'Journal reference'], ['company', 'Company'], ['batch', 'Journal number (1, 2, 3…)']]],
  ['Line', [['line', 'Line number'], ['desc', 'Description'], ['other', 'Linked company / line type'], ['account', 'Account (full code)'], ['acct1', 'Account – part before the separator'], ['acct2', 'Account – part after the separator'], ['contra', 'Contra account']]],
  ['Amounts', [['debit', 'Debit (positive, blank on credits)'], ['credit', 'Credit (positive, blank on debits)'], ['amount', 'Amount (debit +, credit −)'], ['amountcr', 'Amount (credit +, debit −)'], ['abs', 'Amount (always positive)'], ['drcr', 'Debit / Credit indicator']]],
  ['Other', [['text', 'Fixed text'], ['tpl', 'Combine fields (template)'], ['blank', 'Empty']]]
];
const MAP_NUMERIC = new Set(['debit', 'credit', 'amount', 'amountcr', 'abs']);
function mapCell(src, col, e, ctx, m){
  const dt = e.date || ctx.date;
  const acct = String(e.account || ''), sep = acct.search(/[\/\-.\s]/);
  const f = {
    date: () => mapDate(dt, col.fmt || m.dateFmt), period: () => String(ctx.period == null ? '' : ctx.period), year: () => (dt || '').slice(0, 4), month: () => (dt || '').slice(5, 7),
    ref: () => e.ref || ctx.ref || '', company: () => ctx.company || '', batch: () => String(ctx.batch || 1), line: () => String(e._n),
    desc: () => e.desc || '', other: () => e.tname || '', account: () => acct, acct1: () => sep < 0 ? acct : acct.slice(0, sep), acct2: () => sep < 0 ? '' : acct.slice(sep + 1),
    contra: () => e.contra || ctx.contra || '', text: () => col.val || '', blank: () => '',
    drcr: () => { const [d, c] = String(col.val || 'D|C').split('|'); return e.amount > 0 ? (d || 'D') : (c || 'C'); },
    tpl: () => String(col.val || '').replace(/\{(\w+)\}/g, (_, k) => k === 'tpl' || !f[k] ? '' : (MAP_NUMERIC.has(k) ? (() => { const v = num(k); return v === '' ? '' : mapNum(v, m); })() : f[k]())),
  };
  const num = k => k === 'debit' ? (e.amount > 0 ? e.amount : '') : k === 'credit' ? (e.amount < 0 ? -e.amount : '') : k === 'amount' ? e.amount : k === 'amountcr' ? -e.amount : Math.abs(e.amount);
  if (MAP_NUMERIC.has(src)){ const v = num(src); return v === '' ? { s: '' } : { s: mapNum(v, m), n: round2(v) }; }
  let t = f[src] ? f[src]() : '';
  if (col.case === 'upper') t = t.toUpperCase(); else if (col.case === 'lower') t = t.toLowerCase();
  if (col.len > 0) t = t.slice(0, col.len);
  return { s: t };
}
function mapJournal(entries, ctx, m){
  let list = entries.map(e => ({ ...e })), notes = [];
  if (m.only === 'debit') list = list.filter(e => e.amount > 0); else if (m.only === 'credit') list = list.filter(e => e.amount < 0);
  if (m.summarise){
    const g = new Map(); list.forEach(e => { const k = e.account + '|' + (e.contra || ''); if (!g.has(k)) g.set(k, { ...e, amount: 0 }); g.get(k).amount = round2(g.get(k).amount + e.amount); });
    list = [...g.values()];
  }
  if (m.skipZero !== false) list = list.filter(e => Math.abs(e.amount) >= 0.005);
  list.forEach((e, n) => { e._n = n + 1; });
  const rows = [];                               // each cell {s, n?}
  const sep = m.delimiter === 'semi' ? ';' : m.delimiter === 'tab' ? '\t' : m.delimiter === 'pipe' ? '|' : ',';
  const drs = round2(list.filter(e => e.amount > 0).reduce((a, e) => a + e.amount, 0)), crs = round2(list.filter(e => e.amount < 0).reduce((a, e) => a - e.amount, 0));
  const tok = line => String(line).replace(/\{(\w+)\}/g, (_, k) => ({ count: list.length, debits: mapNum(drs, m), credits: mapNum(crs, m), net: mapNum(round2(drs - crs), m), date: mapDate(ctx.date, m.dateFmt), ref: ctx.ref || '', company: ctx.company || '', period: ctx.period })[k] ?? '');
  const lines = t => String(t || '').split(/\r?\n/).filter(x => x.trim() !== '');
  lines(m.pre).forEach(l => rows.push(tok(l).split(sep).map(s => ({ s }))));
  if (m.header !== false && m.cols.length) rows.push(m.cols.map(c => ({ s: c.h || '', hdr: true })));
  list.forEach(e => rows.push(m.cols.map(c => mapCell(c.src, c, e, ctx, m))));
  lines(m.post).forEach(l => rows.push(tok(l).split(sep).map(s => ({ s }))));
  const q = c => { const t = c.s; const need = m.quoting === 'always' ? true : m.quoting === 'none' ? false : (t.includes(sep) || /["\r\n]/.test(t)); return need ? '"' + t.replace(/"/g, '""') + '"' : t; };
  const eol = m.eol === 'lf' ? '\n' : '\r\n';
  const text = rows.map(r => r.map(q).join(sep)).join(eol) + eol;
  const xlsx = m.kind === 'xlsx';
  const grid = rows.map(r => r.map(c => (xlsx && c.n !== undefined && m.xlNumbers !== false) ? c.n : c.s));
  const hasHdr = m.header !== false && m.cols.length;
  const nPre = lines(m.pre).length;
  return { rows: grid, text, xlsx, ext: xlsx ? 'xlsx' : (m.ext || (m.delimiter === 'tab' ? 'txt' : 'csv')), debits: drs, credits: crs, count: list.length, bom: m.bom !== false,
    sheet: { name: 'Journal', plain: true, head: [], rows: grid }, hasHdr };
}
function mapFileName(m, ctx){
  return String(m.fileName || '{company} journal').replace(/\{(\w+)\}/g, (_, k) => ({ company: ctx.company || '', ref: ctx.ref || '', date: ctx.date || '', yyyy: (ctx.date || '').slice(0, 4), mm: (ctx.date || '').slice(5, 7), batch: ctx.batch || 1 })[k] ?? '').replace(/[\\/:*?"<>|]+/g, ' ').trim();
}
const MAP_PRESETS = {
  pastel: { name: 'Pastel batch journal', kind: 'csv', delimiter: 'comma', header: false, dateFmt: 'dd/mm/yyyy', decimals: 2, cols: [{ h: 'Period', src: 'period' }, { h: 'Date', src: 'date' }, { h: 'Type', src: 'text', val: 'G' }, { h: 'Account', src: 'account' }, { h: 'Reference', src: 'ref' }, { h: 'Description', src: 'desc' }, { h: 'Amount', src: 'amount' }, { h: 'Contra', src: 'contra' }] },
  generic: { name: 'Generic debit / credit', kind: 'csv', delimiter: 'comma', header: true, dateFmt: 'dd/mm/yyyy', decimals: 2, cols: [{ h: 'Date', src: 'date' }, { h: 'Reference', src: 'ref' }, { h: 'Description', src: 'desc' }, { h: 'Account', src: 'account' }, { h: 'Debit', src: 'debit' }, { h: 'Credit', src: 'credit' }] },
  xero: { name: 'Xero manual journal', kind: 'csv', delimiter: 'comma', header: true, dateFmt: 'dd/mm/yyyy', decimals: 2, cols: [{ h: '*Narration', src: 'tpl', val: '{ref} {company}' }, { h: '*Date', src: 'date' }, { h: 'Description', src: 'desc' }, { h: '*AccountCode', src: 'account' }, { h: '*TaxRate', src: 'text', val: 'Tax Exempt' }, { h: '*Amount', src: 'amount' }] },
  qbo: { name: 'QuickBooks Online journal', kind: 'csv', delimiter: 'comma', header: true, dateFmt: 'dd/mm/yyyy', decimals: 2, cols: [{ h: '*JournalNo', src: 'ref' }, { h: '*JournalDate', src: 'date' }, { h: '*AccountName', src: 'account' }, { h: '*Debits', src: 'debit' }, { h: '*Credits', src: 'credit' }, { h: 'Description', src: 'desc' }, { h: 'Name', src: 'other' }] },
  excel: { name: 'Excel journal (numbers as numbers)', kind: 'xlsx', delimiter: 'comma', header: true, dateFmt: 'yyyy-mm-dd', decimals: 2, cols: [{ h: 'Date', src: 'date' }, { h: 'Ref', src: 'ref' }, { h: 'Account', src: 'account' }, { h: 'Description', src: 'desc' }, { h: 'Debit', src: 'debit' }, { h: 'Credit', src: 'credit' }] },
  split: { name: 'Account split into main + sub, signed amount', kind: 'csv', delimiter: 'semi', header: true, dateFmt: 'yyyymmdd', decimals: 2, decSep: ',', cols: [{ h: 'Date', src: 'date' }, { h: 'Batch', src: 'batch' }, { h: 'Main', src: 'acct1' }, { h: 'Sub', src: 'acct2' }, { h: 'Narrative', src: 'tpl', val: '{desc} ({other})' }, { h: 'Amount', src: 'amount' }, { h: 'D/C', src: 'drcr', val: 'D|C' }] },
  blank: { name: 'Blank – build my own', kind: 'csv', delimiter: 'comma', header: true, dateFmt: 'dd/mm/yyyy', decimals: 2, cols: [{ h: 'Date', src: 'date' }, { h: 'Account', src: 'account' }, { h: 'Amount', src: 'amount' }] }
};
function mapDefaults(){ return { id: '', name: '', kind: 'csv', delimiter: 'comma', quoting: 'auto', bom: true, eol: 'crlf', header: true, dateFmt: 'dd/mm/yyyy', decimals: 2, decSep: '.', thousand: '', neg: 'minus', only: 'all', skipZero: true, summarise: false, fileName: '{company} journal', pre: '', post: '', cols: [] }; }

if (typeof module !== 'undefined') module.exports = { norm, tokens, cleanName, buildMatcher, buildModel, parseTBGrid, parseTBText, splitDelimited, parseNum, readZip, readWorkbookSheets, makeZip, roundInterest, buildJournalCSV, lineKey, groupOf, round2, aliasTexts, isHeaderLine, defaultAccounts, fmtDate, parseDate, guessLedgerMap, buildLedger, matchLedgers, makeXlsx, calcInterest, mapJournal, mapFileName, mapDefaults, MAP_PRESETS, MAP_SOURCES, MAP_DATES, mapDate, mapNum, ageDays, ageBucket, AGE_BUCKETS, tbChecks, pdfToGrid };
// </ENGINE>
