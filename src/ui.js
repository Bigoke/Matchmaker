// <UI>
const LS_KEY = 'icr.session.v1';
const DEF_SETTINGS = { threshold: 0.6, ambiguity: 0.05, tolerance: 0.01, rate: 9, months: 12, rounding: 'down', basis: 'own',
  format: 'pastel', header: false, dateStyle: 'dmy', desc: 'Interest on Affiliated Entities', refTpl: 'JNL{yy}/01', appendName: false, compact: true,
  compound: false, freeAmt: 0, rate2: '', changeAfter: 6, delimiter: 'comma', custom: ['date', 'ref', 'desc', 'account', 'debit', 'credit'], fixRef: 'ADJ{nn}', fixDesc: 'Intercompany loan correction', fixContra: '' };
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = n => (n === 0 || n == null || isNaN(n)) ? '–' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtI = n => (n === 0 || n == null || isNaN(n)) ? '–' : Math.round(n).toLocaleString('en-US');
const amt = n => `<span class="${n < 0 ? 'neg' : ''}">${fmt(n)}</span>`;
const short = (s, n = 34) => s.length > n ? s.slice(0, n - 1) + '…' : s;
const pct = s => Math.round(s * 100) + '%';

function freshLedger(preset){ return { preset: preset || 'statement', mirror: true, A: { label: '', items: [], skipped: 0, source: '' }, B: { label: '', items: [], skipped: 0, source: '' },
  opts: { tol: 0, days: 30, dateOrder: 'dmy', grouped: true, skipBal: true, negDebit: false }, manual: [], rejected: [] }; }
function freshState(){ return { v: 3, mode: null, nextId: 1, companies: [], overrides: {}, settings: { ...DEF_SETTINGS }, ledger: freshLedger(), project: { name: '' }, audit: [], baseline: null, fix: {} }; }
function normState(s){ s.settings = { ...DEF_SETTINGS, ...(s.settings || {}) }; s.overrides = s.overrides || {}; s.ledger = Object.assign(freshLedger(), s.ledger || {}); s.mode = s.mode || (s.companies && s.companies.length ? 'tb' : null); s.project = s.project || { name: '' }; s.audit = s.audit || []; s.baseline = s.baseline || null; s.fix = s.fix || {}; return s; }
function loadState(){
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw){ const s = JSON.parse(raw); if (s && s.companies) return normState(s); }
  } catch (e) {}
  return freshState();
}
let state = loadState();
let ui = { tab: 'home', sel: 0, tbFilter: 'loans', recon: { mode: 'pairs', filter: 'issues', company: '', q: '', sortKey: 'sev', sortDir: 1, matrixMode: 'diff' },
  review: { filter: 'todo', all: false, q: '', cur: 0, minPct: 90 }, jco: 0, jShowAll: false, pair: null, undo: [], redo: [], mp: null };
let M = null, LM = null, saveTimer = null;
function save(){ clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { localStorage.setItem(LS_KEY, JSON.stringify(state)); if (ui.saveFail){ ui.saveFail = false; renderTabs(); } } catch (e) { if (!ui.saveFail){ ui.saveFail = true; toast('This project is too large to keep automatically in the browser – use “Save project” to keep your work.'); renderTabs(); } } }, 300); }
function dirty(){ M = null; LM = null; save(); }
const coRate = c => { const r = parseFloat(c && c.rate); return r > 0 ? r : 1; };
function scaledCompanies(){ if (!state.companies.some(c => coRate(c) !== 1)) return state.companies; return state.companies.map(c => coRate(c) === 1 ? c : { ...c, lines: c.lines.map(l => ({ ...l, net: round2(l.net * coRate(c)), dr: round2((l.dr || 0) * coRate(c)), cr: round2((l.cr || 0) * coRate(c)) })) }); }
function model(){ if (!M) M = buildModel(scaledCompanies(), state.overrides, state.settings); return M; }
function toast(msg){
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t);
  setTimeout(() => t.remove(), 3600);
}
function download(name, blobOrText, type = 'text/csv;charset=utf-8'){
  const blob = blobOrText instanceof Blob ? blobOrText : new Blob(['﻿' + blobOrText], { type });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
const safeName = s => s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();

/* ---------- company management ---------- */
function upsertCompany(p, forceIdx = -1){
  let idx = forceIdx >= 0 ? forceIdx : state.companies.findIndex(c => norm(c.name) === norm(p.name));
  if (idx >= 0){
    const c = state.companies[idx];
    c.lines = p.lines; c.periodStart = p.periodStart || c.periodStart; c.periodEnd = p.periodEnd || c.periodEnd;
    dirty(); return { idx, replaced: true };
  }
  state.companies.push({ id: 'c' + (state.nextId++), name: p.name, aliases: [], interest: true, periodStart: p.periodStart, periodEnd: p.periodEnd, lines: p.lines, jr: { sel: {}, rates: {} } });
  dirty(); return { idx: state.companies.length - 1, replaced: false };
}
function removeCompany(i){
  const id = state.companies[i].id;
  state.companies.splice(i, 1);
  for (const k of Object.keys(state.overrides)) if (state.overrides[k] === id) delete state.overrides[k];
  ui.sel = Math.max(0, Math.min(ui.sel, state.companies.length - 1)); ui.jco = Math.max(0, Math.min(ui.jco, state.companies.length - 1));
  dirty();
}
const coName = i => state.companies[i] ? state.companies[i].name : '';

/* ---------- assignment helpers ---------- */
function todoCount(i){
  const m = model(), co = state.companies[i];
  let n = 0;
  co.lines.forEach((ln, k) => {
    const r = m.res[i][k];
    if (['ambiguous', 'weak', 'none'].includes(r.status) && ln.net !== 0 && (m.loanGroups[i].has(groupOf(ln.code)) || r.status === 'ambiguous')) n++;
  });
  return n;
}
function totalTodo(){ return state.companies.reduce((a, _, i) => a + todoCount(i), 0); }
function assignSelect(i, k){
  const m = model(), co = state.companies[i], ln = co.lines[k], r = m.res[i][k];
  const ov = state.overrides['d:' + norm(ln.desc)];
  const cur = ov === undefined ? 'auto' : ov;
  const top = r.cands[0];
  const autoLbl = top && top.s >= state.settings.threshold
    ? (r.cands[1] && top.s - r.cands[1].s < state.settings.ambiguity ? `Auto: ambiguous (${short(coName(top.j), 20)} / ${short(coName(r.cands[1].j), 20)})` : `Auto: ${short(coName(top.j), 30)} (${pct(top.s)})`)
    : 'Auto: no match';
  let h = `<select data-change="assign" data-i="${i}" data-k="${k}">`;
  h += `<option value="auto" ${cur === 'auto' ? 'selected' : ''}>${esc(autoLbl)}</option>`;
  h += `<option value="ignore" ${cur === 'ignore' ? 'selected' : ''}>✕ Not a group company (ignore)</option>`;
  const listed = new Set();
  const sugg = r.cands.filter(c => c.s >= 0.3);
  if (sugg.length){
    h += '<optgroup label="Closest names">';
    sugg.forEach(c => { listed.add(c.j); h += `<option value="${state.companies[c.j].id}" ${cur === state.companies[c.j].id ? 'selected' : ''}>${esc(short(coName(c.j), 40))} · ${pct(c.s)}</option>`; });
    h += '</optgroup>';
  }
  h += '<optgroup label="All companies">';
  state.companies.map((c, j) => ({ c, j })).filter(x => x.j !== i && !listed.has(x.j)).sort((a, b) => a.c.name.localeCompare(b.c.name))
    .forEach(x => { h += `<option value="${x.c.id}" ${cur === x.c.id ? 'selected' : ''}>${esc(short(x.c.name, 44))}</option>`; });
  h += '</optgroup></select>';
  return h;
}
function applyAssign(i, k, val){
  const ln = state.companies[i].lines[k], key = 'd:' + norm(ln.desc);
  snap('Assign “' + short(ln.desc, 30) + '”');
  audit(`Assigned “${ln.desc}” (${state.companies[i].name}) → ${val === 'auto' ? 'automatic' : val === 'ignore' ? 'not a group company' : (state.companies.find(c => c.id === val) || {}).name}`);
  memTB(norm(ln.desc), val);
  if (val === 'auto') delete state.overrides[key]; else state.overrides[key] = val;
  dirty();
  let n = 0; const nd = norm(ln.desc);
  state.companies.forEach(c => c.lines.forEach(l => { if (norm(l.desc) === nd) n++; }));
  if (n > 1) toast(`Applied to all ${n} lines named “${ln.desc.replace(/^[-\s]+/, '')}” across the trial balances`);
}
function matchChip(r){
  if (!r) return '';
  if (r.status === 'manual') return '<span class="chip mut" title="Assigned by you">manual</span>';
  if (r.status === 'ignored') return '<span class="chip mut">ignored</span>';
  if (r.status === 'auto') return `<span class="chip ${r.score >= 0.85 ? 'ok' : 'warn'}" title="Text similarity">${pct(r.score)}</span>`;
  if (r.status === 'ambiguous') return '<span class="chip warn">ambiguous</span>';
  if (r.status === 'weak') return `<span class="chip bad">weak ${pct(r.score)}</span>`;
  return '<span class="chip mut">no match</span>';
}

/* ---------- tabs / shell ---------- */
const TB_TABS = [['tb', '1 · Trial balances'], ['recon', '2 · Reconciliation'], ['review', '3 · Review matches'], ['jnl', '4 · Interest journals'], ['fix', '5 · Correcting journals'], ['audit', 'Audit trail']];
const L_TABS = [['lload', '1 · Load ledgers'], ['lres', '2 · Matches & differences'], ['audit', 'Audit trail']];
function tabsFor(){ return [['home', '⌂ Start']].concat(state.mode === 'tb' ? TB_TABS : state.mode === 'ledger' ? L_TABS : []); }
function renderTabs(){
  const todo = state.mode === 'tb' && state.companies.length ? totalTodo() : 0;
  const L = state.ledger;
  const exp = ui.tab !== 'home' ? `<div class="exp"><span class="muted small">Export report</span><button class="btn sm" data-act="exp" data-f="xlsx" title="Excel workbook">⬇ Excel</button><button class="btn sm" data-act="pack" title="Every step in one Excel workbook">⬇ Complete pack</button><button class="btn sm" data-act="exp" data-f="pdf" title="Opens the print dialog – choose “Save as PDF”">⬇ PDF</button></div>` : '';
  $('#tabs').innerHTML = tabsFor().map(([k, t]) => {
    let b = '';
    if (k === 'tb' && state.companies.length) b = `<span class="badge ok">${state.companies.length}</span>`;
    if (k === 'review' && state.companies.length) b = todo ? `<span class="badge">${todo}</span>` : '<span class="badge ok">✓</span>';
    return `<button class="${ui.tab === k ? 'on' : ''}" data-act="tab" data-tab="${k}">${t}${b}</button>`;
  }).join('') + exp;
  const acts = [ui.saveFail ? '<span class="chip bad" title="The browser could not store this project automatically">⚠ not auto-saved</span>' : '', `<input type="text" class="pname" placeholder="Project name" value="${esc(state.project.name)}" data-change="pname" title="Name this piece of work – it goes into saved files and reports">`];
  if (state.mode === 'tb') acts.push('<button class="btn primary" data-act="paste">＋ Paste trial balance</button>', '<button class="btn" data-act="import">Import Excel…</button>', '<button class="btn" data-act="importfolder" title="Pick a folder of trial balances (Excel, CSV or PDF)">Import folder…</button>');
  acts.push(`<button class="btn" data-act="undo" title="Undo the last match / assignment (Ctrl+Z)" ${ui.undo.length ? '' : 'disabled'}>↶ Undo</button>`, '<button class="btn" data-act="savesession" title="Save everything loaded here to a project file">Save project</button>', '<button class="btn" data-act="loadsession">Open project</button>', '<button class="btn danger" data-act="reset">Reset</button>');
  $('#actions').innerHTML = acts.join('');
}
function render(){
  if (ui.down){ ui.pend = true; return; } ui.pend = false;
  const sy = window.scrollY, sc = $$('.scroll').map(e => e.scrollTop);
  renderTabs();
  const v = { home: homeView, tb: tbView, recon: reconView, review: reviewView, jnl: journalView, lload: lloadView, lres: lresView, fix: fixView, audit: auditView }[ui.tab] || homeView;
  $('#view').innerHTML = baselineCard() + v();
  const cur = $('tr.cur'); if (cur && ui.scrollCur){ cur.scrollIntoView({ block: 'center' }); ui.scrollCur = false; }
  $$('.scroll').forEach((e, i) => { if (sc[i]) e.scrollTop = sc[i]; });
  window.scrollTo(0, sy);
  if (ui.tab === 'jnl') jRefresh();
}
function emptyState(){
  return `<div class="card empty"><h3>Start by adding your trial balances</h3>
  <p>Copy each company’s trial balance (Account, Description, DR, CR) from Excel or your accounting package and paste it here — or import your whole workbook at once.</p>
  <div class="row" style="justify-content:center;margin-top:14px"><button class="btn primary" data-act="paste">Paste a trial balance</button><button class="btn" data-act="import">Import an Excel workbook…</button><button class="btn" data-act="importfolder">Import a whole folder…</button></div>
  <div class="steps"><div><b>1 · Paste</b>One trial balance per company. The company name is read from the heading line.</div>
  <div><b>2 · Reconcile</b>Loan accounts are matched to the other companies by name — even with spelling differences — and both sides are compared.</div>
  <div><b>3 · Interest</b>Choose a company, pick the loan accounts, set the rate, and download the journal CSV for import.</div></div>
  <p class="small" style="margin-top:18px">Tip: press <b>Ctrl+V</b> anywhere on this page to paste a trial balance straight away. Everything stays in this browser — nothing is uploaded.</p></div>`;
}

/* ---------- view 1: trial balances ---------- */
function tbView(){
  const cos = state.companies;
  if (!cos.length) return emptyState();
  const m = model();
  if (ui.sel >= cos.length) ui.sel = 0;
  const cq = norm(ui.colq || '');
  const list = cos.map((c, i) => ({ c, i })).filter(x => !cq || norm(x.c.name).includes(cq)).map(({ c, i }) => {
    const linked = m.res[i].filter(r => r.target >= 0).length, todo = todoCount(i);
    return `<li class="${i === ui.sel ? 'on' : ''}" data-act="selco" data-i="${i}"><span class="ix">${i + 1}</span>
      <div><div class="nm">${esc(short(c.name, 30))}</div><div class="sub">${c.lines.length} accounts · ${linked} linked${todo ? ` · <b style="color:var(--warn)">${todo} to review</b>` : ''}</div></div>
      ${c.interest ? '' : '<span class="tag">no interest</span>'}${tbIssueTag(c)}</li>`;
  }).join('');
  return `<div class="split"><aside class="card list"><div class="head"><h3>Companies</h3><span class="muted small">${cos.length} loaded</span></div>
    <div class="btns"><button class="btn primary block" data-act="paste">＋ Paste trial balance</button><button class="btn block" data-act="import">Import Excel workbook…</button><button class="btn block" data-act="importfolder">Import a whole folder…</button></div>
    ${cos.length > 8 ? `<div style="padding:0 14px 10px"><input type="text" id="colq" placeholder="Find a company…" value="${esc(ui.colq || '')}" data-change="colq"></div>` : ''}
    <ul>${list || '<li class="muted">No company matches.</li>'}</ul></aside><section>${tbDetail()}</section></div>`;
}
function tbDetail(){
  const i = ui.sel, co = state.companies[i], m = model();
  const f = ui.tbFilter;
  const rows = [];
  co.lines.forEach((ln, k) => {
    const r = m.res[i][k]; if (r.status === 'skip') return;
    const isTodo = ['ambiguous', 'weak', 'none'].includes(r.status) && ln.net !== 0 && (m.loanGroups[i].has(groupOf(ln.code)) || r.status === 'ambiguous');
    if (f === 'loans' && !(r.target >= 0 || isTodo || r.status === 'ignored' && m.loanGroups[i].has(groupOf(ln.code)))) return;
    if (f === 'todo' && !isTodo) return;
    rows.push({ ln, k, r, isTodo });
  });
  const tr = rows.map(({ ln, k, r }) => `<tr><td class="mono">${esc(ln.code)}</td><td>${esc(ln.desc)}</td><td class="num">${amt(ln.net)}</td>
    <td>${r.status === 'skip' ? '' : (f === 'all' && r.target < 0 && !['ambiguous', 'weak'].includes(r.status) ? '<span class="muted small">—</span>' : assignSelect(i, k))}</td><td>${matchChip(r)}</td></tr>`).join('');
  const tot = rows.reduce((a, x) => a + x.ln.net, 0);
  return tbBanner(co) + `<div class="card pad" style="margin-bottom:16px">
    <div class="row" style="justify-content:space-between;align-items:flex-start">
      <div class="grow" style="flex:1;min-width:260px"><div class="field"><label>Company name (as it appears on the trial balance)</label>
      <input type="text" value="${esc(co.name)}" data-change="coname"></div></div>
      <div class="row"><button class="btn" data-act="replace">Replace trial balance</button><button class="btn danger" data-act="remove">Remove</button></div></div>
    <div class="grid2">
      <div class="field"><label>Also known as — other names used for this company in other ledgers</label>
      <textarea data-change="coalias" placeholder="One per line, e.g.&#10;Lion Lodge&#10;PAF Trust">${esc((co.aliases || []).join('\n'))}</textarea>
      <span class="small muted">Optional. The matcher already copes with spelling differences, abbreviations and joined/split words.</span></div>
      <div><div class="lbl">Details</div>
      <p class="small" style="margin:6px 0">${co.lines.length} accounts${co.periodStart ? ` · period ${fmtDate(co.periodStart, 'dmy')} to ${fmtDate(co.periodEnd, 'dmy')}` : ''}</p>
      <label class="chk"><input type="checkbox" ${co.interest ? 'checked' : ''} data-change="cointerest"> This company charges / pays interest on intercompany loans</label>
      <div class="grid2" style="margin-top:8px"><div class="field"><label>Currency (optional)</label><input type="text" value="${esc(co.cur || '')}" placeholder="e.g. USD" data-change="cocur" maxlength="6"></div><div class="field"><label>Rate to group currency</label><input type="number" step="0.0001" min="0" value="${co.rate || ''}" placeholder="1" data-change="corate"></div></div>
      <p class="small muted" style="margin-top:6px">Untick for companies that do not account for interest (the “Geen” companies in your workbook). Interest lines to or from them are then not selected by default.</p></div></div></div>
    <div class="toolbar"><div class="seg">${[['loans', 'Intercompany loans'], ['todo', 'Needs review'], ['all', 'All accounts']].map(([k, t]) => `<button class="${f === k ? 'on' : ''}" data-act="tbfilter" data-f="${k}">${t}</button>`).join('')}</div>
      <span class="muted small">${rows.length} lines</span></div>
    <div class="card scroll"><table class="t"><thead><tr><th>Account</th><th>Description in this trial balance</th><th class="num">Balance (Dr + / Cr −)</th><th>Linked to company</th><th>Match</th></tr></thead>
    <tbody>${tr || '<tr><td colspan="5" class="empty">Nothing to show for this filter.</td></tr>'}</tbody>
    ${f === 'all' ? '' : `<tfoot><tr><td colspan="2">Total shown</td><td class="num">${amt(round2(tot))}</td><td colspan="2"></td></tr></tfoot>`}</table></div>`;
}

/* ---------- view 2: reconciliation ---------- */
function statusOf(p){ return p.status; }
function pairDoubt(p){
  const m = model();
  const chk = (x, y) => m.bal[x][y].lines.some(k => { const r = m.res[x][k]; return r.status === 'auto' && r.score < 0.8; });
  return chk(p.i, p.j) || chk(p.j, p.i);
}
function pairLabel(p, flip){
  const nA = coName(flip ? p.j : p.i), nB = coName(flip ? p.i : p.j);
  const doubt = pairDoubt(p) ? ' <span class="chip mut" title="At least one line was linked on a fairly loose name match – open the pair to check it">check match</span>' : '';
  if (p.status === 'agree') return '<span class="chip ok">Agrees</span>' + doubt;
  if (p.status === 'diff') return '<span class="chip bad">Difference</span>' + doubt;
  const missing = !p.aHas ? (flip ? nB : nA) : (flip ? nA : nB);
  return `<span class="chip warn" title="${esc(missing)} has no loan account for the other company">Missing in ${esc(short(missing, 22))}</span>` + doubt;
}
function reconView(){
  const cos = state.companies;
  if (cos.length < 2) return cos.length ? '<div class="card empty"><h3>Add at least one more company</h3><p>The reconciliation compares each company’s loan account with the other company’s books.</p><button class="btn primary" data-act="paste">Paste a trial balance</button></div>' : emptyState();
  const m = model(), R = ui.recon;
  const pairs = m.pairs;
  const nAgree = pairs.filter(p => p.status === 'agree').length, nDiff = pairs.filter(p => p.status === 'diff').length, nOne = pairs.filter(p => p.status === 'onesided').length;
  const absDiff = pairs.filter(p => p.status !== 'agree').reduce((a, p) => a + Math.abs(p.diff), 0);
  const todo = totalTodo();
  const kp = `<div class="kpis">
    <div class="card kpi"><b>${pairs.length}</b><span>company pairs with loans</span></div>
    <div class="card kpi good"><b>${nAgree}</b><span>agree (within ${fmt(state.settings.tolerance)})</span></div>
    <div class="card kpi ${nDiff ? 'bad' : 'good'}"><b>${nDiff}</b><span>differences</span></div>
    <div class="card kpi ${nOne ? 'warn' : 'good'}"><b>${nOne}</b><span>missing on one side</span></div>
    <div class="card kpi"><b>${fmt(round2(absDiff))}</b><span>total unreconciled (absolute)</span></div>
    <div class="card kpi link ${todo ? 'warn' : 'good'}" data-act="tab" data-tab="review"><b>${todo}</b><span>lines to review →</span></div></div>`;
  const tb = `<div class="toolbar"><div class="seg"><button class="${R.mode === 'pairs' ? 'on' : ''}" data-act="rmode" data-v="pairs">Pairs list</button><button class="${R.mode === 'matrix' ? 'on' : ''}" data-act="rmode" data-v="matrix">Matrix</button></div>
    ${R.mode === 'pairs' ? `<div class="seg">${[['issues', 'Issues'], ['diff', 'Differences'], ['onesided', 'Missing'], ['agree', 'Agree'], ['all', 'All']].map(([k, t]) => `<button class="${R.filter === k ? 'on' : ''}" data-act="rfilter" data-v="${k}">${t}</button>`).join('')}</div>
    <select data-change="rcompany"><option value="">All companies</option>${cos.map((c, i) => `<option value="${c.id}" ${R.company === c.id ? 'selected' : ''}>${esc(short(c.name, 40))}</option>`).join('')}</select>
    <input type="text" placeholder="Search…" value="${esc(R.q)}" data-change="rq">`
    : `<div class="seg"><button class="${R.matrixMode === 'diff' ? 'on' : ''}" data-act="rmm" data-v="diff">Differences</button><button class="${R.matrixMode === 'bal' ? 'on' : ''}" data-act="rmm" data-v="bal">Row company’s balance</button></div>
    <label class="chk"><input type="checkbox" ${state.settings.compact ? 'checked' : ''} data-change="compact"> Whole rands</label>`}
    <label class="small muted" style="margin-left:auto">Tolerance R <input type="number" step="0.01" min="0" value="${state.settings.tolerance}" data-change="tolerance" style="width:80px;display:inline-block;padding:4px 6px"></label>
    <button class="btn sm" data-act="exportpairs">Export CSV</button></div>`;
  return kp + tb + (R.mode === 'pairs' ? pairsTable() : matrixTable());
}
function orientedPairs(){
  const m = model(), R = ui.recon;
  const selIdx = R.company ? state.companies.findIndex(c => c.id === R.company) : -1;
  let ps = m.pairs.map(p => ({ ...p, flip: selIdx >= 0 && p.j === selIdx }));
  if (selIdx >= 0) ps = ps.filter(p => p.i === selIdx || p.j === selIdx);
  if (R.filter === 'issues') ps = ps.filter(p => p.status !== 'agree');
  else if (R.filter !== 'all') ps = ps.filter(p => p.status === R.filter);
  if (R.q){ const q = norm(R.q); ps = ps.filter(p => norm(coName(p.i) + ' ' + coName(p.j)).includes(q)); }
  const sev = { diff: 0, onesided: 1, agree: 2 };
  const key = {
    sev: p => sev[p.status] * 1e12 - Math.abs(p.diff),
    a: p => coName(p.flip ? p.j : p.i).toLowerCase(), b: p => coName(p.flip ? p.i : p.j).toLowerCase(),
    av: p => p.flip ? p.b : p.a, bv: p => p.flip ? p.a : p.b, diff: p => Math.abs(p.diff)
  }[R.sortKey] || (p => 0);
  ps.sort((x, y) => { const a = key(x), b = key(y); return (a < b ? -1 : a > b ? 1 : 0) * R.sortDir; });
  return ps;
}
function codesOf(i, j){ const m = model(); return m.bal[i][j].lines.map(k => state.companies[i].lines[k].code).join(', '); }
function pairsTable(){
  const ps = orientedPairs(), R = ui.recon;
  const th = (k, t, cls = '') => `<th class="sortable ${cls}" data-act="rsort" data-k="${k}">${t}${R.sortKey === k ? (R.sortDir > 0 ? ' ▲' : ' ▼') : ''}</th>`;
  const rows = ps.map(p => {
    const A = p.flip ? p.j : p.i, B = p.flip ? p.i : p.j, av = p.flip ? p.b : p.a, bv = p.flip ? p.a : p.b;
    return `<tr class="click" data-act="pair" data-i="${p.i}" data-j="${p.j}"><td>${esc(short(coName(A), 40))}</td>
      <td class="num">${amt(av)}<div class="small muted">${esc(codesOf(A, B))}</div></td>
      <td>${esc(short(coName(B), 40))}</td><td class="num">${amt(bv)}<div class="small muted">${esc(codesOf(B, A))}</div></td>
      <td class="num"><b>${p.status === 'agree' && p.diff === 0 ? '–' : amt(p.diff)}</b></td><td>${pairLabel(p, p.flip)}</td></tr>`;
  }).join('');
  const tot = ps.reduce((a, p) => a + p.diff, 0);
  return `<div class="card scroll"><table class="t"><thead><tr>${th('a', 'Company A')}${th('av', 'A’s balance for B', 'num')}${th('b', 'Company B')}${th('bv', 'B’s balance for A', 'num')}${th('diff', 'Difference (A + B)', 'num')}${th('sev', 'Status')}</tr></thead>
    <tbody>${rows || `<tr><td colspan="6" class="empty">${ps.length ? '' : 'Nothing matches this filter. 🎉'}</td></tr>`}</tbody>
    <tfoot><tr><td colspan="4">${ps.length} pairs · a loan is balanced when A’s balance + B’s balance = 0</td><td class="num">${amt(round2(tot))}</td><td></td></tr></tfoot></table></div>
    <p class="small muted">Balances: debit (+) means the company is owed money; credit (−) means it owes. Click any row to see the underlying ledger lines.</p>`;
}
function matrixTable(){
  const cos = state.companies, m = model(), R = ui.recon, N = cos.length;
  const pm = new Map(); m.pairs.forEach(p => { pm.set(p.i * N + p.j, p); pm.set(p.j * N + p.i, p); });
  const f = state.settings.compact ? fmtI : fmt;
  let h = '<div class="card scroll"><table class="matrix"><thead><tr><th style="background:var(--soft);height:auto"></th>' + cos.map((c, j) => `<th title="${esc(c.name)}"><span>${j + 1}. ${esc(short(c.name, 26))}</span></th>`).join('') + '</tr></thead><tbody>';
  for (let i = 0; i < N; i++){
    h += `<tr><th title="${esc(cos[i].name)}">${i + 1}. ${esc(short(cos[i].name, 28))}</th>`;
    for (let j = 0; j < N; j++){
      if (i === j){ h += '<td class="diag"></td>'; continue; }
      const p = pm.get(i * N + j);
      if (!p){ h += '<td></td>'; continue; }
      const bal = m.bal[i][j].sum;
      const val = R.matrixMode === 'bal' ? bal : p.diff;
      const cls = p.status === 'agree' ? 'ok' : p.status === 'diff' ? 'bad' : 'warn';
      const txt = R.matrixMode === 'bal' ? `<span class="${bal < 0 ? 'neg' : ''}">${f(bal)}</span>` : (p.status === 'agree' ? '✓' : f(val));
      h += `<td class="${R.matrixMode === 'bal' ? (cls === 'ok' ? '' : cls) : cls}" data-act="pair" data-i="${Math.min(i, j)}" data-j="${Math.max(i, j)}" title="${esc(cos[i].name)} ↔ ${esc(cos[j].name)}: diff ${fmt(p.diff)}">${txt}</td>`;
    }
    h += '</tr>';
  }
  return h + '</tbody></table></div><p class="small muted">Green ✓ = agrees · red = difference · amber = loan appears on one side only. Click a cell for the detail.</p>';
}
function pairDialogHTML(){
  const { i, j } = ui.pair, m = model(), cos = state.companies;
  const p = m.pairs.find(x => x.i === i && x.j === j) || { a: m.bal[i][j].sum, b: m.bal[j][i].sum, diff: round2(m.bal[i][j].sum + m.bal[j][i].sum), status: 'agree', aHas: true, bHas: true };
  const side = (x, y) => {
    const rows = m.bal[x][y].lines.map(k => { const ln = cos[x].lines[k], r = m.res[x][k];
      return `<tr><td class="mono">${esc(ln.code)}</td><td>${esc(ln.desc)}<div style="margin-top:4px">${assignSelect(x, k)}</div></td><td>${matchChip(r)}</td><td class="num">${amt(ln.net)}</td></tr>`; }).join('');
    return `<div><h3 style="margin-bottom:6px">${esc(cos[x].name)}</h3><p class="small muted" style="margin:0 0 6px">Account for ${esc(short(cos[y].name, 40))} in this company’s books</p>
      <table class="t"><thead><tr><th>Acc</th><th>Description</th><th>Match</th><th class="num">Balance</th></tr></thead><tbody>${rows || `<tr><td colspan="4" class="muted">No matching account found.${''}</td></tr>`}</tbody>
      <tfoot><tr><td colspan="3">Total</td><td class="num">${amt(m.bal[x][y].sum)}</td></tr></tfoot></table></div>`;
  };
  const verdict = p.status === 'agree' ? `<div class="note">✓ These two balances agree — ${fmt(p.a)} + ${fmt(p.b)} = ${fmt(p.diff)}</div>`
    : p.status === 'diff' ? `<div class="note bad"><b>Difference of ${fmt(p.diff)}</b> — ${fmt(p.a)} (${esc(short(cos[i].name, 28))}) + ${fmt(p.b)} (${esc(short(cos[j].name, 28))}) should be nil. The ${p.diff > 0 ? 'debit' : 'credit'} side is higher.</div>`
    : `<div class="note warn"><b>Only one side has this loan.</b> ${!p.aHas ? esc(cos[i].name) : esc(cos[j].name)} has no matching account for the other company. If it exists under another name, find it in <a href="#" data-act="tab" data-tab="review">Review matches</a> or use “Also known as” on the company.</div>`;
  return `<div class="dh"><h3>${esc(short(cos[i].name, 38))} ↔ ${esc(short(cos[j].name, 38))}</h3><button class="btn sm" data-act="closedlg">Close</button></div>
    <div class="db">${verdict}<div class="sidebyside" style="margin-top:14px">${side(i, j)}${side(j, i)}</div>
    <p class="small muted" style="margin-top:12px">Re-assigning a line applies to every trial balance that uses the same description.</p></div>`;
}

/* ---------- view 3: review ---------- */
function reviewRows(){
  const cos = state.companies, m = model(), R = ui.review;
  const rows = [];
  cos.forEach((co, i) => co.lines.forEach((ln, k) => {
    const r = m.res[i][k]; if (r.status === 'skip') return;
    const inLoan = m.loanGroups[i].has(groupOf(ln.code));
    const unresolved = ['ambiguous', 'weak', 'none'].includes(r.status);
    let show = false;
    if (R.filter === 'todo') show = unresolved && ln.net !== 0 && (inLoan || r.status === 'ambiguous');
    else if (R.filter === 'ignored') show = r.status === 'ignored';
    else if (R.filter === 'manual') show = r.status === 'manual';
    else if (R.filter === 'auto') show = r.status === 'auto';
    else show = ln.net !== 0;
    if (R.filter === 'todo' && R.all) show = unresolved && ln.net !== 0;
    if (show && R.q && !norm(co.name + ' ' + ln.desc + ' ' + ln.code).includes(norm(R.q))) show = false;
    if (show) rows.push({ i, k, ln, r });
  }));
  if (R.filter === 'auto') rows.sort((a, b) => a.r.score - b.r.score || Math.abs(b.ln.net) - Math.abs(a.ln.net));
  else rows.sort((a, b) => Math.abs(b.ln.net) - Math.abs(a.ln.net));
  return rows;
}
function reviewView(){
  const cos = state.companies;
  if (!cos.length) return emptyState();
  const m = model(), R = ui.review, S = state.settings;
  const rows = reviewRows();
  const limit = 400, shown = rows.slice(0, limit);
  const tr = shown.map(({ i, k, ln, r }, n) => {
    const top = r.cands[0];
    return `<tr class="${n === R.cur ? 'cur' : ''}" data-rown="${n}"><td>${esc(short(coName(i), 30))}</td><td class="mono">${esc(ln.code)}</td><td>${esc(ln.desc)}</td><td class="num">${amt(ln.net)}</td>
      <td class="small">${top && top.s >= 0.3 ? esc(short(coName(top.j), 30)) + ' <span class="score">' + pct(top.s) + '</span>' : '<span class="muted">—</span>'}</td><td style="min-width:260px">${assignSelect(i, k)}</td><td>${matchChip(r)}</td></tr>`;
  }).join('');
  return `<div class="card pad" style="margin-bottom:14px"><div class="row">
    <div style="flex:1;min-width:280px"><h3 style="margin-bottom:4px">Check the matches</h3>
    <p class="small muted" style="margin:0">Lines the matcher could not link with confidence are listed here (largest first). Pick the right company, or choose <b>ignore</b> for loans to people, outside parties or anything that is not a group company. A choice applies to every trial balance using the same description.</p></div>
    <div style="min-width:260px"><div class="lbl">Matching strictness: ${pct(S.threshold)}</div>
    <input type="range" min="0.45" max="0.9" step="0.01" value="${S.threshold}" data-change="threshold" style="width:100%;accent-color:var(--accent)">
    <div class="small muted" style="display:flex;justify-content:space-between"><span>looser</span><span>stricter</span></div></div></div></div>
    <div class="toolbar"><div class="seg">${[['todo', 'To review'], ['auto', 'Auto-matched'], ['manual', 'Manual'], ['ignored', 'Ignored'], ['all', 'All lines']].map(([k, t]) => `<button class="${R.filter === k ? 'on' : ''}" data-act="revfilter" data-v="${k}">${t}</button>`).join('')}</div>
    <input type="text" placeholder="Search…" value="${esc(R.q)}" data-change="revq">
    ${R.filter === 'todo' ? `<label class="chk"><input type="checkbox" ${R.all ? 'checked' : ''} data-change="revall"> Include accounts outside the loan group</label>` : ''}
    <span class="muted small">${rows.length} lines${rows.length > limit ? ` (showing ${limit})` : ''}${R.filter === 'auto' ? ' · least certain first' : ''}</span>
    ${R.filter === 'todo' && rows.some(x => x.r.status !== 'ambiguous') ? '<button class="btn sm" data-act="ignoreall" title="Marks every listed line as not a group company – e.g. loans from directors or outside parties">Ignore all listed (not group companies)</button>' : ''}${reviewBulkHTML(rows)}</div>
    <div class="card scroll"><table class="t"><thead><tr><th>Company</th><th>Account</th><th>Description</th><th class="num">Balance</th><th>Closest company</th><th>Assign to</th><th>Match</th></tr></thead>
    <tbody>${tr || '<tr><td colspan="7" class="empty">Nothing here. 🎉</td></tr>'}</tbody></table></div>`;
}

/* ---------- view 4: journals ---------- */
const jrOf = co => (co.jr = co.jr || { sel: {}, rates: {} });
function derivedPeriod(co){
  if (co.periodStart && co.periodEnd){ const [y1, m1] = co.periodStart.split('-').map(Number), [y2, m2] = co.periodEnd.split('-').map(Number); const n = (y2 - y1) * 12 + m2 - m1 + 1; if (n >= 1 && n <= 13) return n; }
  return 12;
}
function refFor(co, i){
  const jr = jrOf(co); const d = jr.date || co.periodEnd || '';
  const yyyy = d ? d.slice(0, 4) : String(new Date().getFullYear());
  return (jr.ref || state.settings.refTpl || '').replace(/\{yyyy\}/g, yyyy).replace(/\{yy\}/g, yyyy.slice(2)).replace(/\{nn\}/g, String(i + 1).padStart(2, '0'));
}
function journalData(i){
  const m = model(), co = state.companies[i], S = state.settings, jr = jrOf(co);
  const rows = [], ownCount = {};
  co.lines.forEach((ln, k) => { const r = m.res[i][k]; if (r.target >= 0) ownCount[r.target] = (ownCount[r.target] || 0) + 1; });
  co.lines.forEach((ln, k) => {
    const r = m.res[i][k]; if (r.status === 'skip' || ln.net === 0) return;
    const inGroup = m.loanGroups[i].has(groupOf(ln.code));
    if (!(r.target >= 0 || inGroup || ui.jShowAll)) return;
    const t = r.target >= 0 ? r.target : -1;
    const tco = t >= 0 ? state.companies[t] : null;
    const theirsLines = t >= 0 ? m.bal[t][i].lines : [];
    const hasTheirs = theirsLines.length > 0, theirs = hasTheirs ? round2(m.bal[t][i].sum / coRate(co)) : null;
    let base = ln.net, note = '';
    if (t >= 0 && hasTheirs && ownCount[t] === 1){
      if (S.basis === 'theirs') base = -theirs;
      else if (S.basis === 'lower'){
        if (Math.sign(-theirs) === Math.sign(ln.net)) base = Math.sign(ln.net) * Math.min(Math.abs(ln.net), Math.abs(theirs));
        else note = 'balances have opposite signs – own balance used';
      }
    } else if (t >= 0 && S.basis !== 'own' && ownCount[t] > 1) note = 'several accounts for this company – own balance used';
    const rate = jr.rates && jr.rates[ln.code] !== undefined && jr.rates[ln.code] !== '' ? Number(jr.rates[ln.code]) : S.rate;
    const hasOwnRate = jr.rates && jr.rates[ln.code] !== undefined && jr.rates[ln.code] !== '';
    const interest = calcInterest(base, { rate, months: S.months, rounding: S.rounding, compound: S.compound, threshold: Number(S.freeAmt) || 0, rate2: hasOwnRate ? '' : S.rate2, changeAfter: S.changeAfter });
    const defSel = t >= 0 && co.interest && tco.interest;
    const sel = jr.sel && jr.sel[ln.code] !== undefined ? jr.sel[ln.code] : defSel;
    rows.push({ k, ln, r, t, tname: tco ? tco.name : '', theirs, hasTheirs, base, rate, interest, sel, defSel, note, diff: hasTheirs ? round2(ln.net + theirs) : null });
  });
  return rows;
}
function journalEntries(i, rows){
  const co = state.companies[i], S = state.settings, jr = jrOf(co);
  const sel = rows.filter(r => r.sel && r.interest !== 0);
  const first = (rows.find(r => r.t >= 0) || rows[0] || { ln: { code: '0' } }).ln.code;
  const def = defaultAccounts(first);
  const acc = { recv: jr.recv || def.recv, paid: jr.paid || def.paid, contra: jr.contra || def.contra };
  const entries = sel.map(r => ({ account: r.ln.code, desc: (S.appendName && r.tname ? S.desc + ' - ' + r.tname : S.desc).slice(0, 60), amount: r.interest, tname: r.tname }));
  const pos = round2(sel.filter(r => r.interest > 0).reduce((a, r) => a + r.interest, 0)), neg = round2(sel.filter(r => r.interest < 0).reduce((a, r) => a + r.interest, 0));
  if (pos > 0) entries.push({ account: acc.recv, desc: S.desc, amount: -pos, tname: 'Interest received' });
  if (neg < 0) entries.push({ account: acc.paid, desc: S.desc, amount: -neg, tname: 'Interest paid' });
  const date = jr.date || co.periodEnd || '';
  const period = jr.period || derivedPeriod(co);
  return { entries, acc, pos, neg, date, period, ref: refFor(co, i), def };
}
const co_ = i => state.companies[i];
function csvFor(i){
  const rows = journalData(i), J = journalEntries(i, rows), S = state.settings;
  const out = J.entries.length ? jOut(J.entries, { format: S.format, header: S.header, dateStyle: S.dateStyle, date: J.date, period: J.period, ref: J.ref, contra: J.acc.contra, delimiter: S.delimiter, custom: S.custom, narr: co_(i).name, batch: i + 1 }) : null;
  return { csv: out ? out.text : '', out, J, rows };
}
function journalView(){
  const cos = state.companies;
  if (!cos.length) return emptyState();
  if (ui.jco >= cos.length) ui.jco = 0;
  const co = cos[ui.jco], jr = jrOf(co), S = state.settings;
  const def = defaultAccounts((journalData(ui.jco).find(r => r.t >= 0) || { ln: { code: '0' } }).ln.code);
  const opt = (v, t, cur) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${t}</option>`;
  return `<div class="jgrid"><div class="jcontrols" style="display:grid;gap:14px">
    <div class="card pad"><h3>Company</h3><div class="field"><select data-change="jco">${cos.map((c, i) => `<option value="${i}" ${i === ui.jco ? 'selected' : ''}>${i + 1}. ${esc(short(c.name, 42))}</option>`).join('')}</select></div>
      <label class="chk"><input type="checkbox" ${co.interest ? 'checked' : ''} data-change="cointerest"> This company accounts for interest</label></div>
    <div class="card pad"><h3>Interest</h3><div class="grid2"><div class="field"><label>Rate % p.a.</label><input type="number" step="0.01" value="${S.rate}" data-bind="s:rate"></div>
      <div class="field"><label>Months</label><input type="number" step="1" min="1" max="12" value="${S.months}" data-bind="s:months"></div></div>
      <div class="field"><label>Calculate interest on</label><select data-bind="s:basis">${opt('own', 'This company’s balance', S.basis)}${opt('theirs', 'The other company’s balance (mirrored)', S.basis)}${opt('lower', 'The lower of the two balances', S.basis)}</select></div>
      <div class="grid2"><div class="field"><label>Interest-free amount</label><input type="number" step="0.01" min="0" value="${S.freeAmt || ''}" placeholder="0.00" data-bind="s:freeAmt"></div>
        <div class="field"><label>Rate changes to % …</label><input type="number" step="0.01" value="${S.rate2}" placeholder="no change" data-bind="s:rate2"></div></div>
      ${S.rate2 !== '' ? `<div class="field"><label>… after month</label><input type="number" min="1" max="11" value="${S.changeAfter}" data-bind="s:changeAfter"></div>` : ''}
      <label class="chk" style="margin-bottom:8px"><input type="checkbox" ${S.compound ? 'checked' : ''} data-bind="s:compound"> Compound monthly</label>
      <div class="field"><label>Rounding</label><select data-bind="s:rounding">${opt('down', 'Down to the cent (as in your workbook)', S.rounding)}${opt('near', 'Nearest cent', S.rounding)}</select></div>
      <p class="small muted" style="margin:0">Interest = (balance − interest-free amount) × rate × months ÷ 12 (simple), or compounded monthly if ticked. A debit balance earns interest (credited to interest received); a credit balance incurs it.</p></div>
    <div class="card pad"><h3>Journal</h3><div class="grid2"><div class="field"><label>Date</label><input type="date" value="${esc(jr.date || co.periodEnd || '')}" data-bind="jr:date"></div>
      <div class="field"><label>Period</label><input type="number" min="1" max="13" value="${jr.period || derivedPeriod(co)}" data-bind="jr:period"></div></div>
      <div class="field"><label>Reference</label><input type="text" value="${esc(jr.ref !== undefined ? jr.ref : S.refTpl)}" data-bind="jr:ref" placeholder="${esc(S.refTpl)}"><span class="small muted">{yy} = year, {nn} = company no.</span></div>
      <div class="field"><label>Description</label><input type="text" value="${esc(S.desc)}" data-bind="s:desc"></div>
      <label class="chk"><input type="checkbox" ${S.appendName ? 'checked' : ''} data-bind="s:appendName"> Add the other company’s name to each line</label></div>
    <div class="card pad"><h3>Accounts</h3><div class="grid3"><div class="field"><label>Interest received</label><input type="text" value="${esc(jr.recv || '')}" placeholder="${esc(def.recv)}" data-bind="jr:recv"></div>
      <div class="field"><label>Interest paid</label><input type="text" value="${esc(jr.paid || '')}" placeholder="${esc(def.paid)}" data-bind="jr:paid"></div>
      <div class="field"><label>Contra</label><input type="text" value="${esc(jr.contra || '')}" placeholder="${esc(def.contra)}" data-bind="jr:contra"></div></div>
      <div class="row" style="margin-bottom:6px"><button class="btn sm" data-act="allaccts">Use these accounts for all companies</button></div>
      <p class="small muted" style="margin:0">Type your own interest and contra account codes (they are remembered per company). Left blank, the suggestions follow your 2025 workbook’s chart of accounts.</p></div>
    <div class="card pad"><h3>CSV file</h3><div class="field"><label>Layout</label><select data-bind="s:format">${opt('pastel', 'Batch import – Period, Date, G, Account, Ref, Description, Amount, Contra', S.format)}${opt('generic', 'Generic – Date, Ref, Description, Account, Debit, Credit', S.format)}${opt('xero', 'Xero – manual journal import', S.format)}${opt('qbo', 'QuickBooks Online – journal entry import', S.format)}${opt('custom', 'Custom – choose your own columns', S.format)}${mapOptsHTML(S.format)}</select></div>
      <div class="row" style="margin:-4px 0 10px"><button class="btn sm" data-act="mapopen">⚙ Map my own export…</button>${isMapFmt(S.format) ? '<span class="small muted">Columns, dates, separator and file type come from this mapping.</span>' : ''}</div>
      ${S.format === 'custom' ? customColsHTML() : ''}
      <div class="field"><label>Separator</label><select data-bind="s:delimiter">${opt('comma', 'Comma ( , )', S.delimiter)}${opt('semi', 'Semicolon ( ; )', S.delimiter)}${opt('tab', 'Tab', S.delimiter)}</select></div>
      <div class="field"><label>Date format</label><select data-bind="s:dateStyle">${opt('dmy', 'dd/mm/yyyy', S.dateStyle)}${opt('ymd', 'yyyy/mm/dd', S.dateStyle)}${opt('iso', 'yyyy-mm-dd', S.dateStyle)}${opt('dmyd', 'dd-mm-yyyy', S.dateStyle)}${opt('mdy', 'mm/dd/yyyy', S.dateStyle)}</select></div>
      <label class="chk"><input type="checkbox" ${S.header ? 'checked' : ''} data-bind="s:header"> Include a header row (batch layout)</label></div>
    </div><div id="jmain"></div></div>`;
}
function jRefresh(){
  if (ui.down){ ui.pendJ = true; return; } ui.pendJ = false;
  const el = $('#jmain'); if (!el) return;
  const i = ui.jco, co = state.companies[i], S = state.settings;
  const { csv, J, rows } = csvFor(i);
  const tr = rows.map(r => {
    const unm = r.t < 0;
    return `<tr class="${unm ? '' : ''}"><td><input type="checkbox" ${r.sel ? 'checked' : ''} data-change="jsel" data-code="${esc(r.ln.code)}"></td><td class="mono">${esc(r.ln.code)}</td>
      <td>${esc(r.ln.desc)}</td><td>${unm ? '<span class="chip mut">not a group company</span>' : `${esc(short(r.tname, 34))} ${matchChip(r.r)}`}</td>
      <td class="num">${amt(r.ln.net)}</td><td class="num">${r.hasTheirs ? amt(r.theirs) : '<span class="muted">–</span>'}</td>
      <td class="num">${r.diff === null ? '' : (Math.abs(r.diff) > state.settings.tolerance ? `<span class="chip bad">${fmt(r.diff)}</span>` : '<span class="chip ok">✓</span>')}</td>
      <td><input class="cell" type="number" step="0.01" value="${jrOf(co).rates && jrOf(co).rates[r.ln.code] !== undefined ? jrOf(co).rates[r.ln.code] : ''}" placeholder="${S.rate}" data-change="jrate" data-code="${esc(r.ln.code)}"></td>
      <td class="num"><b>${amt(r.interest)}</b>${r.note ? `<div class="small muted" title="${esc(r.note)}">⚠ ${esc(r.note)}</div>` : ''}</td></tr>`;
  }).join('');
  const prev = J.entries.map((e, n) => `<tr><td class="mono">${esc(e.account)}</td><td>${esc(e.desc)}${e.tname && S.appendName ? '' : ''}</td><td>${esc(e.tname || '')}</td><td class="num">${e.amount > 0 ? fmt(e.amount) : ''}</td><td class="num">${e.amount < 0 ? fmt(-e.amount) : ''}</td></tr>`).join('');
  const dr = round2(J.entries.filter(e => e.amount > 0).reduce((a, e) => a + e.amount, 0)), cr = round2(J.entries.filter(e => e.amount < 0).reduce((a, e) => a - e.amount, 0));
  const nSel = rows.filter(r => r.sel && r.interest !== 0).length;
  el.innerHTML = `<div class="kpis"><div class="card kpi good"><b>${fmt(J.pos)}</b><span>interest received (income)</span></div>
    <div class="card kpi"><b>${fmt(-J.neg)}</b><span>interest paid (expense)</span></div>
    <div class="card kpi"><b>${nSel}</b><span>loan lines in the journal</span></div>
    <div class="card kpi ${dr === cr ? 'good' : 'bad'}"><b>${dr === cr ? 'Balanced' : 'Out by ' + fmt(round2(dr - cr))}</b><span>debits ${fmt(dr)} · credits ${fmt(cr)}</span></div></div>
    <div class="toolbar noprint"><div class="seg"><button data-act="jselect" data-v="default">Default selection</button><button data-act="jselect" data-v="all">Select all</button><button data-act="jselect" data-v="none">Select none</button></div>
      <label class="chk"><input type="checkbox" ${ui.jShowAll ? 'checked' : ''} data-change="jshowall"> Show every account with a balance</label></div>
    <div class="card scroll" style="margin-bottom:16px"><table class="t"><thead><tr><th></th><th>Account</th><th>Description in ${esc(short(co.name, 24))}</th><th>Linked company</th><th class="num">Balance</th><th class="num">Their books</th><th class="num">Diff</th><th class="num">Rate %</th><th class="num">Interest</th></tr></thead>
    <tbody>${tr || '<tr><td colspan="9" class="empty">No loan accounts found for this company. Check that its trial balance is loaded and the lines are matched (tab 3).</td></tr>'}</tbody></table></div>
    ${jChecksHTML(J, csv)}
    <div class="card pad"><div class="row" style="justify-content:space-between;margin-bottom:10px"><h3 style="font-size:16px">Journal ${esc(J.ref)} · ${esc(fmtDate(J.date, 'dmy'))} · period ${esc(J.period)}</h3>
      <div class="row noprint"><button class="btn primary" data-act="dlcsv" ${J.entries.length ? '' : 'disabled'}>⬇ Download CSV</button><button class="btn" data-act="copycsv" ${J.entries.length ? '' : 'disabled'}>Copy CSV</button>
      <button class="btn" data-act="printj" ${J.entries.length ? '' : 'disabled'}>Print</button><button class="btn" data-act="dlzip" title="One CSV per company, using each company’s default selection">⬇ All companies (.zip)</button></div></div>
    <table class="t"><thead><tr><th>Account</th><th>Description</th><th>Line</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
    <tbody>${prev || '<tr><td colspan="5" class="empty">Tick at least one loan line above.</td></tr>'}</tbody>
    <tfoot><tr><td colspan="3">Total</td><td class="num">${fmt(dr)}</td><td class="num">${fmt(cr)}</td></tr></tfoot></table>
    <details class="noprint" style="margin-top:12px"><summary class="small muted" style="cursor:pointer">Show the CSV text</summary><pre class="csv">${esc(csv)}</pre></details></div>`;
}
