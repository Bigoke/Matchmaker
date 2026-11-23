
/* =====================================================================
   Matchmaker v3 – undo, audit trail, memory, comparison, checks,
   correcting journals, ageing, export layouts
   ===================================================================== */
const LOGO = `<svg class="logo" viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="mmgA" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--lg1)"/><stop offset="1" style="stop-color:var(--lg2)"/></linearGradient><clipPath id="mmcA"><circle cx="24" cy="32" r="14"/></clipPath></defs><rect width="64" height="64" rx="15" fill="url(#mmgA)"/><circle cx="24" cy="32" r="14" fill="none" stroke="#fff" stroke-width="3.4"/><circle cx="40" cy="32" r="14" fill="none" stroke="#fff" stroke-width="3.4"/><circle cx="40" cy="32" r="14" fill="#f4b942" clip-path="url(#mmcA)"/><path d="M26.2 32.4l4.2 4.2 7.6-8.6" fill="none" style="stroke:var(--lg2)" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/* ---------- undo + audit ---------- */
function snap(label){
  ui.undo.push({ label, ov: JSON.stringify(state.overrides), man: JSON.stringify(state.ledger.manual), rej: JSON.stringify(state.ledger.rejected), fix: JSON.stringify(state.fix), mem: JSON.stringify(MEM) });
  if (ui.undo.length > 60) ui.undo.shift();
}
function undo(){
  const s = ui.undo.pop(); if (!s){ toast('Nothing to undo'); return; }
  state.overrides = JSON.parse(s.ov); state.ledger.manual = JSON.parse(s.man); state.ledger.rejected = JSON.parse(s.rej); state.fix = JSON.parse(s.fix); MEM = JSON.parse(s.mem); memSave();
  ui.lsel = { A: new Set(), B: new Set() };
  audit('Undo: ' + s.label); dirty(); render(); if (ui.pair) $('#dlg').innerHTML = pairDialogHTML(); toast('Undid: ' + s.label);
}
function audit(m){ state.audit.push({ t: new Date().toISOString(), m }); if (state.audit.length > 3000) state.audit.splice(0, 500); save(); }
function auditView(){
  const rows = state.audit.slice().reverse().map(e => `<tr><td class="nowrap small">${esc(e.t.slice(0, 10))} ${esc(e.t.slice(11, 19))}</td><td>${esc(e.m)}</td></tr>`).join('');
  return `<div class="note" style="margin-bottom:12px">Every manual decision – assignments, matches, ignores, rate changes, project saves – is recorded here and included in the exported reports.</div>
    <div class="card scroll"><table class="t"><thead><tr><th style="width:170px">When</th><th>What</th></tr></thead><tbody>${rows || '<tr><td colspan="2" class="empty">Nothing recorded yet.</td></tr>'}</tbody></table></div>`;
}

/* ---------- remembered decisions (kept in this browser across projects) ---------- */
const MEM_KEY = 'matchmaker.memory.v1';
let MEM = (() => { try { return Object.assign({ tb: {}, ledger: [] }, JSON.parse(localStorage.getItem(MEM_KEY) || '{}')); } catch (e) { return { tb: {}, ledger: [] }; } })();
function memSave(){ try { localStorage.setItem(MEM_KEY, JSON.stringify(MEM)); } catch (e) {} }
function memTB(nd, val){
  if (!nd) return;
  if (val === 'auto') delete MEM.tb[nd]; else if (val === 'ignore') MEM.tb[nd] = { ignore: true };
  else { const c = state.companies.find(x => x.id === val); if (c) MEM.tb[nd] = { name: c.name }; }
  memSave();
}
function memApplyTB(){
  const keys = Object.keys(MEM.tb); if (!keys.length) return 0;
  const descs = new Set(); state.companies.forEach(c => c.lines.forEach(l => descs.add(norm(l.desc))));
  const byName = new Map(state.companies.map(c => [norm(c.name), c])); let n = 0;
  for (const nd of keys){
    const key = 'd:' + nd; if (state.overrides[key] !== undefined || !descs.has(nd)) continue;
    const e = MEM.tb[nd];
    if (e.ignore){ state.overrides[key] = 'ignore'; n++; }
    else { const c = byName.get(norm(e.name)); if (c){ state.overrides[key] = c.id; n++; } }
  }
  if (n){ audit(`${n} remembered assignments applied`); dirty(); }
  return n;
}
const ikey = x => { const r = norm(x.ref); return r ? 'r:' + r : 'd:' + norm(x.desc); };
function memLedgerAdd(A, B, ai, bi){
  const rule = { a: ai.map(i => ikey(A[i])), b: bi.map(j => ikey(B[j])) };
  const s = JSON.stringify(rule); if (MEM.ledger.some(r => JSON.stringify(r) === s)) return;
  MEM.ledger.push(rule); if (MEM.ledger.length > 3000) MEM.ledger.shift(); memSave();
}
function memLedgerManual(A, B, manual, rejected){
  if (!MEM.ledger.length) return [];
  const used = { A: new Set(), B: new Set() }; manual.forEach(m => { m.a.forEach(i => used.A.add(i)); m.b.forEach(j => used.B.add(j)); });
  const idxA = new Map(), idxB = new Map();
  A.forEach((x, i) => { if (!used.A.has(i)){ const k = ikey(x); if (!idxA.has(k)) idxA.set(k, []); idxA.get(k).push(i); } });
  B.forEach((x, j) => { if (!used.B.has(j)){ const k = ikey(x); if (!idxB.has(k)) idxB.set(k, []); idxB.get(k).push(j); } });
  const rej = new Set(rejected || []), out = [], sgn = state.ledger.mirror ? -1 : 1, tol = Math.round((state.ledger.opts.tol || 0) * 100);
  for (const r of MEM.ledger){
    const pa = [], pb = [];
    const take = (keys, idx, dst) => keys.every(k => { const l = (idx.get(k) || []).filter(i => !used[idx === idxA ? 'A' : 'B'].has(i) && !dst.includes(i)); if (!l.length) return false; dst.push(l[0]); return true; });
    if (!take(r.a, idxA, pa) || !take(r.b, idxB, pb)) continue;
    if (pa.some(i => pb.some(j => rej.has(i + '|' + j)))) continue;
    const refBased = r.a.concat(r.b).every(k => k[0] === 'r');
    const sa = Math.round(pa.reduce((s, i) => s + A[i].amt, 0) * 100), sb = Math.round(pb.reduce((s, j) => s + B[j].amt * sgn, 0) * 100);
    if (!refBased && Math.abs(sa - sb) > tol) continue;
    pa.forEach(i => used.A.add(i)); pb.forEach(j => used.B.add(j));
    out.push({ a: pa, b: pb, method: 'Remembered match', conf: 95 });
  }
  return out;
}
function memCardHTML(){
  const n1 = Object.keys(MEM.tb).length, n2 = MEM.ledger.length, n3 = Object.keys((MEM.ocr || {}).cell || {}).length, n4 = Object.keys(MEM.lay || {}).length;
  return `<div class="card pad" style="margin-top:22px"><div class="row"><div class="grow" style="flex:1"><b>Matchmaker remembers your decisions</b><div class="small muted">${n1} company assignment${n1 === 1 ? '' : 's'} and ${n2} ledger match${n2 === 1 ? '' : 'es'} are applied automatically the next time you load similar data${n3 || n4 ? `, plus ${n3} scan correction${n3 === 1 ? '' : 's'} and ${n4} statement layout${n4 === 1 ? '' : 's'}` : ''} (kept only in this browser).</div></div>
    <button class="btn sm" data-act="memforget" ${n1 + n2 + n3 + n4 ? '' : 'disabled'}>Forget all</button></div></div>`;
}

/* ---------- comparison with a previous period ---------- */
function scaleCos(cos){ return cos.map(c => { const r = coRate(c); return r === 1 ? c : { ...c, lines: c.lines.map(l => ({ ...l, net: round2(l.net * r), dr: round2((l.dr || 0) * r), cr: round2((l.cr || 0) * r) })) }; }); }
const scaledSide = S => { const r = parseFloat(S.rate); return r > 0 && r !== 1 ? S.items.map(x => ({ ...x, amt: round2(x.amt * r) })) : S.items; };
const itemKey = x => `${x.date}|${norm(x.ref)}|${x.amt}`;
function summariseState(st){
  const out = { name: (st.project && st.project.name) || '', at: new Date().toISOString().slice(0, 10) };
  if (st.companies && st.companies.length){
    const cos = st.companies, m = buildModel(scaleCos(cos), st.overrides || {}, { ...DEF_SETTINGS, ...(st.settings || {}) });
    out.tb = m.pairs.map(p => ({ a: cos[p.i].name, b: cos[p.j].name, key: [norm(cos[p.i].name), norm(cos[p.j].name)].sort().join('|'), diff: p.diff, status: p.status }));
  }
  const L = st.ledger;
  if (L && L.A.items.length && L.B.items.length){
    const A = scaledSide(L.A), B = scaledSide(L.B), R = matchLedgers(A, B, { tol: L.opts.tol, days: L.opts.days, grouped: L.opts.grouped, mirror: L.mirror, manual: L.manual, rejected: L.rejected });
    out.ledger = { unA: R.unA.map(i => ({ k: itemKey(A[i]), date: A[i].date, ref: A[i].ref, desc: A[i].desc, amt: A[i].amt })), unB: R.unB.map(j => ({ k: itemKey(B[j]), date: B[j].date, ref: B[j].ref, desc: B[j].desc, amt: B[j].amt })), total: round2(R.sumA - R.sumB) };
  }
  return out;
}
function baselineCard(){
  const tbOk = state.mode === 'tb' && ui.tab === 'recon' && state.companies.length, lOk = state.mode === 'ledger' && ui.tab === 'lres' && ui.lsub === 'sum' && state.ledger.A.items.length && state.ledger.B.items.length;
  if (!tbOk && !lOk) return '';
  const b = state.baseline;
  if (!b) return `<div class="card pad dashed" style="margin-bottom:14px"><div class="row"><div class="grow" style="flex:1"><b>Compare with the previous period</b><div class="small muted">Open last month’s Matchmaker project file to see which differences were cleared, which are new and which are still open.</div></div><button class="btn" data-act="basepick">Open previous project…</button></div></div>`;
  let body = '';
  if (tbOk && b.tb){
    const cur = new Map(model().pairs.map(p => [[norm(coName(p.i)), norm(coName(p.j))].sort().join('|'), p]));
    const prev = new Map(b.tb.map(p => [p.key, p])); const keys = new Set([...cur.keys(), ...prev.keys()]); const rows = [];
    const cnt = { Cleared: 0, New: 0, Improved: 0, Worse: 0, Unchanged: 0 };
    keys.forEach(k => {
      const c = cur.get(k), p = prev.get(k), cd = c && c.status !== 'agree' ? c.diff : 0, pd = p && p.status !== 'agree' ? p.diff : 0;
      if (!cd && !pd) return;
      const st = !cd ? 'Cleared' : !pd ? 'New' : Math.abs(cd) < Math.abs(pd) - 0.005 ? 'Improved' : Math.abs(cd) > Math.abs(pd) + 0.005 ? 'Worse' : 'Unchanged';
      cnt[st]++; rows.push({ name: c ? coName(c.i) + ' ↔ ' + coName(c.j) : p.a + ' ↔ ' + p.b, pd, cd, st });
    });
    rows.sort((x, y) => Math.abs(y.cd || y.pd) - Math.abs(x.cd || x.pd));
    ui.baseRows = rows;
    const cls = { Cleared: 'ok', New: 'bad', Worse: 'bad', Improved: 'warn', Unchanged: 'mut' };
    body = `<div class="small" style="margin:8px 0">${Object.entries(cnt).map(([k, n]) => `<span class="chip ${cls[k]}">${k}: ${n}</span>`).join(' ')}</div>
      <div class="scroll" style="max-height:260px"><table class="t"><thead><tr><th>Pair</th><th class="num">Previous difference</th><th class="num">Now</th><th>Change</th></tr></thead><tbody>${rows.slice(0, 200).map(r => `<tr><td>${esc(short(r.name, 70))}</td><td class="num">${amt(r.pd)}</td><td class="num">${amt(r.cd)}</td><td><span class="chip ${cls[r.st]}">${r.st}</span></td></tr>`).join('') || '<tr><td colspan="4" class="empty">No differences in either period.</td></tr>'}</tbody></table></div>`;
  } else if (lOk && b.ledger){
    const D = ledgerSummaryData(), R = D.R, A = R.A, B = R.B;
    const nowA = new Map(R.unA.map(i => [itemKey(A[i]), A[i]])), nowB = new Map(R.unB.map(j => [itemKey(B[j]), B[j]]));
    const pA = new Map(b.ledger.unA.map(x => [x.k, x])), pB = new Map(b.ledger.unB.map(x => [x.k, x]));
    const carried = [], isNew = [], resolved = [];
    [['A', nowA, pA], ['B', nowB, pB]].forEach(([s, now, prev]) => { now.forEach((x, k) => (prev.has(k) ? carried : isNew).push({ s, x })); prev.forEach((x, k) => { if (!now.has(k)) resolved.push({ s, x }); }); });
    const sumc = round2(carried.reduce((a, r) => a + r.x.amt, 0));
    body = `<div class="small" style="margin:8px 0"><span class="chip warn">Carried forward: ${carried.length} (${fmt(sumc)})</span> <span class="chip bad">New: ${isNew.length}</span> <span class="chip ok">Resolved since: ${resolved.length}</span> <span class="muted">Previous unreconciled balance: ${fmt(b.ledger.total)} → now ${fmt(D.total)}</span></div>
      ${carried.length ? `<div class="scroll" style="max-height:220px"><table class="t"><thead><tr><th>List</th><th>Item still open from the previous period</th><th class="num">Amount</th></tr></thead><tbody>${carried.slice(0, 150).map(r => `<tr><td>${esc(short(r.s === 'A' ? state.ledger.A.label || 'A' : state.ledger.B.label || 'B', 20))}</td><td class="small">${fmtD(r.x.date)} ${esc(r.x.ref)} ${esc(short(r.x.desc, 50))}</td><td class="num">${amt(r.x.amt)}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
  } else body = '<div class="small muted">The previous project file has no data of this kind to compare with.</div>';
  return `<div class="card pad" style="margin-bottom:14px"><div class="row" style="justify-content:space-between"><h3 style="font-size:15px">Since ${esc(b.name || 'the previous period')} <span class="muted small">(${esc(b.at)})</span></h3><div class="row"><button class="btn sm" data-act="basepick">Use another file</button><button class="btn sm" data-act="baseclear">Remove</button></div></div>${body}</div>`;
}
async function loadBaseline(file){
  try {
    const s = JSON.parse(await file.text()); if (!s.companies) throw new Error('x');
    state.baseline = summariseState(normState(s)); if (!state.baseline.name) state.baseline.name = file.name.replace(/\.matchmaker\.json$|\.json$/i, '');
    audit('Compared with previous period: ' + state.baseline.name); dirty(); render(); toast('Comparison loaded');
  } catch (e){ toast('That file is not a Matchmaker project.'); }
}

/* ---------- trial balance checks ---------- */
function tbIssueTag(c){ const k = tbChecks(c); return (!k.balanced || k.totalRows.length) ? '<span class="tag" style="background:var(--bad-bg);color:var(--bad)" title="This trial balance does not add up to nil or contains a total row">⚠ check</span>' : ''; }
function tbBanner(co){
  const k = tbChecks(co); let h = '';
  if (!k.balanced) h += `<div class="note warn" style="margin-bottom:8px"><b>This trial balance does not add up to nil</b> – debits less credits is <b>${fmt(k.sum)}</b>. Some rows may be missing from the paste, or it may include a total line. (Loan reconciliation is not affected unless the missing rows are loan accounts.)</div>`;
  if (k.totalRows.length) h += `<div class="note bad" style="margin-bottom:8px"><b>Possible total row${k.totalRows.length > 1 ? 's' : ''} included:</b> ${k.totalRows.map(l => esc(l.desc || l.code) + ' (' + fmt(l.net) + ')').join(', ')} <button class="btn sm" data-act="droptotals" style="margin-left:8px">Remove ${k.totalRows.length > 1 ? 'them' : 'it'}</button></div>`;
  return h ? `<div style="margin-bottom:14px">${h}</div>` : '';
}

/* ---------- review: bulk accept + keyboard ---------- */
function suggestionFor(r){
  const R = ui.review, min = (R.minPct || 90) / 100;
  if (r.status === 'ambiguous') return -1;
  if (r.target >= 0) return r.status === 'auto' && r.score >= min ? r.target : -1;
  const t = r.cands[0]; return t && t.s >= min && !(r.cands[1] && t.s - r.cands[1].s < state.settings.ambiguity) ? t.j : -1;
}
function reviewBulkHTML(rows){
  const R = ui.review; if (!rows.length || !['todo', 'auto'].includes(R.filter)) return '';
  const n = rows.filter(x => suggestionFor(x.r) >= 0).length;
  return `<span class="small muted" style="margin-left:auto">Accept suggestions ≥ <input type="number" min="30" max="100" value="${R.minPct}" data-change="revmin" style="width:58px;display:inline-block;padding:3px 6px">%</span>
    <button class="btn sm primary" data-act="revaccept" ${n ? '' : 'disabled'} title="Confirms the closest company for every listed line at or above this score">Accept all (${n})</button><span class="small muted">↑↓ move · Enter accept · I ignore</span>`;
}
function acceptRow(x){ const t = suggestionFor(x.r); if (t < 0) return false; state.overrides['d:' + norm(x.ln.desc)] = state.companies[t].id; memTB(norm(x.ln.desc), state.companies[t].id); return true; }
function reviewKey(e){
  if (ui.tab !== 'review' || $('#dlg').open) return false;
  const t = e.target; if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return false;
  const rows = reviewRows().slice(0, 400), R = ui.review; if (!rows.length) return false;
  const k = e.key.toLowerCase();
  if (k === 'arrowdown' || k === 'j'){ R.cur = Math.min(rows.length - 1, R.cur + 1); ui.scrollCur = true; render(); return true; }
  if (k === 'arrowup' || k === 'k'){ R.cur = Math.max(0, R.cur - 1); ui.scrollCur = true; render(); return true; }
  R.cur = Math.min(R.cur, rows.length - 1);
  const x = rows[R.cur];
  if (k === 'enter' || k === 'a'){
    const tj = x.r.target >= 0 ? x.r.target : (x.r.cands[0] && x.r.cands[0].s >= 0.3 ? x.r.cands[0].j : -1); if (tj < 0){ toast('No suggestion for this line'); return true; }
    snap('Accept “' + short(x.ln.desc, 30) + '”'); state.overrides['d:' + norm(x.ln.desc)] = state.companies[tj].id; memTB(norm(x.ln.desc), state.companies[tj].id); audit(`Accepted “${x.ln.desc}” → ${coName(tj)}`);
    dirty(); ui.scrollCur = true; render(); return true;
  }
  if (k === 'i'){ snap('Ignore “' + short(x.ln.desc, 30) + '”'); state.overrides['d:' + norm(x.ln.desc)] = 'ignore'; memTB(norm(x.ln.desc), 'ignore'); audit(`Ignored “${x.ln.desc}” as not a group company`); dirty(); ui.scrollCur = true; render(); return true; }
  return false;
}

/* ---------- journal checks + custom columns ---------- */
const CUSTOM_FIELDS = { period: 'Period', date: 'Date', type: 'Type (G)', account: 'Account', ref: 'Reference', desc: 'Description', debit: 'Debit', credit: 'Credit', amount: 'Amount (+/−)', contra: 'Contra account', company: 'Line / company' };
function customColsHTML(){
  const S = state.settings;
  return `<div class="field"><label>Columns, in order</label><div class="chips">${S.custom.map(k => `<span class="chipx on"><button data-act="ccol" data-k="${k}" data-d="-1" title="Move left">◀</button>${CUSTOM_FIELDS[k]}<button data-act="ccol" data-k="${k}" data-d="1" title="Move right">▶</button><button data-act="ccol" data-k="${k}" data-d="0" title="Remove">✕</button></span>`).join('') || '<span class="muted small">none</span>'}</div>
    <div class="chips" style="margin-top:6px">${Object.keys(CUSTOM_FIELDS).filter(k => !S.custom.includes(k)).map(k => `<button class="chipx" data-act="ccol" data-k="${k}" data-d="add">＋ ${CUSTOM_FIELDS[k]}</button>`).join('')}</div></div>`;
}
function journalChecks(entries, o){
  const c = [], add = (ok, t) => c.push({ ok, t });
  const sum = round2(entries.reduce((a, e) => a + e.amount, 0));
  add(entries.length > 0 ? 'pass' : 'fail', entries.length ? `${entries.length} journal lines` : 'The journal has no lines');
  add(Math.abs(sum) < 0.005 ? 'pass' : 'fail', Math.abs(sum) < 0.005 ? 'Debits equal credits' : `Journal does not balance – out by ${fmt(sum)}`);
  const noAcc = entries.filter(e => !String(e.account || '').trim()).length;
  add(noAcc ? 'fail' : 'pass', noAcc ? `${noAcc} line(s) have no account code – fill in the interest / contra accounts` : 'Every line has an account code');
  add(entries.some(e => e.amount === 0) ? 'fail' : 'pass', entries.some(e => e.amount === 0) ? 'There are zero-value lines' : 'No zero-value lines');
  add(/^\d{4}-\d{2}-\d{2}$/.test(o.date || '') ? 'pass' : 'fail', /^\d{4}-\d{2}-\d{2}$/.test(o.date || '') ? `Journal date ${fmtDate(o.date, state.settings.dateStyle)}` : 'No journal date – set one (the period end is used when blank)');
  add(String(o.ref || '').trim() ? (String(o.ref).length > 15 ? 'warn' : 'pass') : 'fail', !String(o.ref || '').trim() ? 'No reference' : String(o.ref).length > 15 ? `Reference “${o.ref}” is ${String(o.ref).length} characters – some packages cut it short` : `Reference “${o.ref}”`);
  if (state.settings.format === 'pastel') add(o.period >= 1 && o.period <= 13 ? 'pass' : 'fail', `Period ${o.period} (must be 1–13)`);
  const long = entries.filter(e => String(e.desc || '').length > 60).length; if (long) add('warn', `${long} description(s) longer than 60 characters`);
  return c;
}
function checksHTML(list, note){
  const ic = { pass: '✓', warn: '!', fail: '✕' };
  return `<ul class="checks">${list.map(x => `<li class="${x.ok}"><b>${ic[x.ok]}</b> ${esc(x.t)}</li>`).join('')}</ul>${note || ''}`;
}
function jChecksHTML(J, csv){
  const list = journalChecks(J.entries, { date: J.date, ref: J.ref, period: J.period });
  const first = csv ? csv.split('\r\n')[0] : '';
  return `<div class="card pad noprint" style="margin-bottom:16px"><div class="row" style="justify-content:space-between"><h3 style="font-size:15px">Import checklist</h3><button class="btn sm" data-act="jtest" ${J.entries.length ? '' : 'disabled'} title="Downloads a two-line journal for 0.01 using your first account and contra account">⬇ 1-cent test file</button></div>
    ${checksHTML(list, `<p class="small muted" style="margin:8px 0 0">First line of the file: <span class="mono">${esc(first)}</span><br>The layouts are built from each package’s published import templates. Before importing a real batch, import the <b>1-cent test file</b> once and check it lands as expected – then reverse it.</p>`)}</div>`;
}

/* ---------- correcting journals: trial balances ---------- */
function fixKey(p){ return state.companies[p.i].id + '|' + state.companies[p.j].id; }
function fixData(){
  const m = model(), S = state.settings, cos = state.companies, rows = [], byCo = new Map();
  m.pairs.filter(p => p.status !== 'agree').forEach(p => {
    const key = fixKey(p), f = state.fix[key] || {};
    const side = f.side || (p.status === 'onesided' ? (p.aHas ? 'j' : 'i') : 'j'), x = side === 'i' ? p.i : p.j, y = side === 'i' ? p.j : p.i;
    const lines = m.bal[x][y].lines.map(k => cos[x].lines[k]).sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
    const acct = f.acct !== undefined && f.acct !== '' ? f.acct : (lines[0] ? lines[0].code : '');
    const amount = f.amt !== undefined && f.amt !== '' ? Number(f.amt) : round2(-p.diff / coRate(cos[x]));
    const on = f.on !== undefined ? f.on : false;
    rows.push({ p, key, side, x, y, acct, amount, on, lines });
    if (on && amount !== 0){ if (!byCo.has(x)) byCo.set(x, []); byCo.get(x).push({ account: acct, desc: ((S.fixDesc || 'Correction') + ' - ' + cos[y].name).slice(0, 60), amount, tname: cos[y].name }); }
  });
  const J = [];
  byCo.forEach((ents, x) => {
    const co = cos[x], jr = jrOf(co), def = defaultAccounts((ents[0].account || '0'));
    const contra = S.fixContra || def.contra, date = (state.fix._date) || co.periodEnd || cos.map(c => c.periodEnd || '').sort().pop() || '';
    const total = round2(ents.reduce((a, e) => a + e.amount, 0));
    const entries = ents.concat([{ account: contra, desc: S.fixDesc || 'Correction', amount: -total, tname: 'Difference / suspense' }]);
    const yyyy = date ? date.slice(0, 4) : String(new Date().getFullYear());
    const ref = (S.fixRef || 'ADJ{nn}').replace(/\{yyyy\}/g, yyyy).replace(/\{yy\}/g, yyyy.slice(2)).replace(/\{nn\}/g, String(x + 1).padStart(2, '0'));
    const period = jr.period || derivedPeriod(co);
    const out = jOut(entries, { format: S.format, header: S.header, dateStyle: S.dateStyle, date, period, ref, contra, delimiter: S.delimiter, custom: S.custom, narr: co.name, batch: x + 1 });
    J.push({ x, co, entries, contra, date, ref, period, csv: out.text, out });
  });
  return { rows, J };
}
function fixView(){
  const cos = state.companies; if (!cos.length) return emptyState();
  const S = state.settings, { rows, J } = fixData();
  const tr = rows.map(r => `<tr><td><input type="checkbox" ${r.on ? 'checked' : ''} data-change="fixset" data-key="${esc(r.key)}" data-f="on"></td>
    <td>${esc(short(coName(r.p.i), 26))} <span class="muted">↔</span> ${esc(short(coName(r.p.j), 26))}${r.p.status === 'onesided' ? ' <span class="chip warn">one side only</span>' : ''}</td><td class="num">${amt(r.p.a)}</td><td class="num">${amt(r.p.b)}</td><td class="num"><b>${amt(r.p.diff)}</b></td>
    <td><select data-change="fixset" data-key="${esc(r.key)}" data-f="side"><option value="i" ${r.side === 'i' ? 'selected' : ''}>${esc(short(coName(r.p.i), 24))}</option><option value="j" ${r.side === 'j' ? 'selected' : ''}>${esc(short(coName(r.p.j), 24))}</option></select></td>
    <td><input class="cell" style="width:110px" type="text" value="${esc(r.acct)}" placeholder="account" list="acl${r.x}" data-change="fixset" data-key="${esc(r.key)}" data-f="acct"><datalist id="acl${r.x}">${r.lines.map(l => `<option value="${esc(l.code)}">${esc(l.desc)}</option>`).join('')}</datalist></td>
    <td><input class="cell" style="width:110px" type="number" step="0.01" value="${r.amount}" data-change="fixset" data-key="${esc(r.key)}" data-f="amt"></td></tr>`).join('');
  const list = J.flatMap(j => journalChecks(j.entries, { date: j.date, ref: j.ref, period: j.period }).map(c => ({ ...c, t: short(j.co.name, 24) + ': ' + c.t }))).filter(c => c.ok !== 'pass');
  const prev = J.map(j => `<div class="card pad" style="margin-bottom:10px"><div class="row" style="justify-content:space-between"><b>${esc(j.co.name)}</b><span class="small muted">${esc(j.ref)} · ${esc(fmtDate(j.date, 'dmy'))}</span><button class="btn sm" data-act="fixdl" data-x="${j.x}">⬇ CSV</button></div>
    <table class="t"><tbody>${j.entries.map(e => `<tr><td class="mono">${esc(e.account)}</td><td>${esc(short(e.desc, 60))}</td><td class="num">${e.amount > 0 ? fmt(e.amount) : ''}</td><td class="num">${e.amount < 0 ? fmt(-e.amount) : ''}</td></tr>`).join('')}</tbody></table></div>`).join('');
  return `<div class="note" style="margin-bottom:14px">For each loan pair that does not agree, choose <b>which company to adjust</b> and the loan account to post to. The journal moves that company’s loan balance so the pair agrees, and the other side of each line goes to a difference / suspense account. Tick the pairs you want, check the preview, then download.</div>
    <div class="card pad" style="margin-bottom:14px"><div class="grid3"><div class="field"><label>Difference / suspense account</label><input type="text" value="${esc(S.fixContra)}" placeholder="${esc(defaultAccounts((rows[0] && rows[0].acct) || '0').contra)}" data-change="fixopt" data-k="fixContra"></div>
      <div class="field"><label>Journal date</label><input type="date" value="${esc(state.fix._date || '')}" data-change="fixopt" data-k="_date"><span class="small muted">Blank = each company’s period end</span></div>
      <div class="field"><label>Reference</label><input type="text" value="${esc(S.fixRef)}" data-change="fixopt" data-k="fixRef"><span class="small muted">{nn} = company no., {yy} = year</span></div></div>
      <div class="field"><label>Description</label><input type="text" value="${esc(S.fixDesc)}" data-change="fixopt" data-k="fixDesc"></div>
      <p class="small muted" style="margin:0">The CSV layout, date format and separator are the ones chosen on the Interest journals tab.</p></div>
    <div class="toolbar"><div class="seg"><button data-act="fixsel" data-v="all">Tick all</button><button data-act="fixsel" data-v="none">Tick none</button></div><span class="muted small">${rows.length} pairs need attention</span>
      <button class="btn primary" style="margin-left:auto" data-act="fixzip" ${J.length ? '' : 'disabled'}>⬇ Download ${J.length > 1 ? 'all (.zip)' : 'CSV'}</button></div>
    <div class="card scroll" style="margin-bottom:14px"><table class="t"><thead><tr><th></th><th>Pair</th><th class="num">Balance A</th><th class="num">Balance B</th><th class="num">Difference</th><th>Adjust company</th><th>Loan account</th><th class="num">Post amount (Dr + / Cr −)</th></tr></thead><tbody>${tr || '<tr><td colspan="8" class="empty">Every loan pair agrees – nothing to correct. 🎉</td></tr>'}</tbody></table></div>
    ${J.length ? `<h3 style="margin:0 0 8px;font-size:15px">Journal preview</h3>${list.length ? `<div class="card pad" style="margin-bottom:10px">${checksHTML(list)}</div>` : ''}${prev}` : ''}`;
}

/* ---------- correcting journal: ledgers ---------- */
function ledgerJournalData(D){
  const L = D.L, R = D.R, S = state.settings; const jr = L.jr = L.jr || { books: 'B', acct: '', contra: '', ref: 'ADJ1', missing: true, diffs: true, on: {} };
  const sgn = L.mirror ? -1 : 1, booksA = jr.books === 'A', acct = jr.acct || '', contra = jr.contra || '';
  const items = [];
  if (jr.missing){
    if (!booksA) R.unA.forEach(i => items.push({ id: 'mA' + i, kind: 'Missing from ' + (L.B.label || 'B'), x: D.A[i], adj: round2(D.A[i].amt * sgn) }));
    else R.unB.forEach(j => items.push({ id: 'mB' + j, kind: 'Missing from ' + (L.A.label || 'A'), x: D.B[j], adj: round2(R.effB[j]) }));
  }
  if (jr.diffs) D.mD.forEach((m, n) => { const x = !booksA ? D.B[m.b[0]] : D.A[m.a[0]]; items.push({ id: 'd' + m.a.join('_') + '-' + m.b.join('_'), kind: 'Amount differs', x: { ...x, desc: 'Adjust: ' + x.desc }, adj: round2(!booksA ? m.diff * sgn : -m.diff) }); });
  items.forEach(it => { it.on = jr.on[it.id] !== false; });
  const entries = [];
  items.filter(it => it.on && it.adj !== 0).forEach(it => {
    const d = (it.kind.startsWith('Missing') ? 'Missing: ' : '') + it.x.desc;
    entries.push({ account: acct, desc: d.slice(0, 60), amount: it.adj, date: it.x.date, ref: it.x.ref || jr.ref, tname: '' });
    entries.push({ account: contra, desc: d.slice(0, 60), amount: -it.adj, date: it.x.date, ref: it.x.ref || jr.ref, tname: '' });
  });
  const date = (entries.find(e => e.date) || {}).date || new Date().toISOString().slice(0, 10);
  const out = entries.length ? jOut(entries, { format: S.format, header: S.header, dateStyle: S.dateStyle, date, period: Number(date.slice(5, 7)) || 1, ref: jr.ref || 'ADJ', contra, delimiter: S.delimiter, custom: S.custom, narr: 'Ledger correction', batch: 1 }) : null;
  return { jr, items, entries, csv: out ? out.text : '', out, date };
}
function lJournal(D){
  const L = D.L, J = ledgerJournalData(D), jr = J.jr, S = state.settings;
  const checks = journalChecks(J.entries, { date: J.date, ref: jr.ref, period: Number(J.date.slice(5, 7)) || 1 });
  const tr = J.items.map(it => `<tr><td><input type="checkbox" ${it.on ? 'checked' : ''} data-change="ljon" data-id="${esc(it.id)}"></td><td><span class="chip ${it.kind.startsWith('Missing') ? 'warn' : 'bad'}">${esc(it.kind)}</span></td><td class="small">${fmtD(it.x.date)} ${esc(it.x.ref)} ${esc(short(it.x.desc, 50))}</td><td class="num">${amt(it.adj)}</td></tr>`).join('');
  const opt = (v, t, c) => `<option value="${v}" ${c === v ? 'selected' : ''}>${t}</option>`;
  return `<div class="note" style="margin-bottom:12px">Draft a journal for <b>your own books</b> that would clear the differences: items that are on the other list but missing from yours, and amounts that differ. Items that are only in your books are left out – those are queries for the other party.</div>
    <div class="card pad" style="margin-bottom:14px"><div class="grid3">
      <div class="field"><label>Post the journal in</label><select data-change="ljopt" data-k="books">${opt('B', esc(L.B.label || 'List B'), jr.books)}${opt('A', esc(L.A.label || 'List A'), jr.books)}</select></div>
      <div class="field"><label>Ledger account code</label><input type="text" value="${esc(jr.acct)}" placeholder="e.g. 2000/000" data-change="ljopt" data-k="acct"></div>
      <div class="field"><label>Contra / suspense account</label><input type="text" value="${esc(jr.contra)}" placeholder="e.g. 9990/000" data-change="ljopt" data-k="contra"></div></div>
      <div class="row"><label class="chk"><input type="checkbox" ${jr.missing ? 'checked' : ''} data-change="ljopt" data-k="missing"> Include missing items</label><label class="chk"><input type="checkbox" ${jr.diffs ? 'checked' : ''} data-change="ljopt" data-k="diffs"> Include amount differences</label>
      <label class="small">Reference if none <input type="text" value="${esc(jr.ref)}" data-change="ljopt" data-k="ref" style="width:90px;display:inline-block;padding:3px 6px"></label></div></div>
    <div class="card scroll" style="margin-bottom:14px"><table class="t"><thead><tr><th></th><th>Why</th><th>Item</th><th class="num">Post to ledger (Dr + / Cr −)</th></tr></thead><tbody>${tr || '<tr><td colspan="4" class="empty">Nothing to correct.</td></tr>'}</tbody></table></div>
    <div class="card pad"><div class="row" style="justify-content:space-between"><h3 style="font-size:15px">Checklist</h3><button class="btn primary" data-act="ljdl" ${J.entries.length ? '' : 'disabled'}>⬇ Download CSV</button></div>${checksHTML(checks)}<p class="small muted" style="margin:8px 0 0">Layout and date format follow the settings on the Interest journals (intercompany) tab: currently <b>${esc(S.format)}</b>, ${esc(S.dateStyle)}.</p></div>`;
}

/* ---------- ageing ---------- */
function ageTableHTML(D){
  const L = D.L, R = D.R; if (!R.unA.length && !R.unB.length) return '';
  const all = [...D.A, ...D.B].map(x => x.date).filter(Boolean).sort(); const asOf = L.asOf || all[all.length - 1] || new Date().toISOString().slice(0, 10);
  const agg = AGE_BUCKETS.map(() => ({ nA: 0, sA: 0, nB: 0, sB: 0 }));
  R.unA.forEach(i => { const b = agg[ageBucket(ageDays(D.A[i].date, asOf))]; b.nA++; b.sA += D.A[i].amt; });
  R.unB.forEach(j => { const b = agg[ageBucket(ageDays(D.B[j].date, asOf))]; b.nB++; b.sB += D.B[j].amt; });
  const tot = agg.reduce((a, b) => ({ nA: a.nA + b.nA, sA: a.sA + b.sA, nB: a.nB + b.nB, sB: a.sB + b.sB }), { nA: 0, sA: 0, nB: 0, sB: 0 });
  return `<div class="card pad" style="margin:14px 0"><div class="row" style="justify-content:space-between"><h3 style="font-size:15px">Ageing of unmatched items</h3><label class="small">As at <input type="date" value="${esc(asOf)}" data-change="lasof" style="display:inline-block;width:auto;padding:3px 6px"></label></div>
    <table class="t"><thead><tr><th>Age (days)</th><th class="num">${esc(short(L.A.label || 'A', 22))} items</th><th class="num">Amount</th><th class="num">${esc(short(L.B.label || 'B', 22))} items</th><th class="num">Amount</th></tr></thead><tbody>
    ${agg.map((b, n) => `<tr><td>${AGE_BUCKETS[n]}</td><td class="num">${b.nA || '–'}</td><td class="num">${amt(round2(b.sA))}</td><td class="num">${b.nB || '–'}</td><td class="num">${amt(round2(b.sB))}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td>Total</td><td class="num">${tot.nA}</td><td class="num">${amt(round2(tot.sA))}</td><td class="num">${tot.nB}</td><td class="num">${amt(round2(tot.sB))}</td></tr></tfoot></table></div>`;
}
function ageRows(D){
  const L = D.L, R = D.R, all = [...D.A, ...D.B].map(x => x.date).filter(Boolean).sort(), asOf = L.asOf || all[all.length - 1] || new Date().toISOString().slice(0, 10);
  const agg = AGE_BUCKETS.map(() => [0, 0, 0, 0]);
  R.unA.forEach(i => { const b = agg[ageBucket(ageDays(D.A[i].date, asOf))]; b[0]++; b[1] += D.A[i].amt; });
  R.unB.forEach(j => { const b = agg[ageBucket(ageDays(D.B[j].date, asOf))]; b[2]++; b[3] += D.B[j].amt; });
  return { asOf, rows: agg.map((b, n) => [AGE_BUCKETS[n], b[0], round2(b[1]), b[2], round2(b[3])]) };
}
function lSummary(D){
  const rates = [['A', D.L.A], ['B', D.L.B]].filter(([, s]) => parseFloat(s.rate) > 0 && parseFloat(s.rate) !== 1);
  return (rates.length ? `<div class="note" style="margin-bottom:12px">Amounts are shown after conversion: ${rates.map(([k, s]) => `${esc(s.label || k)} × ${s.rate}${s.cur ? ' (' + esc(s.cur) + ')' : ''}`).join(' · ')}</div>` : '') + lSummary0(D) + ageTableHTML(D);
}
function lUnmatched(D){ return ageTableHTML(D) + lUnmatched0(D); }

/* ---------- events ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]'); if (!t) return;
  const a = t.dataset.act, d = t.dataset;
  if (a === 'revaccept'){
    const rows = reviewRows(); const todo = rows.filter(x => suggestionFor(x.r) >= 0); if (!todo.length) return;
    snap(`Accept ${todo.length} suggestions`); let n = 0; todo.forEach(x => { if (acceptRow(x)) n++; });
    audit(`Accepted ${n} suggested matches at ≥ ${ui.review.minPct}%`); dirty(); render(); toast(`${n} matches confirmed`);
  }
  else if (a === 'basepick'){ $('#fileBase').click(); }
  else if (a === 'baseclear'){ state.baseline = null; dirty(); render(); }
  else if (a === 'droptotals'){
    const co = state.companies[ui.sel], k = tbChecks(co); if (!k.totalRows.length) return;
    if (!confirm(`Remove ${k.totalRows.length} line(s) that look like totals from “${co.name}”?`)) return;
    co.lines = co.lines.filter(l => !k.totalRows.includes(l)); audit(`Removed ${k.totalRows.length} total row(s) from ${co.name}`); dirty(); render();
  }
  else if (a === 'memforget'){ if (confirm('Forget every remembered assignment and ledger match?')){ MEM = { tb: {}, ledger: [] }; memSave(); audit('Remembered decisions cleared'); render(); } }
  else if (a === 'ccol'){
    const S = state.settings, c = (S.custom = S.custom.slice()), i = c.indexOf(d.k);
    if (d.d === 'add') c.push(d.k); else if (d.d === '0') c.splice(i, 1); else { const j = i + Number(d.d); if (j >= 0 && j < c.length){ c[i] = c[j]; c[j] = d.k; } }
    dirty(); render();
  }
  else if (a === 'jtest'){
    const { J } = csvFor(ui.jco), S = state.settings; if (J.entries.length < 2) return;
    const en = [{ account: J.entries[0].account, desc: 'MATCHMAKER TEST - REVERSE', amount: 0.01 }, { account: J.entries[J.entries.length - 1].account, desc: 'MATCHMAKER TEST - REVERSE', amount: -0.01 }];
    saveOut('Matchmaker 1-cent test journal', { ...jOut(en, { format: S.format, header: S.header, dateStyle: S.dateStyle, date: J.date, period: J.period, ref: 'TEST', contra: J.acc.contra, delimiter: S.delimiter, custom: S.custom, narr: 'Test', batch: 1 }), fname: 'Matchmaker 1-cent test journal' }); toast('Test file downloaded – import it, check it, then reverse it');
  }
  else if (a === 'fixsel'){ const { rows } = fixData(); snap('Tick pairs'); rows.forEach(r => { state.fix[r.key] = Object.assign(state.fix[r.key] || {}, { on: d.v === 'all' }); }); dirty(); render(); }
  else if (a === 'fixdl'){ const j = fixData().J.find(x => x.x === +d.x); if (j){ saveOut(`Correcting journal - ${j.co.name}`, j.out); audit(`Correcting journal downloaded for ${j.co.name}`); } }
  else if (a === 'fixzip'){
    const { J } = fixData(); if (!J.length) return;
    if (J.length === 1) saveOut(`Correcting journal - ${J[0].co.name}`, J[0].out);
    else download('Correcting journals.zip', makeZip(J.map(j => outZipItem(outFile(`Correcting journal - ${j.co.name}`, j.out), j.out))), 'application/zip');
    audit(`Correcting journals downloaded (${J.length} compan${J.length === 1 ? 'y' : 'ies'})`);
  }
  else if (a === 'ljdl'){ const J = ledgerJournalData(ledgerSummaryData()); if (J.out){ saveOut('Ledger correcting journal', J.out); audit(`Ledger correcting journal downloaded (${J.entries.length / 2} items)`); } }
});
document.addEventListener('change', e => {
  const t = e.target, a = t.dataset && t.dataset.change; if (t.id === 'fileBase'){ if (t.files[0]) loadBaseline(t.files[0]); t.value = ''; return; }
  if (!a) return; const L = state.ledger, S = state.settings;
  if (a === 'revmin'){ ui.review.minPct = Math.max(30, Math.min(100, parseFloat(t.value) || 90)); render(); }
  else if (a === 'fixset'){ snap('Correcting journal'); const f = state.fix[t.dataset.key] = state.fix[t.dataset.key] || {}; const k = t.dataset.f; if (k === 'on') f.on = t.checked; else if (k === 'amt') f.amt = t.value === '' ? '' : parseFloat(t.value); else { f[k] = t.value; if (k === 'side'){ delete f.acct; delete f.amt; } } dirty(); render(); }
  else if (a === 'fixopt'){ if (t.dataset.k === '_date') state.fix._date = t.value; else S[t.dataset.k] = t.value; dirty(); render(); }
  else if (a === 'lcur'){ L[t.dataset.side].cur = t.value.trim().toUpperCase(); dirty(); render(); }
  else if (a === 'lrate'){ const v = parseFloat(t.value); const s = L[t.dataset.side]; if (v > 0 && v !== 1) s.rate = v; else delete s.rate; audit(`Rate for ${s.label || t.dataset.side} set to ${s.rate || 1}`); dirty(); render(); }
  else if (a === 'lasof'){ L.asOf = t.value; dirty(); render(); }
  else if (a === 'ljopt'){ const jr = L.jr = L.jr || { books: 'B', acct: '', contra: '', ref: 'ADJ1', missing: true, diffs: true, on: {} }; const k = t.dataset.k; jr[k] = t.type === 'checkbox' ? t.checked : t.value; dirty(); render(); }
  else if (a === 'ljon'){ const jr = L.jr; jr.on[t.dataset.id] = t.checked; dirty(); render(); }
});
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !(e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))){ e.preventDefault(); undo(); return; }
  if (!e.ctrlKey && !e.metaKey && !e.altKey && reviewKey(e)) e.preventDefault();
});

// a change event fired by clicking away from a field must not re-draw the page before the click lands
document.addEventListener('pointerdown', e => { if (e.target.closest && e.target.closest('button,[data-act]')) ui.down = true; }, true);
['pointerup', 'pointercancel', 'dragend'].forEach(ev => document.addEventListener(ev, () => { if (!ui.down) return; ui.down = false; setTimeout(() => { if (ui.pend) render(); else if (ui.pendJ) jRefresh(); }, 0); }, true));
