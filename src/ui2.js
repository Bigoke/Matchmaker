
/* ---------- dialogs ---------- */
function openDialog(html){
  const d = $('#dlg'); d.innerHTML = html;
  if (!d.open) d.showModal();
  return d;
}
function closeDialog(){ const d = $('#dlg'); if (d.open) d.close(); d.classList.remove('wide'); ui.pair = null; ui.mp = null; }
function openPaste(text = '', replaceIdx = -1){
  const rep = replaceIdx >= 0 ? state.companies[replaceIdx] : null;
  const d = openDialog(`<div class="dh"><h3>${rep ? 'Replace trial balance — ' + esc(rep.name) : 'Paste a trial balance'}</h3><button class="btn sm" data-act="closedlg">Cancel</button></div>
    <div class="db"><p class="small muted" style="margin-top:0">Copy the rows from Excel or your accounting package — including the heading line with the company name and the Account / Description / DR / CR columns — and paste below.</p>
    <textarea id="pasteTa" class="paste" placeholder="Company name 2025 | Prepared by…&#10;Trial Balance : 01/03/2024 to 28/02/2025&#10;Last Year&#9;Account&#9;&#9;DR&#9;CR&#10;…" spellcheck="false"></textarea>
    <div id="pasteInfo" style="margin-top:12px"></div></div>
    <div class="df"><button class="btn" data-act="closedlg">Cancel</button><button class="btn primary" id="pasteGo" disabled>Add company</button></div>`);
  const ta = $('#pasteTa', d), info = $('#pasteInfo', d), go = $('#pasteGo', d);
  let parsed = null;
  const run = () => {
    const t = ta.value.trim();
    if (!t){ info.innerHTML = ''; go.disabled = true; parsed = null; return; }
    const p = parseTBText(t);
    if (p.error){ info.innerHTML = `<div class="note bad">${esc(p.error)}</div>`; go.disabled = true; parsed = null; return; }
    parsed = p;
    const exists = !rep && state.companies.some(c => norm(c.name) === norm(p.name));
    const sample = p.lines.slice(0, 6).map(l => `<tr><td class="mono">${esc(l.code)}</td><td>${esc(l.desc)}</td><td class="num">${amt(l.net)}</td></tr>`).join('');
    info.innerHTML = `<div class="grid2"><div class="field"><label>Company name</label><input type="text" id="pasteName" value="${esc(rep ? rep.name : p.name)}" ${rep ? 'disabled' : ''}></div>
      <div><div class="lbl">Detected</div><p class="small" style="margin:6px 0">${p.lines.length} accounts${p.periodEnd ? ` · ${fmtDate(p.periodStart, 'dmy')} to ${fmtDate(p.periodEnd, 'dmy')}` : ''}</p></div></div>
      ${exists ? '<div class="note warn" style="margin-bottom:10px">A company with this name is already loaded — its trial balance will be replaced.</div>' : ''}
      ${(p.warn || []).map(w => `<div class="note warn" style="margin-bottom:10px">${esc(w)}</div>`).join('')}
      <table class="t"><thead><tr><th>Account</th><th>Description</th><th class="num">Balance</th></tr></thead><tbody>${sample}</tbody></table>`;
    go.disabled = false; go.textContent = rep || exists ? 'Replace trial balance' : 'Add company';
    const nmEl = $('#pasteName', d);
    if (nmEl && !rep){
      nmEl.placeholder = 'Type the company name';
      const chk = () => { go.disabled = !nmEl.value.trim(); };
      nmEl.addEventListener('input', chk); chk();
    }
  };
  ta.addEventListener('input', run);
  go.addEventListener('click', () => {
    if (!parsed) return;
    const nm = $('#pasteName', d); if (nm && !rep && nm.value.trim()) parsed.name = nm.value.trim();
    if (!rep && !parsed.name) return;
    const r = upsertCompany(parsed, replaceIdx); const nMem = memApplyTB(); if (nMem) toast(`${nMem} remembered assignments applied`);
    ui.sel = r.idx; ui.tab = 'tb'; closeDialog(); render();
    toast(`${r.replaced ? 'Updated' : 'Added'} “${state.companies[r.idx].name}” — ${parsed.lines.length} accounts`);
  });
  if (text){ ta.value = text; run(); }
  ta.focus();
}
async function openImportFile(file){
  try {
    const buf = await file.arrayBuffer();
    const sheets = await readWorkbookSheets(buf);
    const found = [];
    for (const sh of sheets){
      const p = parseTBGrid(sh.rows);
      if (p.error || !p.hasHeader || p.lines.length < 2) continue;
      found.push({ sheet: sh.name, p });
    }
    // interest flags ("Geen"/"Rente") recorded in the workbook's Interest sheet, keyed by sheet number
    const flags = {};
    for (const sh of sheets){
      const r = sh.rows.findIndex(row => row.some(c => typeof c === 'string' && /hef rente|charge interest/i.test(c)));
      if (r < 0) continue;
      const fr = sh.rows[r];
      for (let h = 0; h < Math.min(8, sh.rows.length); h++){
        const hr = sh.rows[h]; let ok = 0;
        const isNo = c => Number.isInteger(hr[c]) && hr[c] >= 1;
        fr.forEach((v, c) => { if (typeof v === 'string' && /^(geen|rente)$/i.test(v.trim()) && isNo(c)) ok++; });
        if (ok >= 3){ fr.forEach((v, c) => { if (typeof v === 'string' && /^(geen|rente)$/i.test(v.trim()) && isNo(c)) flags[String(hr[c])] = !/^geen$/i.test(v.trim()); }); break; }
      }
    }
    const nFlags = found.filter(f => flags[f.sheet] !== undefined).length;
    if (!found.length){ toast('No trial-balance sheets found in that workbook (looking for sheets with Account / DR / CR columns).'); return; }
    const d = openDialog(`<div class="dh"><h3>Import from ${esc(file.name)}</h3><button class="btn sm" data-act="closedlg">Cancel</button></div>
      <div class="db"><p class="small muted" style="margin-top:0">${found.length} trial-balance sheets found out of ${sheets.length} sheets. Untick any you do not want.${nFlags ? ` The “Geen / Rente” interest settings for ${nFlags} companies were found in the workbook and will be applied.` : ''}</p>
      <div class="toolbar"><button class="btn sm" id="impAll">Select all</button><button class="btn sm" id="impNone">Select none</button></div>
      <table class="t"><thead><tr><th></th><th>Sheet</th><th>Company</th><th class="num">Accounts</th><th></th></tr></thead><tbody>
      ${found.map((f, n) => { const ex = state.companies.some(c => norm(c.name) === norm(f.p.name)); return `<tr><td><input type="checkbox" class="impck" data-n="${n}" checked></td><td>${esc(f.sheet)}</td><td>${esc(f.p.name)}</td><td class="num">${f.p.lines.length}</td><td>${ex ? '<span class="chip warn">replaces existing</span>' : '<span class="chip ok">new</span>'}</td></tr>`; }).join('')}</tbody></table></div>
      <div class="df"><button class="btn" data-act="closedlg">Cancel</button><button class="btn primary" id="impGo">Import selected</button></div>`);
    $('#impAll', d).onclick = () => $$('.impck', d).forEach(c => c.checked = true);
    $('#impNone', d).onclick = () => $$('.impck', d).forEach(c => c.checked = false);
    $('#impGo', d).onclick = () => {
      let n = 0, last = -1;
      $$('.impck', d).filter(c => c.checked).forEach(c => { const f = found[+c.dataset.n]; const r = upsertCompany(f.p); last = r.idx; n++; if (flags[f.sheet] !== undefined) state.companies[r.idx].interest = flags[f.sheet]; });
      memApplyTB(); dirty();
      closeDialog(); ui.tab = 'recon'; if (last >= 0) ui.sel = 0; render();
      toast(`Imported ${n} trial balance${n === 1 ? '' : 's'}`);
    };
  } catch (e){ console.error(e); toast('Could not read that file: ' + e.message); }
}
async function handleFiles(files){
  const f = [...files]; if (!f.length) return;
  if (state.mode === 'ledger'){ for (const file of f) await ledgerFile(file, ui.lfileSide || (state.ledger.A.items.length && !state.ledger.B.items.length ? 'B' : 'A')); ui.lfileSide = null; return; }
  if (state.mode !== 'tb'){ state.mode = 'tb'; ui.tab = 'tb'; render(); }
  for (const file of f){
    if (/\.(xlsx|xlsm|xltx|xltm)$/i.test(file.name)) await openImportFile(file);
    else if (/\.pdf$/i.test(file.name) || IMG_RE.test(file.name)){ try {
      let g; if (IMG_RE.test(file.name)) g = await readScanned(file);
      else { try { g = await pdfToGrid(await file.arrayBuffer()); } catch (e){ if (!/scanned|no readable text/i.test(e.message)) throw e; g = await readScanned(file); } }
      if (g) openPaste(g.map(r => r.join('\t')).join('\n')); } catch (e){ toast('Could not read that file: ' + e.message); } }
    else { const t = await file.text(); openPaste(t); }
  }
}

/* ---------- session ---------- */
function exportSession(){
  state.maps = MAPS.slice(); const d = new Date().toISOString().slice(0, 10), nm = (state.project.name || '').trim();
  download(`Matchmaker${nm ? ' - ' + safeName(nm) : ''} ${d}.matchmaker.json`, new Blob([JSON.stringify(state)], { type: 'application/json' }));
  audit('Project file saved');
}
async function importSession(file){
  try {
    const s = JSON.parse(await file.text());
    if (!s.companies) throw new Error('not a project file');
    if ((state.companies.length || state.ledger.A.items.length) && !confirm('Replace everything currently loaded with this saved project?\n\n(To compare with a previous period instead, use “Compare with previous period”.)')) return;
    state = normState(s); mapsMerge(s.maps); ui.tab = 'home'; ui.lraw = {}; ui.undo = []; dirty(); ui.sel = 0; ui.jco = 0; render(); toast('Project loaded' + (state.project.name ? ': ' + state.project.name : ''));
  } catch (e){ toast('That file is not a Matchmaker project.'); }
}
function exportPairsCSV(){
  const ps = orientedPairs(), rows = [['Company A', 'A account(s)', 'A balance', 'Company B', 'B account(s)', 'B balance', 'Difference', 'Status']];
  ps.forEach(p => { const A = p.flip ? p.j : p.i, B = p.flip ? p.i : p.j;
    rows.push([coName(A), codesOf(A, B), (p.flip ? p.b : p.a).toFixed(2), coName(B), codesOf(B, A), (p.flip ? p.a : p.b).toFixed(2), p.diff.toFixed(2), p.status === 'agree' ? 'Agrees' : p.status === 'diff' ? 'Difference' : 'Missing on one side']); });
  download('Intercompany reconciliation.csv', rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n');
}

/* ---------- events ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]'); if (!t) return;
  const a = t.dataset.act, d = t.dataset;
  if (a === 'undo'){ undo(); return; }
  if (a === 'tab'){ e.preventDefault(); ui.tab = d.tab; closeDialog(); render(); window.scrollTo(0, 0); }
  else if (a === 'paste') openPaste();
  else if (a === 'import') $('#fileXlsx').click();
  else if (a === 'replace') openPaste('', ui.sel);
  else if (a === 'remove'){ if (confirm(`Remove “${state.companies[ui.sel].name}” and its trial balance?`)){ removeCompany(ui.sel); render(); } }
  else if (a === 'selco'){ ui.sel = +d.i; render(); }
  else if (a === 'tbfilter'){ ui.tbFilter = d.f; render(); }
  else if (a === 'rmode'){ ui.recon.mode = d.v; render(); }
  else if (a === 'rfilter'){ ui.recon.filter = d.v; render(); }
  else if (a === 'rmm'){ ui.recon.matrixMode = d.v; render(); }
  else if (a === 'rsort'){ const R = ui.recon; if (R.sortKey === d.k) R.sortDir *= -1; else { R.sortKey = d.k; R.sortDir = d.k === 'diff' ? -1 : 1; } render(); }
  else if (a === 'pair'){ ui.pair = { i: +d.i, j: +d.j }; openDialog(pairDialogHTML()); }
  else if (a === 'closedlg') closeDialog();
  else if (a === 'revfilter'){ ui.review.filter = d.v; render(); }
  else if (a === 'exportpairs') exportPairsCSV();
  else if (a === 'ignoreall'){
    const m = model(); const keys = new Set();
    state.companies.forEach((co, i) => co.lines.forEach((ln, k) => {
      const r = m.res[i][k];
      if (['weak', 'none'].includes(r.status) && ln.net !== 0 && (ui.review.all || m.loanGroups[i].has(groupOf(ln.code)))) keys.add('d:' + norm(ln.desc));
    }));
    if (!keys.size) return;
    if (!confirm(`Mark ${keys.size} different descriptions as “not a group company”?\n\nThey stay in the interest journal list (unticked), but are left out of the reconciliation. You can undo any of them under “Ignored”.`)) return;
    snap('Ignore ' + keys.size + ' descriptions'); keys.forEach(k => { state.overrides[k] = 'ignore'; memTB(k.slice(2), 'ignore'); }); audit(`Marked ${keys.size} descriptions as not group companies`); dirty(); render(); toast(`${keys.size} descriptions ignored`);
  }
  else if (a === 'jselect'){
    const rows = journalData(ui.jco), jr = jrOf(state.companies[ui.jco]); jr.sel = {};
    rows.forEach(r => { if (d.v === 'all') jr.sel[r.ln.code] = true; else if (d.v === 'none') jr.sel[r.ln.code] = false; });
    dirty(); jRefresh();
  }
  else if (a === 'dlcsv'){ const { out } = csvFor(ui.jco); if (!out) return; saveOut(`Interest journal - ${coName(ui.jco)}`, out); toast(out.xlsx ? 'Excel file downloaded' : 'CSV downloaded'); }
  else if (a === 'copycsv'){ const { csv } = csvFor(ui.jco); (navigator.clipboard ? navigator.clipboard.writeText(csv) : Promise.reject()).then(() => toast('CSV copied to clipboard'), () => toast('Could not access the clipboard – use Download instead')); }
  else if (a === 'printj') exportReport('pdf');
  else if (a === 'dlzip'){
    const files = [];
    state.companies.forEach((c, i) => { const { out } = csvFor(i); if (out) files.push(outZipItem(outFile(`Interest journal - ${c.name}`, out), out)); });
    if (!files.length){ toast('No company has any interest lines selected.'); return; }
    download('Interest journals.zip', makeZip(files), 'application/zip'); toast(`${files.length} journal files zipped`);
  }
  else if (a === 'allaccts'){
    const c0 = state.companies[ui.jco], j0 = jrOf(c0), def = defaultAccounts((journalData(ui.jco).find(r => r.t >= 0) || { ln: { code: '0' } }).ln.code);
    const v = { recv: j0.recv || def.recv, paid: j0.paid || def.paid, contra: j0.contra || def.contra };
    state.companies.forEach(c => Object.assign(jrOf(c), v)); dirty(); render(); toast('Interest accounts applied to all companies');
  }
  else if (a === 'savesession') exportSession();
  else if (a === 'loadsession') $('#fileSession').click();
  else if (a === 'reset'){ if (confirm('Remove all companies, matches and settings from this browser?')){ state = freshState(); ui.sel = 0; ui.jco = 0; ui.tab = 'home'; ui.lraw = {}; dirty(); render(); } }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'fileXlsx'){ handleFiles(t.files); t.value = ''; return; }
  if (t.id === 'fileSession'){ if (t.files[0]) importSession(t.files[0]); t.value = ''; return; }
  const a = t.dataset.change, b = t.dataset.bind;
  if (b) return;
  if (!a) return;
  const S = state.settings;
  if (a === 'assign'){ applyAssign(+t.dataset.i, +t.dataset.k, t.value); render(); if (ui.pair) $('#dlg').innerHTML = pairDialogHTML(); }
  else if (a === 'coname'){ const v = t.value.trim(); if (v){ state.companies[ui.sel].name = v; dirty(); render(); } }
  else if (a === 'coalias'){ state.companies[ui.sel].aliases = t.value.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean); dirty(); render(); toast('Names updated – matches recalculated'); }
  else if (a === 'cocur'){ state.companies[ui.sel].cur = t.value.trim().toUpperCase(); dirty(); render(); }
  else if (a === 'corate'){ const v = parseFloat(t.value); const c = state.companies[ui.sel]; if (v > 0 && v !== 1) c.rate = v; else delete c.rate; audit(`Rate for ${c.name} set to ${c.rate || 1}`); dirty(); render(); toast('Rate applied – balances recalculated'); }
  else if (a === 'pname'){ state.project.name = t.value.trim(); dirty(); }
  else if (a === 'cointerest'){ const c = state.companies[ui.tab === 'jnl' ? ui.jco : ui.sel]; c.interest = t.checked; dirty(); render(); }
  else if (a === 'rcompany'){ ui.recon.company = t.value; render(); }
  else if (a === 'colq'){ ui.colq = t.value; render(); const el = $('#colq'); if (el){ el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }
  else if (a === 'rq'){ ui.recon.q = t.value; render(); }
  else if (a === 'compact'){ S.compact = t.checked; dirty(); render(); }
  else if (a === 'tolerance'){ S.tolerance = Math.max(0, parseFloat(t.value) || 0); dirty(); render(); }
  else if (a === 'threshold'){ S.threshold = parseFloat(t.value); dirty(); render(); }
  else if (a === 'revq'){ ui.review.q = t.value; render(); }
  else if (a === 'revall'){ ui.review.all = t.checked; render(); }
  else if (a === 'jco'){ ui.jco = +t.value; render(); }
  else if (a === 'jsel'){ const jr = jrOf(state.companies[ui.jco]); jr.sel = jr.sel || {}; jr.sel[t.dataset.code] = t.checked; dirty(); jRefresh(); }
  else if (a === 'jrate'){ const jr = jrOf(state.companies[ui.jco]); jr.rates = jr.rates || {}; if (t.value === '') delete jr.rates[t.dataset.code]; else jr.rates[t.dataset.code] = parseFloat(t.value); dirty(); jRefresh(); }
  else if (a === 'jshowall'){ ui.jShowAll = t.checked; jRefresh(); }
});
document.addEventListener('input', e => {
  const t = e.target, b = t.dataset.bind; if (!b) return;
  const [scope, key] = b.split(':');
  let v = t.type === 'checkbox' ? t.checked : t.type === 'number' ? (t.value === '' ? '' : parseFloat(t.value)) : t.value;
  if (scope === 's'){ state.settings[key] = v === '' ? DEF_SETTINGS[key] : v; }
  else { const jr = jrOf(state.companies[ui.jco]); if (v === '' || v == null) delete jr[key]; else jr[key] = v; }
  dirty(); jRefresh();
});
document.addEventListener('change', e => { if (e.target.dataset && e.target.dataset.bind){ const k = e.target.dataset.bind; if (k === 's:format' || k === 's:rate2') render(); } });
$('#dlg').addEventListener('click', e => { if (e.target === $('#dlg')) closeDialog(); });
$('#dlg').addEventListener('close', () => { ui.pair = null; });
document.addEventListener('paste', e => {
  const t = e.target; if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
  const text = (e.clipboardData || window.clipboardData).getData('text');
  if (text && text.length > 40 && /\d/.test(text)){ e.preventDefault(); openPaste(text); }
});
['dragenter', 'dragover'].forEach(ev => window.addEventListener(ev, e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')){ e.preventDefault(); document.body.classList.add('dropping'); } }));
['dragleave', 'drop'].forEach(ev => window.addEventListener(ev, e => { if (ev === 'drop' || e.target === document.documentElement || !e.relatedTarget) document.body.classList.remove('dropping'); }));
window.addEventListener('drop', e => { e.preventDefault(); document.body.classList.remove('dropping'); if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); });
// </UI>
