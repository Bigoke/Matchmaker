
/* =====================================================================
   Start page, ledger / statement matching, report export (Excel + PDF)
   ===================================================================== */
const L_PRESETS = {
  statement: { icon: '🧾', name: 'Statement vs ledger account', desc: 'A supplier’s or customer’s statement against your own ledger account for them – find what is missing, wrong or timing.', labels: ['Their statement', 'Our ledger account'], mirror: true, tag: 'Invoices on their statement ↔ invoices in your ledger' },
  customers: { icon: '👥', name: 'Two customers’ general ledgers', desc: 'The same trading relationship as it appears in two customers’ (or two parties’) general ledgers.', labels: ['Customer 1 general ledger', 'Customer 2 general ledger'], mirror: true, tag: 'One side’s debit is the other side’s credit' },
  gl: { icon: '⇄', name: 'Two general ledgers', desc: 'Any two ledger accounts that should agree – intercompany accounts, control accounts, a bank statement against the cash book.', labels: ['General ledger A', 'General ledger B'], mirror: true, tag: 'Choose “opposite” or “same” direction' },
  bank: { icon: '🏦', name: 'Bank reconciliation', desc: 'A bank statement against your cash book – find unpresented items, deposits in transit, bank charges and errors. Dates are allowed to differ by a few days.', labels: ['Bank statement', 'Cash book'], mirror: true, tag: 'Bank credit ↔ cash book receipt', days: 7 },
  custom: { icon: '⚙', name: 'Custom comparison', desc: 'Load two lists of transactions and set the matching direction and rules yourself.', labels: ['List A', 'List B'], mirror: false, tag: 'Full control' }
};
const fmtD = d => d ? fmtDate(d, 'dmy') : '';
function ledgerStats(items){
  const dates = items.map(x => x.date).filter(Boolean).sort();
  return { n: items.length, sum: round2(items.reduce((a, x) => a + x.amt, 0)), dr: round2(items.filter(x => x.amt > 0).reduce((a, x) => a + x.amt, 0)), cr: round2(items.filter(x => x.amt < 0).reduce((a, x) => a + x.amt, 0)), d1: dates[0] || '', d2: dates[dates.length - 1] || '', nodate: items.filter(x => !x.date).length };
}
function applyPreset(k){
  const L = state.ledger, p = L_PRESETS[k] || L_PRESETS.statement;
  const defaults = new Set(Object.values(L_PRESETS).flatMap(x => x.labels));
  L.preset = k; L.mirror = p.mirror; if (p.days && !L.A.items.length && !L.B.items.length) L.opts.days = p.days;
  if (!L.A.label || defaults.has(L.A.label)) L.A.label = p.labels[0];
  if (!L.B.label || defaults.has(L.B.label)) L.B.label = p.labels[1];
}

/* ---------- start page ---------- */
function homeView(){
  const L = state.ledger, nTB = state.companies.length;
  const hasL = L.A.items.length || L.B.items.length;
  const card = (kind, icon, title, desc, tag) => `<button class="optcard" data-act="start" data-kind="${kind}"><div class="oc-ic">${icon}</div><div><b>${title}</b><span>${desc}</span><em>${tag}</em></div></button>`;
  let cont = '';
  if (nTB) cont += `<div class="card cont"><div class="oc-ic">Σ</div><div class="grow"><b>Intercompany loan accounts</b><div class="small muted">${nTB} trial balances loaded</div></div><button class="btn primary" data-act="cont" data-mode="tb">Continue →</button></div>`;
  if (hasL) cont += `<div class="card cont"><div class="oc-ic">⇄</div><div class="grow"><b>Ledger match: ${esc(L.A.label || 'A')} ↔ ${esc(L.B.label || 'B')}</b><div class="small muted">${L.A.items.length} and ${L.B.items.length} transactions loaded</div></div><button class="btn primary" data-act="cont" data-mode="ledger">Continue →</button></div>`;
  return `<div class="hero"><div class="herologo">${LOGO}<div><h1>Matchmaker</h1><span>Match intercompany loans, ledgers and statements – and see exactly what doesn’t agree.</span></div></div><h2>What do you want to match?</h2><p>Pick a starting point. You can come back here at any time and switch between them – everything you have loaded is kept in this browser.</p></div>
    ${cont ? `<div style="margin-bottom:20px"><div class="lbl" style="margin-bottom:8px">Continue where you left off</div>${cont}</div>` : ''}
    <div class="lbl" style="margin-bottom:8px">Group of companies</div>
    <div class="optgrid" style="margin-bottom:22px">${card('tb', 'Σ', 'Intercompany loan accounts', 'Paste or import the trial balance of each company in a group. Every loan account is matched to the company on the other side, differences are shown and the interest journals can be exported.', 'Any number of companies · trial balances')}</div>
    <div class="lbl" style="margin-bottom:8px">Two ledgers or statements</div>
    <div class="optgrid">${['statement', 'bank', 'customers', 'gl', 'custom'].map(k => card(k, L_PRESETS[k].icon, L_PRESETS[k].name, L_PRESETS[k].desc, L_PRESETS[k].tag)).join('')}</div>
    <p class="small muted" style="margin-top:22px">Everything stays on your computer – nothing is uploaded. Every step has an <b>Export report</b> button (Excel or PDF).</p>${memCardHTML()}<p class="small muted" style="margin-top:14px">New here? <a href="#" data-act="sample" data-kind="tb">Try it with a sample group of companies</a> · <a href="#" data-act="sample" data-kind="ledger">Try it with a sample statement and ledger</a> · <a href="#" data-act="about">About &amp; shortcuts</a> · v${APP_VERSION}</p>`;
}

/* ---------- ledger loading ---------- */
function ledgerFromGrid(side, grid, extra){
  const gm = guessLedgerMap(grid);
  ui.lraw[side] = Object.assign({ grid, hdr: gm.hdr, map: gm.map, open: true, source: 'Pasted', sheets: null, sheet: 0 }, extra || {});
  rebuildLedger(side);
}
function rebuildLedger(side){
  const raw = ui.lraw[side], L = state.ledger, o = L.opts;
  if (!raw) return;
  const r = buildLedger(raw.grid, raw.map, { hdr: raw.hdr, dateOrder: o.dateOrder, negDebit: o.negDebit, skipBal: o.skipBal });
  L[side].items = r.items; L[side].skipped = r.skipped; L[side].source = raw.source;
  L.manual = []; L.rejected = []; ui.lsel = { A: new Set(), B: new Set() };
  dirty();
}
async function ledgerFile(file, side){
  try {
    if (/\.(xlsx|xlsm|xltx|xltm)$/i.test(file.name)){
      const sheets = (await readWorkbookSheets(await file.arrayBuffer())).filter(s => s.rows.some(r => r.some(c => c !== '' && c != null)));
      if (!sheets.length){ toast('That workbook has no data.'); return; }
      ledgerFromGrid(side, sheets[0].rows, { sheets, sheet: 0, source: file.name + ' – ' + sheets[0].name });
    } else if (/\.pdf$/i.test(file.name)) ledgerFromGrid(side, await pdfToGrid(await file.arrayBuffer()), { source: file.name + ' (PDF)' });
    else ledgerFromGrid(side, splitDelimited(await file.text()), { source: file.name });
    render(); toast(`Loaded ${state.ledger[side].items.length} transactions into ${state.ledger[side].label || side}`);
  } catch (e){ console.error(e); toast('Could not read that file: ' + e.message); }
}
const ROLES = [['', '— ignore —'], ['date', 'Date'], ['ref', 'Reference'], ['desc', 'Description'], ['debit', 'Debit'], ['credit', 'Credit'], ['amount', 'Amount (+ / −)'], ['balance', 'Balance (not used)']];
function mappingPanel(side){
  const raw = ui.lraw[side], g = raw.grid, L = state.ledger;
  const width = Math.min(14, Math.max(...g.map(r => r.length)));
  const colRole = new Array(width).fill('');
  for (const k in raw.map) if (raw.map[k] >= 0 && raw.map[k] < width) colRole[raw.map[k]] = k;
  const prev = g.slice(0, Math.min(g.length, 9));
  const st = ledgerStats(L[side].items);
  const hasAmt = raw.map.amount >= 0;
  let h = `<div class="field" style="margin-top:10px"><label>Check the columns</label>
    <div class="scroll" style="max-height:none;overflow:auto"><table class="mapt"><tbody><tr><td class="rn"></td>${colRole.map((r, c) => `<td><select data-change="lmap" data-side="${side}" data-col="${c}">${ROLES.map(([v, t]) => `<option value="${v}" ${r === v ? 'selected' : ''}>${t}</option>`).join('')}</select></td>`).join('')}</tr>
    ${prev.map((row, i) => `<tr class="${i === raw.hdr ? 'hd' : ''}"><td class="rn">${i + 1}</td>${colRole.map((_, c) => `<td title="${esc(row[c] == null ? '' : row[c])}">${esc(short(String(row[c] == null ? '' : row[c]), 26))}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>
    <div class="row" style="margin:6px 0">
      <label class="small">Heading row <input type="number" min="0" max="30" value="${raw.hdr + 1}" data-change="lhdr" data-side="${side}" style="width:64px;display:inline-block;padding:3px 6px"></label>
      ${hasAmt ? `<label class="chk small"><input type="checkbox" ${L.opts.negDebit ? 'checked' : ''} data-change="lneg"> Negative amounts are debits</label>` : ''}
      ${raw.sheets && raw.sheets.length > 1 ? `<label class="small">Sheet <select data-change="lsheet" data-side="${side}" style="width:auto;display:inline-block;padding:3px 6px">${raw.sheets.map((s, i) => `<option value="${i}" ${i === raw.sheet ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>` : ''}
    </div>
    <div class="note ${st.n ? '' : 'bad'}" style="margin-top:6px">${st.n ? `<b>${st.n}</b> transactions · debits ${fmt(st.dr)} · credits ${fmt(-st.cr)} · net ${fmt(st.sum)}${st.d1 ? ` · ${fmtD(st.d1)} to ${fmtD(st.d2)}` : ''}${L[side].skipped ? ` · ${L[side].skipped} opening/closing/total rows left out` : ''}${st.nodate ? ` · <span style="color:var(--warn)">${st.nodate} without a date</span>` : ''}` : 'No transactions found with these columns – set at least a Date (optional), and either Debit + Credit or Amount.'}</div>`;
  return h;
}
function sideCard(side){
  const L = state.ledger, S = L[side], raw = ui.lraw[side], st = ledgerStats(S.items);
  let body;
  if (raw) body = `<div class="small muted">${esc(raw.source)}</div>` + mappingPanel(side) + `<div class="row" style="margin-top:10px"><button class="btn sm" data-act="lclear" data-side="${side}">Replace with another list</button></div>`;
  else if (S.items.length) body = `<div class="note"><b>${st.n}</b> transactions · debits ${fmt(st.dr)} · credits ${fmt(-st.cr)} · net <b>${fmt(st.sum)}</b>${st.d1 ? `<br>${fmtD(st.d1)} to ${fmtD(st.d2)}` : ''}${S.skipped ? `<br>${S.skipped} opening/closing/total rows left out` : ''}</div><div class="row" style="margin-top:10px"><button class="btn sm" data-act="lclear" data-side="${side}">Replace with another list</button></div>`;
  else body = `<textarea class="paste" style="min-height:150px" data-lta="${side}" placeholder="Paste the transactions here (copy from Excel, your accounting package or a PDF table)…&#10;Date    Reference    Description    Debit    Credit" spellcheck="false"></textarea>
    <div class="row" style="margin-top:8px"><span class="muted small">or</span><button class="btn sm" data-act="lfile" data-side="${side}">Upload Excel / CSV file…</button></div>`;
  return `<div class="card pad"><div class="field"><label>${side === 'A' ? 'List A' : 'List B'} — name</label><input type="text" value="${esc(S.label)}" data-change="llabel" data-side="${side}" placeholder="e.g. ${side === 'A' ? 'Supplier statement' : 'Our creditors ledger'}"></div><div class="grid2"><div class="field"><label>Currency (optional)</label><input type="text" maxlength="6" value="${esc(S.cur || '')}" placeholder="e.g. USD" data-change="lcur" data-side="${side}"></div><div class="field"><label>Rate to compare</label><input type="number" step="0.0001" min="0" value="${S.rate || ''}" placeholder="1" data-change="lrate" data-side="${side}"></div></div>${body}</div>`;
}
function lloadView(){
  const L = state.ledger, p = L_PRESETS[L.preset] || L_PRESETS.statement, o = L.opts;
  const ready = L.A.items.length && L.B.items.length;
  return `<div class="note" style="margin-bottom:14px"><b>${esc(p.name)}</b> — ${esc(p.desc)}</div>
    <div class="sidebyside">${sideCard('A')}${sideCard('B')}</div>
    <div class="card pad" style="margin-top:16px"><h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-bottom:10px">Matching rules</h3>
    <div class="grid3"><div class="field"><label>Direction</label><select data-change="ldir"><option value="1" ${L.mirror ? 'selected' : ''}>Opposite — a debit in A is a credit in B</option><option value="0" ${!L.mirror ? 'selected' : ''}>Same — a debit in A is a debit in B</option></select>
      <span class="small muted">Statements and intercompany accounts are normally “opposite”.</span></div>
      <div class="field"><label>Date window (days)</label><input type="number" min="0" max="365" value="${o.days}" data-change="lopt" data-k="days"><span class="small muted">How far apart the dates may be for a match that is not backed by a reference.</span></div>
      <div class="field"><label>Amount tolerance (R)</label><input type="number" min="0" step="0.01" value="${o.tol}" data-change="lopt" data-k="tol"><span class="small muted">0.00 = amounts must agree to the cent.</span></div></div>
    <div class="row" style="gap:22px"><label class="chk"><input type="checkbox" ${o.grouped ? 'checked' : ''} data-change="lopt" data-k="grouped"> Match one item to several (e.g. one payment for two invoices)</label>
      <label class="chk"><input type="checkbox" ${o.skipBal ? 'checked' : ''} data-change="lopt" data-k="skipBal"> Leave out opening / closing balance and total rows</label>
      <label class="small">Dates are <select data-change="lopt" data-k="dateOrder" style="width:auto;display:inline-block;padding:3px 6px"><option value="dmy" ${o.dateOrder === 'dmy' ? 'selected' : ''}>day / month / year</option><option value="mdy" ${o.dateOrder === 'mdy' ? 'selected' : ''}>month / day / year</option></select></label></div></div>
    <div class="row" style="margin-top:16px"><button class="btn primary" data-act="lgo" ${ready ? '' : 'disabled'}>See matches &amp; differences →</button>${ready ? '' : '<span class="muted small">Load both lists to continue.</span>'}</div>`;
}

/* ---------- ledger results ---------- */
function lres(){
  if (!LM){
    const L = state.ledger, A = scaledSide(L.A), B = scaledSide(L.B);
    const mem = memLedgerManual(A, B, L.manual, L.rejected);
    LM = matchLedgers(A, B, { tol: L.opts.tol, days: L.opts.days, grouped: L.opts.grouped, mirror: L.mirror, manual: L.manual.concat(mem), rejected: L.rejected });
    LM.A = A; LM.B = B;
  }
  return LM;
}
const sumIdx = (items, idx) => round2(idx.reduce((a, i) => a + items[i].amt, 0));
function liCell(items, idx){ return idx.map(i => { const x = items[i]; return `<div class="li"><span class="muted small">${fmtD(x.date)}</span> <b class="mono">${esc(x.ref)}</b> ${esc(short(x.desc, 48))}</div>`; }).join(''); }
function methodChip(m){
  const cls = m.conf >= 90 ? 'ok' : m.conf >= 70 ? 'warn' : 'mut';
  return `<span class="chip ${cls}" title="Confidence ${m.conf}%">${esc(m.method)}</span>`;
}
function ledgerSummaryData(){
  const L = state.ledger, R = lres(), A = R.A, B = R.B;
  const mA = R.matches.filter(m => m.status === 'matched'), mD = R.matches.filter(m => m.status === 'diff');
  const unA = round2(R.unA.reduce((a, i) => a + A[i].amt, 0)), unB = round2(R.unB.reduce((a, j) => a + R.effB[j], 0));
  const diffAmt = round2(mD.reduce((a, m) => a + m.diff, 0));
  const total = round2(R.sumA - R.sumB);
  return { L, R, A, B, mA, mD, unA, unB, diffAmt, total, unexplained: round2(total - diffAmt - unA + unB) };
}
function lresView(){
  const L = state.ledger;
  if (!L.A.items.length || !L.B.items.length) return `<div class="card empty"><h3>Load both lists first</h3><p>Paste or upload the two ledgers or statements, then come back here.</p><button class="btn primary" data-act="tab" data-tab="lload">Load ledgers</button></div>`;
  const D = ledgerSummaryData(), R = D.R, sub = ui.lsub;
  const nA = D.A.length, nB = D.B.length;
  const itemsMatched = R.matches.reduce((a, m) => a + m.a.length, 0);
  const kp = `<div class="kpis">
    <div class="card kpi good"><b>${D.mA.length}</b><span>matched · ${nA ? Math.round(100 * itemsMatched / nA) : 0}% of ${esc(short(L.A.label || 'A', 22))}</span></div>
    <div class="card kpi ${D.mD.length ? 'bad' : 'good'}"><b>${D.mD.length}</b><span>matched, amounts differ (${fmt(D.diffAmt)})</span></div>
    <div class="card kpi ${R.unA.length ? 'warn' : 'good'}"><b>${R.unA.length}</b><span>only in ${esc(short(L.A.label || 'A', 22))} (${fmt(D.unA)})</span></div>
    <div class="card kpi ${R.unB.length ? 'warn' : 'good'}"><b>${R.unB.length}</b><span>only in ${esc(short(L.B.label || 'B', 22))} (${fmt(-D.unB)})</span></div>
    <div class="card kpi ${Math.abs(D.total) <= 0.005 ? 'good' : 'bad'}"><b>${fmt(D.total) === '–' ? '0.00' : fmt(D.total)}</b><span>difference between the two balances</span></div></div>`;
  const tb = `<div class="toolbar"><div class="seg">${[['sum', 'Reconciliation'], ['matched', 'Matched (' + D.mA.length + ')'], ['diff', 'Differences (' + D.mD.length + ')'], ['un', 'Unmatched (' + (R.unA.length + R.unB.length) + ')'], ['jnl', 'Correcting journal']].map(([k, t]) => `<button class="${sub === k ? 'on' : ''}" data-act="lsub" data-v="${k}">${t}</button>`).join('')}</div>
    ${sub !== 'sum' && sub !== 'jnl' ? `<input type="text" placeholder="Search…" value="${esc(ui.lq || '')}" data-change="lq">` : ''}
    <button class="btn sm" style="margin-left:auto" data-act="tab" data-tab="lload">Change lists / rules</button></div>`;
  let body = '';
  if (sub === 'sum') body = lSummary(D);
  else if (sub === 'matched') body = lMatchTable(D, D.mA, false);
  else if (sub === 'diff') body = lMatchTable(D, D.mD, true);
  else if (sub === 'jnl') body = lJournal(D);
  else body = lUnmatched(D);
  return kp + tb + body;
}
function lSummary0(D){
  const L = D.L, R = D.R;
  const row = (t, v, cls = '', l = false) => `<tr class="${cls}"><td class="${l ? 'l' : ''}">${t}</td><td class="num eq">${amt(v)}</td></tr>`;
  const mix = {}; R.matches.forEach(m => { mix[m.method] = (mix[m.method] || 0) + 1; });
  const big = [...R.unA.map(i => ({ s: 'A', x: D.A[i], v: D.A[i].amt })), ...R.unB.map(j => ({ s: 'B', x: D.B[j], v: -R.effB[j] }))].sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).slice(0, 10);
  return `<div class="sidebyside"><div class="card pad"><h3 style="margin-bottom:8px">Reconciliation</h3><table class="t recon"><tbody>
    ${row(`Balance per ${esc(L.A.label || 'A')}`, R.sumA)}
    ${row(`Balance per ${esc(L.B.label || 'B')}${L.mirror ? ' <span class="small muted">(sign reversed to compare)</span>' : ''}`, R.sumB)}
    ${row('Difference to explain', D.total, 'sum')}
    ${row(`Matched items whose amounts differ (${D.mD.length})`, D.diffAmt, '', true)}
    ${row(`In ${esc(L.A.label || 'A')} but not in ${esc(L.B.label || 'B')} (${R.unA.length})`, D.unA, '', true)}
    ${row(`In ${esc(L.B.label || 'B')} but not in ${esc(L.A.label || 'A')} (${R.unB.length})`, -D.unB, '', true)}
    ${row('Unexplained', D.unexplained, 'sum')}</tbody></table>
    <p class="small muted" style="margin:10px 0 0">${Math.abs(D.unexplained) < 0.005 ? '✓ The difference is fully explained by the items listed.' : 'The difference is not fully explained – check the amount tolerance.'}</p></div>
    <div class="card pad"><h3 style="margin-bottom:8px">How the items were matched</h3><table class="t"><tbody>${Object.entries(mix).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<tr><td>${esc(k)}</td><td class="num">${n}</td></tr>`).join('') || '<tr><td class="muted">No matches yet</td></tr>'}</tbody></table>
    <h3 style="margin:14px 0 8px">Largest unmatched items</h3><table class="t"><tbody>${big.map(b => `<tr><td class="small">${b.s === 'A' ? esc(short(L.A.label || 'A', 18)) : esc(short(L.B.label || 'B', 18))}</td><td class="small">${fmtD(b.x.date)} ${esc(b.x.ref)} ${esc(short(b.x.desc, 34))}</td><td class="num">${amt(b.v)}</td></tr>`).join('') || '<tr><td class="muted">Nothing unmatched 🎉</td></tr>'}</tbody></table></div></div>`;
}
function lMatchTable(D, list, showDiff){
  const q = norm(ui.lq || ''), L = D.L, R = D.R;
  let rows = list.filter(m => !q || norm(m.a.map(i => D.A[i].ref + ' ' + D.A[i].desc).join(' ') + ' ' + m.b.map(j => D.B[j].ref + ' ' + D.B[j].desc).join(' ')).includes(q));
  if (showDiff) rows = rows.slice().sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  const lim = ui.lall ? 100000 : 400, shown = rows.slice(0, lim);
  const tr = shown.map(m => { const n = R.matches.indexOf(m);
    return `<tr><td>${liCell(D.A, m.a)}</td><td class="num">${m.a.map(i => `<div>${amt(D.A[i].amt)}</div>`).join('')}</td><td>${liCell(D.B, m.b)}</td><td class="num">${m.b.map(j => `<div>${amt(D.B[j].amt)}</div>`).join('')}</td>
      <td class="num">${showDiff ? `<b>${amt(m.diff)}</b>` : (m.days ? m.days + 'd' : '–')}</td><td>${methodChip(m)}</td><td><button class="btn sm" data-act="lunmatch" data-n="${n}" title="Break this match">Unmatch</button></td></tr>`; }).join('');
  return `<div class="card scroll"><table class="t"><thead><tr><th>${esc(L.A.label || 'A')}</th><th class="num">Amount</th><th>${esc(L.B.label || 'B')}</th><th class="num">Amount</th><th class="num">${showDiff ? 'Difference' : 'Days apart'}</th><th>Matched by</th><th></th></tr></thead>
    <tbody>${tr || `<tr><td colspan="7" class="empty">${showDiff ? 'No differences – every matched pair agrees. 🎉' : 'Nothing here.'}</td></tr>`}</tbody></table></div>
    <p class="small muted">${rows.length} items${rows.length > lim ? ` — showing ${lim}. <a href="#" data-act="lmore">Show all</a>` : ''}. Wrong match? Use <b>Unmatch</b>; it will not be proposed again.</p>`;
}
function lUnmatched0(D){
  const L = D.L, R = D.R, q = norm(ui.lq || ''), sel = ui.lsel;
  const filt = (items, idx, side) => idx.filter(i => !q || norm(items[i].ref + ' ' + items[i].desc + ' ' + items[i].amt).includes(q)).sort((a, b) => (items[a].date || '').localeCompare(items[b].date || ''));
  const tbl = (side, items, idx, label) => {
    const rows = filt(items, idx, side).slice(0, ui.lall ? 100000 : 400);
    return `<div class="card scroll" style="max-height:60vh"><table class="t"><thead><tr><th></th><th>${esc(label || side)} — only here</th><th class="num">Amount</th></tr></thead><tbody>${rows.map(i => `<tr><td><input type="checkbox" ${sel[side].has(i) ? 'checked' : ''} data-change="lsel" data-side="${side}" data-i="${i}"></td><td>${liCell(items, [i])}</td><td class="num">${amt(items[i].amt)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">Nothing unmatched 🎉</td></tr>'}</tbody></table></div>`;
  };
  const sA = round2([...sel.A].reduce((a, i) => a + D.A[i].amt, 0)), sB = round2([...sel.B].reduce((a, j) => a + R.effB[j], 0));
  const can = sel.A.size && sel.B.size;
  return `<p class="small muted" style="margin-top:0">These items could not be matched automatically. Tick items on both sides that belong together and press <b>Match selected</b> (e.g. a payment recorded under a different reference).</p>
    <div class="sidebyside">${tbl('A', D.A, R.unA, L.A.label)}${tbl('B', D.B, R.unB, L.B.label)}</div>
    <div class="card actionbar"><span>Selected: <b>${sel.A.size}</b> in A (${fmt(sA) === '–' ? '0.00' : fmt(sA)}) · <b>${sel.B.size}</b> in B${L.mirror ? ' reversed' : ''} (${fmt(sB) === '–' ? '0.00' : fmt(sB)})</span>
      <span class="eq">Difference: <b>${fmt(round2(sA - sB)) === '–' ? '0.00' : fmt(round2(sA - sB))}</b></span><span class="grow" style="flex:1"></span>
      <button class="btn" data-act="lclearsel" ${sel.A.size + sel.B.size ? '' : 'disabled'}>Clear</button><button class="btn primary" data-act="lmatchsel" ${can ? '' : 'disabled'}>Match selected</button></div>`;
}

/* ---------- reports ---------- */
function sectionsTB(tab){
  const cos = state.companies, m = model(), S = [];
  const linked = [], todo = [];
  cos.forEach((co, i) => co.lines.forEach((ln, k) => {
    const r = m.res[i][k];
    if (r.target >= 0) linked.push([co.name, ln.code, ln.desc, ln.net, coName(r.target), Math.round(r.score * 100), r.status === 'manual' ? 'Manual' : 'Auto']);
    else if (['ambiguous', 'weak', 'none'].includes(r.status) && ln.net !== 0 && (m.loanGroups[i].has(groupOf(ln.code)) || r.status === 'ambiguous')) todo.push([co.name, ln.code, ln.desc, ln.net, r.cands[0] && r.cands[0].s >= 0.3 ? coName(r.cands[0].j) : '', r.cands[0] ? Math.round(r.cands[0].s * 100) : 0, r.status]);
  }));
  return { cos, m, linked, todo };
}
function getReport(){
  const today = new Date().toLocaleDateString('en-ZA'), L = state.ledger;
  const base = { sub: `Matchmaker · ${state.project.name ? state.project.name + ' · ' : ''}prepared ${today}` };
  if (ui.tab === 'audit') return { ...base, title: 'Audit trail', file: 'Audit trail', sections: [{ name: 'Audit trail', head: ['When', 'What'], rows: state.audit.map(e => [e.t.slice(0, 10) + ' ' + e.t.slice(11, 19), e.m]) }] };
  if (state.mode === 'ledger' && (ui.tab === 'lload' || ui.tab === 'lres')){
    const A = L.A, B = L.B, sa = ledgerStats(A.items), sb = ledgerStats(B.items);
    const loadSec = { name: 'Loaded lists', head: ['', A.label || 'List A', B.label || 'List B'], rows: [['Transactions', sa.n, sb.n], ['From', fmtD(sa.d1), fmtD(sb.d1)], ['To', fmtD(sa.d2), fmtD(sb.d2)], ['Debits', sa.dr, sb.dr], ['Credits', sa.cr, sb.cr], ['Net balance', sa.sum, sb.sum], ['Opening/closing/total rows left out', A.skipped, B.skipped]], money: [1, 2] };
    const itemSec = (lbl, it) => ({ name: 'Items – ' + lbl.slice(0, 18), title: 'Items: ' + lbl, head: ['Date', 'Reference', 'Description', 'Amount'], rows: it.map(x => [fmtD(x.date), x.ref, x.desc, x.amt]), money: [3], excelOnly: true });
    if (ui.tab === 'lload' || !A.items.length || !B.items.length)
      return { ...base, title: 'Ledger comparison – loaded lists', file: 'Ledger lists', sections: [loadSec, itemSec(A.label || 'List A', A.items), itemSec(B.label || 'List B', B.items)] };
    const D = ledgerSummaryData(), R = D.R;
    const mrow = m => [m.a.map(i => `${fmtD(D.A[i].date)} ${D.A[i].ref} ${D.A[i].desc}`.trim()).join(' | '), round2(m.a.reduce((s, i) => s + D.A[i].amt, 0)), m.b.map(j => `${fmtD(D.B[j].date)} ${D.B[j].ref} ${D.B[j].desc}`.trim()).join(' | '), round2(m.b.reduce((s, j) => s + D.B[j].amt, 0)), m.diff, m.days, m.method, m.conf];
    const mh = [A.label || 'A', 'Amount', B.label || 'B', 'Amount', 'Difference', 'Days apart', 'Matched by', 'Confidence %'];
    const unrow = (items, idx, eff) => idx.map(i => [fmtD(items[i].date), items[i].ref, items[i].desc, items[i].amt]);
    return { ...base, title: `Reconciliation: ${A.label || 'A'} vs ${B.label || 'B'}`, file: 'Ledger reconciliation', sections: [
      { name: 'Reconciliation', head: ['Item', 'Amount'], money: [1], rows: [[`Balance per ${A.label || 'A'}`, R.sumA], [`Balance per ${B.label || 'B'}${L.mirror ? ' (sign reversed)' : ''}`, R.sumB], ['Difference to explain', D.total], [`Matched items whose amounts differ (${D.mD.length})`, D.diffAmt], [`Only in ${A.label || 'A'} (${R.unA.length})`, D.unA], [`Only in ${B.label || 'B'} (${R.unB.length})`, -D.unB]], total: ['Unexplained', D.unexplained] },
      { name: 'Ageing', title: 'Ageing of unmatched items (as at ' + ageRows(D).asOf + ')', head: ['Age (days)', (A.label || 'A') + ' items', 'Amount', (B.label || 'B') + ' items', 'Amount'], rows: ageRows(D).rows, money: [2, 4] },
      { name: 'Differences', title: 'Matched – amounts differ', head: mh, rows: D.mD.map(mrow), money: [1, 3, 4], tone: D.mD.map(() => 'bad') },
      { name: 'Only in ' + (A.label || 'A').slice(0, 20), title: `Only in ${A.label || 'A'}`, head: ['Date', 'Reference', 'Description', 'Amount'], rows: unrow(D.A, R.unA), money: [3], tone: R.unA.map(() => 'warn'), total: ['Total', '', '', D.unA] },
      { name: 'Only in ' + (B.label || 'B').slice(0, 20), title: `Only in ${B.label || 'B'}`, head: ['Date', 'Reference', 'Description', 'Amount'], rows: unrow(D.B, R.unB), money: [3], tone: R.unB.map(() => 'warn'), total: ['Total', '', '', round2(R.unB.reduce((a, j) => a + D.B[j].amt, 0))] },
      { name: 'Matched', title: 'Matched – amounts agree', head: mh, rows: D.mA.map(mrow), money: [1, 3, 4], tone: D.mA.map(() => 'ok') }
    ] };
  }
  if (state.mode !== 'tb' || !state.companies.length) return null;
  const { cos, m, linked, todo } = sectionsTB();
  const compRows = cos.map((c, i) => [i + 1, c.name, c.lines.length, m.res[i].filter(r => r.target >= 0).length, todoCount(i), c.interest ? 'Yes' : 'No']);
  if (ui.tab === 'tb')
    return { ...base, title: 'Intercompany loan accounts – companies and linked loans', file: 'Intercompany loan accounts', sections: [
      { name: 'Companies', head: ['#', 'Company', 'Accounts', 'Linked loan accounts', 'To review', 'Charges interest'], rows: compRows },
      { name: 'Linked loans', title: 'Linked loan accounts', head: ['Company', 'Account', 'Description in trial balance', 'Balance (Dr + / Cr −)', 'Linked to company', 'Match %', 'Assigned'], rows: linked, money: [3] },
      { name: 'To review', title: 'Lines needing review', head: ['Company', 'Account', 'Description', 'Balance', 'Closest company', 'Score %', 'Status'], rows: todo, money: [3], excelOnly: true }] };
  if (ui.tab === 'recon'){
    const ps = orientedPairs();
    const rows = ps.map(p => { const A = p.flip ? p.j : p.i, B = p.flip ? p.i : p.j; return [coName(A), codesOf(A, B), p.flip ? p.b : p.a, coName(B), codesOf(B, A), p.flip ? p.a : p.b, p.diff, p.status === 'agree' ? 'Agrees' : p.status === 'diff' ? 'Difference' : 'Missing on one side']; });
    const allP = m.pairs;
    const matrix = { name: 'Matrix', title: 'Differences matrix (A + B)', head: [''].concat(cos.map((c, j) => (j + 1) + '. ' + short(c.name, 22))), money: cos.map((_, j) => j + 1), excelOnly: true,
      rows: cos.map((c, i) => [(i + 1) + '. ' + c.name].concat(cos.map((_, j) => { if (i === j) return ''; const p = allP.find(x => (x.i === i && x.j === j) || (x.i === j && x.j === i)); return p ? p.diff : ''; }))) };
    return { ...base, title: 'Intercompany loan reconciliation', file: 'Intercompany reconciliation', sections: [
      { name: 'Summary', head: ['Measure', 'Value'], rows: [['Companies', cos.length], ['Company pairs with loans', allP.length], ['Agree', allP.filter(p => p.status === 'agree').length], ['Differences', allP.filter(p => p.status === 'diff').length], ['Missing on one side', allP.filter(p => p.status === 'onesided').length], ['Tolerance (R)', state.settings.tolerance]] },
      { name: 'Pairs', title: 'Pairs (as filtered on screen)', head: ['Company A', 'A account(s)', 'A balance', 'Company B', 'B account(s)', 'B balance', 'Difference (A + B)', 'Status'], rows, money: [2, 5, 6], tone: ps.map(p => p.status === 'agree' ? 'ok' : p.status === 'diff' ? 'bad' : 'warn'), total: ['', '', '', '', '', 'Total', round2(ps.reduce((a, p) => a + p.diff, 0)), ''] },
      matrix,
      { name: 'Loan lines', title: 'All linked loan lines', head: ['Company', 'Account', 'Description', 'Balance', 'Linked to', 'Match %', 'Assigned'], rows: linked, money: [3], excelOnly: true }] };
  }
  if (ui.tab === 'review'){
    const rows = reviewRows().map(({ i, ln, r }) => [coName(i), ln.code, ln.desc, ln.net, r.cands[0] && r.cands[0].s >= 0.3 ? coName(r.cands[0].j) : '', r.cands[0] ? Math.round(r.cands[0].s * 100) : 0, r.target >= 0 ? coName(r.target) : r.status === 'ignored' ? 'Ignored (not a group company)' : '', r.status]);
    return { ...base, title: 'Intercompany loans – match review (' + ({ todo: 'to review', auto: 'auto-matched', manual: 'manual', ignored: 'ignored', all: 'all lines' }[ui.review.filter]) + ')', file: 'Match review', sections: [{ name: 'Review', head: ['Company', 'Account', 'Description', 'Balance', 'Closest company', 'Score %', 'Linked to', 'Status'], rows, money: [3], tone: rows.map(r => r[7] === 'auto' || r[7] === 'manual' ? 'ok' : r[7] === 'ignored' ? '' : 'warn') }] };
  }
  if (ui.tab === 'fix'){
    const { rows, J } = fixData();
    return { ...base, title: 'Correcting journals – intercompany loans', file: 'Correcting journals', sections: [
      { name: 'Pairs', title: 'Pairs that do not agree', head: ['Company A', 'Balance A', 'Company B', 'Balance B', 'Difference', 'Adjust', 'Account', 'Post amount', 'Included'], rows: rows.map(r => [coName(r.p.i), r.p.a, coName(r.p.j), r.p.b, r.p.diff, coName(r.x), r.acct, r.amount, r.on ? 'Yes' : 'No']), money: [1, 3, 4, 7], tone: rows.map(r => r.on ? 'ok' : 'warn') },
      { name: 'Journal lines', head: ['Company', 'Reference', 'Date', 'Account', 'Description', 'Debit', 'Credit'], rows: J.flatMap(j => j.entries.map(e => [j.co.name, j.ref, fmtD(j.date), e.account, e.desc, e.amount > 0 ? e.amount : '', e.amount < 0 ? -e.amount : ''])), money: [5, 6] }] };
  }
  if (ui.tab === 'jnl'){
    const i = ui.jco, co = cos[i], S = state.settings, rows = journalData(i), J = journalEntries(i, rows);
    const all = []; cos.forEach((c, n) => { const r = journalData(n), j = journalEntries(n, r); j.entries.forEach(e => all.push([c.name, j.ref, fmtD(j.date), e.account, e.desc, e.amount > 0 ? e.amount : '', e.amount < 0 ? -e.amount : ''])); });
    return { ...base, sub: `${co.name} · journal ${J.ref} · ${fmtD(J.date)} · period ${J.period} · ${S.rate}% for ${S.months} months · prepared ${today}`, title: 'Interest journal – ' + co.name, file: 'Interest journal ' + safeName(co.name), sections: [
      { name: 'Journal', head: ['Account', 'Description', 'Line', 'Debit', 'Credit'], rows: J.entries.map(e => [e.account, e.desc, e.tname || '', e.amount > 0 ? e.amount : '', e.amount < 0 ? -e.amount : '']), money: [3, 4], total: ['Total', '', '', round2(J.entries.filter(e => e.amount > 0).reduce((a, e) => a + e.amount, 0)), round2(J.entries.filter(e => e.amount < 0).reduce((a, e) => a - e.amount, 0))] },
      { name: 'Loan lines', title: 'Loan accounts considered', head: ['In journal', 'Account', 'Description', 'Linked company', 'Balance', 'Their books', 'Rate %', 'Interest'], rows: rows.map(r => [r.sel ? 'Yes' : 'No', r.ln.code, r.ln.desc, r.tname, r.ln.net, r.hasTheirs ? r.theirs : '', r.rate, r.interest]), money: [4, 5, 7] },
      { name: 'All journals', title: 'All companies – journal lines', head: ['Company', 'Reference', 'Date', 'Account', 'Description', 'Debit', 'Credit'], rows: all, money: [5, 6], excelOnly: true }] };
  }
  return null;
}
function reportHTML(R){
  const cell = (v, c, sec) => typeof v === 'number' ? ((sec.money || []).includes(c) ? `<td class="n">${fmt(v) === '–' ? '0.00' : fmt(v)}</td>` : `<td class="n">${v}</td>`) : `<td>${esc(v == null ? '' : v)}</td>`;
  const secs = R.sections.filter(s => !s.excelOnly);
  if (state.audit.length && ui.tab !== 'audit') secs.push({ name: 'Recent decisions', head: ['When', 'What'], rows: state.audit.slice(-25).map(e => [e.t.slice(0, 10) + ' ' + e.t.slice(11, 19), e.m]) });
  return `<div class="pr"><div class="prh">${LOGO}<div><h1>${esc(R.title)}</h1><div class="sub">${esc(R.sub)}</div></div></div>` + secs.map(sec => `<h2>${esc(sec.title || sec.name)}</h2><table><thead><tr>${sec.head.map((h, c) => `<th class="${(sec.money || []).includes(c) ? 'n' : ''}">${esc(h)}</th>`).join('')}</tr></thead><tbody>${sec.rows.map((r, n) => `<tr class="${sec.tone && sec.tone[n] ? 't-' + sec.tone[n] : ''}">${r.map((v, c) => cell(v, c, sec)).join('')}</tr>`).join('') || `<tr><td colspan="${sec.head.length}">Nothing to show</td></tr>`}</tbody>${sec.total ? `<tfoot><tr class="tot">${sec.total.map((v, c) => cell(v, c, sec)).join('')}</tr></tfoot>` : ''}</table>`).join('')
    + `<table class="sign"><tbody><tr><td>Prepared by</td><td></td><td>Date</td><td></td></tr><tr><td>Reviewed by</td><td></td><td>Date</td><td></td></tr></tbody></table></div>`;
}
function coverSheet(R){
  return { name: 'Cover', title: 'Matchmaker – ' + R.title, subtitle: R.sub, head: ['Item', 'Detail'], rows: [['Report', R.title], ['Project', state.project.name || ''], ['Prepared on', new Date().toLocaleDateString('en-ZA')], ['', ''], ['Prepared by', ''], ['Date prepared', ''], ['Reviewed by', ''], ['Date reviewed', ''], ['Signature', ''], ['', ''], ['Sheets in this workbook', R.sections.filter(s => !s.pdfOnly).map(s => s.title || s.name).join(' · ')]] };
}
function exportReport(f){
  const R = getReport(); if (!R){ toast('Nothing to export yet – load some data first.'); return; }
  if (f === 'xlsx'){
    const sheets = R.sections.filter(s => !s.pdfOnly).map(s => ({ name: s.name, title: (s.title || s.name) === R.title ? R.title : R.title + ' – ' + (s.title || s.name), subtitle: R.sub, head: s.head, rows: s.rows, money: s.money, total: s.total, tone: s.tone }));
    sheets.unshift(coverSheet(R));
    if (state.audit.length && ui.tab !== 'audit') sheets.push({ name: 'Audit trail', title: 'Audit trail', subtitle: R.sub, head: ['When', 'What'], rows: state.audit.map(e => [e.t.slice(0, 10) + ' ' + e.t.slice(11, 19), e.m]) });
    download(`Matchmaker - ${safeName(R.file)} ${new Date().toISOString().slice(0, 10)}.xlsx`, makeXlsx(sheets));
    audit('Excel report exported: ' + R.title); toast('Excel report downloaded');
  } else { audit('PDF report prepared: ' + R.title); preparePrint(R, true); }
}
/* One workbook with every step: the “group pack” */
function exportPack(){
  const keep = ui.tab, sheets = [], seen = new Set();
  const steps = state.mode === 'tb' ? [['tb', 'Cos'], ['recon', 'Recon'], ['review', 'Review'], ['fix', 'Fix'], ['jnl', 'Jnl']] : [['lload', 'Lists'], ['lres', 'Rec']];
  let title = '', sub = '';
  try {
    steps.forEach(([tab, pre]) => {
      ui.tab = tab; if (tab === 'review') ui.review.filter = 'all';
      let R; try { R = getReport(); } catch (e) { R = null; }
      if (!R) return; title = title || R.title; sub = sub || R.sub;
      R.sections.filter(s => !s.pdfOnly).forEach(s => {
        let n = (pre + ' ' + s.name).slice(0, 31), k = 2; while (seen.has(n.toLowerCase())) n = (pre + ' ' + s.name).slice(0, 28) + ' ' + k++;
        seen.add(n.toLowerCase());
        sheets.push({ name: n, title: R.title + ' – ' + (s.title || s.name), subtitle: R.sub, head: s.head, rows: s.rows, money: s.money, total: s.total, tone: s.tone });
      });
    });
  } finally { ui.tab = keep; }
  if (!sheets.length){ toast('Nothing to export yet – load some data first.'); return; }
  sheets.unshift(coverSheet({ title: 'Complete pack', sub, file: 'Pack', sections: sheets.map(s => ({ name: s.name, rows: s.rows })) }));
  if (state.audit.length) sheets.push({ name: 'Audit trail', title: 'Audit trail', subtitle: sub, head: ['When', 'What'], rows: state.audit.map(e => [e.t.slice(0, 10) + ' ' + e.t.slice(11, 19), e.m]) });
  download(`Matchmaker - Complete pack ${new Date().toISOString().slice(0, 10)}.xlsx`, makeXlsx(sheets));
  audit('Complete pack exported (' + sheets.length + ' sheets)'); toast('Complete pack downloaded');
}
function preparePrint(R, doPrint){
  let pa = $('#printarea'); if (!pa){ pa = document.createElement('div'); pa.id = 'printarea'; document.body.appendChild(pa); }
  pa.innerHTML = reportHTML(R); document.body.classList.add('print-report');
  const done = () => { document.body.classList.remove('print-report'); window.removeEventListener('afterprint', done); document.removeEventListener('pointerdown', done); };
  if (doPrint){ window.addEventListener('afterprint', done); document.addEventListener('pointerdown', done, { once: true }); setTimeout(() => window.print(), 60); }
}

/* ---------- events for the new screens ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]'); if (!t) return;
  const a = t.dataset.act, d = t.dataset, L = state.ledger;
  if (a === 'start'){
    e.stopPropagation();
    if (d.kind === 'tb'){ state.mode = 'tb'; ui.tab = state.companies.length ? 'recon' : 'tb'; }
    else { state.mode = 'ledger'; applyPreset(d.kind); ui.tab = 'lload'; }
    dirty(); render(); window.scrollTo(0, 0);
  }
  else if (a === 'cont'){ state.mode = d.mode; ui.tab = d.mode === 'tb' ? 'recon' : (L.A.items.length && L.B.items.length ? 'lres' : 'lload'); dirty(); render(); }
  else if (a === 'exp') exportReport(d.f);
  else if (a === 'pack') exportPack();
  else if (a === 'lclear'){ delete ui.lraw[d.side]; L[d.side].items = []; L[d.side].skipped = 0; L.manual = []; L.rejected = []; dirty(); render(); }
  else if (a === 'lfile'){ ui.lfileSide = d.side; $('#fileLedger').click(); }
  else if (a === 'lgo'){ ui.tab = 'lres'; ui.lsub = 'sum'; render(); window.scrollTo(0, 0); }
  else if (a === 'lsub'){ ui.lsub = d.v; render(); }
  else if (a === 'lmore'){ e.preventDefault(); ui.lall = true; render(); }
  else if (a === 'lunmatch'){
    const R0 = lres(), m = R0.matches[+d.n]; if (!m) return;
    snap('Unmatch'); audit('Unmatched: ' + m.a.map(i => R0.A[i].ref || R0.A[i].desc).join(', ') + ' ↔ ' + m.b.map(j => R0.B[j].ref || R0.B[j].desc).join(', ') + ' (' + m.method + ')');
    const mi = L.manual.findIndex(x => x.a.join() === m.a.join() && x.b.join() === m.b.join());
    if (mi >= 0) L.manual.splice(mi, 1); else m.a.forEach(i => m.b.forEach(j => L.rejected.push(i + '|' + j)));
    dirty(); render();
  }
  else if (a === 'lclearsel'){ ui.lsel = { A: new Set(), B: new Set() }; render(); }
  else if (a === 'lmatchsel'){
    const s = ui.lsel; if (!s.A.size || !s.B.size) return;
    const R0 = lres(); snap('Manual match'); audit('Matched manually: ' + [...s.A].map(i => R0.A[i].ref || R0.A[i].desc).join(', ') + ' ↔ ' + [...s.B].map(j => R0.B[j].ref || R0.B[j].desc).join(', '));
    memLedgerAdd(R0.A, R0.B, [...s.A], [...s.B]); L.manual.push({ a: [...s.A], b: [...s.B] }); ui.lsel = { A: new Set(), B: new Set() }; dirty(); render(); toast('Matched');
  }
});
document.addEventListener('change', e => {
  const t = e.target, a = t.dataset.change; if (!a) return;
  const L = state.ledger, side = t.dataset.side;
  if (a === 'llabel'){ L[side].label = t.value; dirty(); render(); }
  else if (a === 'ldir'){ L.mirror = t.value === '1'; dirty(); render(); }
  else if (a === 'lopt'){
    const k = t.dataset.k; L.opts[k] = t.type === 'checkbox' ? t.checked : t.type === 'number' ? Math.max(0, parseFloat(t.value) || 0) : t.value;
    if (['dateOrder', 'skipBal'].includes(k)) ['A', 'B'].forEach(s => rebuildLedger(s)); else dirty();
    render();
  }
  else if (a === 'lneg'){ L.opts.negDebit = t.checked; ['A', 'B'].forEach(s => rebuildLedger(s)); render(); }
  else if (a === 'lmap'){
    const raw = ui.lraw[side], col = +t.dataset.col, role = t.value;
    for (const k in raw.map) if (raw.map[k] === col) raw.map[k] = -1;
    if (role){ raw.map[role] = col; if (role === 'debit' || role === 'credit') raw.map.amount = -1; if (role === 'amount'){ raw.map.debit = -1; raw.map.credit = -1; } }
    rebuildLedger(side); render();
  }
  else if (a === 'lhdr'){ const raw = ui.lraw[side]; raw.hdr = Math.max(0, parseInt(t.value) || 0) - 1; rebuildLedger(side); render(); }
  else if (a === 'lsheet'){ const raw = ui.lraw[side]; raw.sheet = +t.value; const sh = raw.sheets[raw.sheet]; const gm = guessLedgerMap(sh.rows); raw.grid = sh.rows; raw.hdr = gm.hdr; raw.map = gm.map; raw.source = raw.source.split(' – ')[0] + ' – ' + sh.name; rebuildLedger(side); render(); }
  else if (a === 'lq'){ ui.lq = t.value; render(); }
  else if (a === 'lsel'){ const s = ui.lsel[side], i = +t.dataset.i; if (t.checked) s.add(i); else s.delete(i); render(); }
  else if (t.id === 'fileLedger'){ if (t.files[0]) ledgerFile(t.files[0], ui.lfileSide || 'A'); ui.lfileSide = null; t.value = ''; }
});
document.addEventListener('change', e => { const t = e.target; if (t.id === 'fileLedger'){ if (t.files[0]) ledgerFile(t.files[0], ui.lfileSide || 'A'); ui.lfileSide = null; t.value = ''; } });
const _ltaTimers = {};
document.addEventListener('input', e => {
  const t = e.target; if (!t.dataset || !t.dataset.lta) return;
  clearTimeout(_ltaTimers[t.dataset.lta]);
  _ltaTimers[t.dataset.lta] = setTimeout(() => { if (t.value.trim().length < 5) return; ledgerFromGrid(t.dataset.lta, splitDelimited(t.value)); render(); }, 350);
});
ui.lraw = {}; ui.lsel = { A: new Set(), B: new Set() }; ui.lsub = 'sum'; ui.lq = ''; ui.lall = false;
