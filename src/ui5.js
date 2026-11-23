
/* =====================================================================
   Export mapper – design the journal file for any accounting package
   ===================================================================== */
const MAPS_KEY = 'matchmaker.maps.v1';
let MAPS = (() => { try { const a = JSON.parse(localStorage.getItem(MAPS_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } })();
function mapsSave(){ try { localStorage.setItem(MAPS_KEY, JSON.stringify(MAPS)); } catch (e) {} }
function mapsMerge(list){ let n = 0; (list || []).forEach(m => { if (m && m.id && !MAPS.some(x => x.id === m.id)){ MAPS.push(m); n++; } }); if (n) mapsSave(); return n; }
const mapById = id => MAPS.find(m => m.id === id);
const mapFull = m => Object.assign(mapDefaults(), m, { cols: (m.cols || []).map(c => ({ ...c })) });
const isMapFmt = f => typeof f === 'string' && f.startsWith('map:');
function mapOptsHTML(cur){
  if (!MAPS.length) return '';
  return `<optgroup label="My export mappings">${MAPS.map(m => `<option value="map:${esc(m.id)}" ${cur === 'map:' + m.id ? 'selected' : ''}>${esc(m.name || 'Untitled')} (${m.kind === 'xlsx' ? 'Excel' : 'CSV'})</option>`).join('')}</optgroup>`;
}

/* build the output for one journal – built-in layouts or a saved mapping */
function jOut(entries, o){
  if (isMapFmt(o.format)){
    const m = mapFull(mapById(o.format.slice(4)) || MAP_PRESETS.pastel);
    const ctx = { date: o.date, period: o.period, ref: o.ref, contra: o.contra, company: o.narr, batch: o.batch || 1 };
    const r = mapJournal(entries, ctx, m);
    r.fname = mapFileName(m, ctx); r.mapName = m.name;
    return r;
  }
  return { text: buildJournalCSV(entries, o), xlsx: false, ext: 'csv', bom: true };
}
function outData(out){
  if (out.xlsx) return makeXlsx([out.sheet]);
  return out.bom === false ? new Blob([out.text], { type: 'text/csv;charset=utf-8' }) : out.text;
}
function outZipItem(name, out){ return { name, content: out.xlsx ? makeXlsx([out.sheet], true) : (out.bom === false ? '' : '﻿') + out.text }; }
const outFile = (base, out) => `${safeName(out.fname || base)}.${out.ext}`;
function saveOut(base, out){ download(outFile(base, out), outData(out)); }

/* ---------- the mapper dialog ---------- */
function mapSample(){
  try {
    if (state.mode === 'tb' && state.companies.length){
      for (let k = 0; k < state.companies.length; k++){ const i = (ui.jco + k) % state.companies.length; const { J } = csvFor(i); if (J.entries.length) return { entries: J.entries, ctx: { date: J.date, period: J.period, ref: J.ref, contra: J.acc.contra, company: state.companies[i].name, batch: i + 1 }, real: true }; }
    }
  } catch (e) {}
  return { entries: [{ account: '0551/002', desc: 'Interest on Affiliated Entities', amount: 1234.5, tname: 'Sample Trading CC' }, { account: '0551/009', desc: 'Interest on Affiliated Entities', amount: -820.4, tname: 'Example Holdings CC' }, { account: '0130/000', desc: 'Interest received', amount: -414.1, tname: 'Interest received' }],
    ctx: { date: new Date().toISOString().slice(0, 10), period: 12, ref: 'JNL26/01', contra: '0999/000', company: 'Sample Company', batch: 1 }, real: false };
}
function mapSrcSelect(i, cur){
  return `<select data-mpc="src" data-i="${i}">${MAP_SOURCES.map(([g, l]) => `<optgroup label="${g}">${l.map(([k, t]) => `<option value="${k}" ${cur === k ? 'selected' : ''}>${esc(t)}</option>`).join('')}</optgroup>`).join('')}</select>`;
}
function mapValCell(c, i){
  if (c.src === 'date') return `<select data-mpc="fmt" data-i="${i}"><option value="">Default (${esc(ui.mp.d.dateFmt)})</option>${Object.keys(MAP_DATES).map(k => `<option ${c.fmt === k ? 'selected' : ''}>${k}</option>`).join('')}</select>`;
  if (c.src === 'text') return `<input type="text" value="${esc(c.val || '')}" placeholder="e.g. G" data-mpc="val" data-i="${i}">`;
  if (c.src === 'drcr') return `<input type="text" value="${esc(c.val || 'D|C')}" placeholder="D|C" data-mpc="val" data-i="${i}" title="Text for debit, then | , then text for credit">`;
  if (c.src === 'tpl') return `<input type="text" value="${esc(c.val || '')}" placeholder="{ref} - {desc}" data-mpc="val" data-i="${i}" title="Use {date} {ref} {desc} {account} {acct1} {acct2} {company} {other} {period} {line} {debit} {credit} {amount}">`;
  return '<span class="muted small">–</span>';
}
function mapDialogHTML(){
  const m = ui.mp.d, opt = (v, t, c) => `<option value="${v}" ${c === v ? 'selected' : ''}>${t}</option>`;
  const prof = MAPS.map(x => `<option value="${esc(x.id)}" ${x.id === m.id ? 'selected' : ''}>${esc(x.name || 'Untitled')}</option>`).join('');
  const cols = m.cols.map((c, i) => `<tr><td class="small muted">${i + 1}</td><td><input type="text" value="${esc(c.h || '')}" data-mpc="h" data-i="${i}" placeholder="Column heading"></td><td>${mapSrcSelect(i, c.src)}</td><td>${mapValCell(c, i)}</td>
    <td><input type="number" min="0" style="width:60px" value="${c.len || ''}" placeholder="–" data-mpc="len" data-i="${i}" title="Maximum length (blank = no limit)"></td>
    <td><select data-mpc="case" data-i="${i}">${opt('', 'as is', c.case || '')}${opt('upper', 'UPPER', c.case || '')}${opt('lower', 'lower', c.case || '')}</select></td>
    <td class="nowrap"><button class="btn sm" data-act="mpup" data-i="${i}" title="Move left">▲</button> <button class="btn sm" data-act="mpdn" data-i="${i}" title="Move right">▼</button> <button class="btn sm" data-act="mprm" data-i="${i}" title="Remove column">✕</button></td></tr>`).join('');
  return `<div class="dh"><h3>Export mapper – design the file your accounting software expects</h3><button class="btn sm" data-act="closedlg">Close</button></div>
  <div class="db">
    <div class="row" style="margin-bottom:12px">
      <label class="small">Mapping <select data-act-change="mpsel" data-change="mpsel" style="width:auto;display:inline-block;padding:4px 8px;min-width:200px">${MAPS.some(x => x.id === m.id) ? '' : '<option value="">(not saved yet)</option>'}${prof}</select></label>
      <label class="small">Start from <select id="mpPreset" style="width:auto;display:inline-block;padding:4px 8px">${Object.entries(MAP_PRESETS).map(([k, p]) => `<option value="${k}">${esc(p.name)}</option>`).join('')}</select></label><button class="btn sm" data-act="mpnew">Load template</button>
      <span class="grow" style="flex:1"></span><button class="btn sm" data-act="mpexp" title="Save this mapping to a file to share">Export mapping</button><button class="btn sm" data-act="mpimp">Import mapping</button></div>
    <div class="grid3"><div class="field"><label>Mapping name</label><input type="text" value="${esc(m.name)}" data-mp="name" placeholder="e.g. Sage – journal import"></div>
      <div class="field"><label>File type</label><select data-mp="kind">${opt('csv', 'CSV / text file', m.kind)}${opt('xlsx', 'Excel workbook (.xlsx)', m.kind)}</select></div>
      <div class="field"><label>File name</label><input type="text" value="${esc(m.fileName)}" data-mp="fileName"><span class="small muted">{company} {ref} {date} {yyyy} {mm}</span></div></div>
    <div class="grid3">
      ${m.kind === 'csv' ? `<div class="field"><label>Separator</label><select data-mp="delimiter">${opt('comma', 'Comma ( , )', m.delimiter)}${opt('semi', 'Semicolon ( ; )', m.delimiter)}${opt('tab', 'Tab', m.delimiter)}${opt('pipe', 'Pipe ( | )', m.delimiter)}</select></div>
      <div class="field"><label>Quote text with</label><select data-mp="quoting">${opt('auto', 'Quotes only when needed', m.quoting)}${opt('always', 'Quotes on every text cell', m.quoting)}${opt('none', 'Never quote', m.quoting)}</select></div>
      <div class="field"><label>Line endings / encoding</label><select data-mp="enc">${opt('crlf1', 'Windows (CRLF), UTF-8 with BOM', (m.eol === 'lf' ? 'lf' : 'crlf') + (m.bom === false ? '0' : '1'))}${opt('crlf0', 'Windows (CRLF), UTF-8 no BOM', (m.eol === 'lf' ? 'lf' : 'crlf') + (m.bom === false ? '0' : '1'))}${opt('lf1', 'Unix (LF), UTF-8 with BOM', (m.eol === 'lf' ? 'lf' : 'crlf') + (m.bom === false ? '0' : '1'))}${opt('lf0', 'Unix (LF), UTF-8 no BOM', (m.eol === 'lf' ? 'lf' : 'crlf') + (m.bom === false ? '0' : '1'))}</select></div>` : `<div class="field"><label>Numbers</label><select data-mp="xlNumbers">${opt('true', 'Real Excel numbers', String(m.xlNumbers !== false))}${opt('false', 'Text (formatted as below)', String(m.xlNumbers !== false))}</select></div>`}
    </div>
    <div class="grid3"><div class="field"><label>Default date format</label><select data-mp="dateFmt">${Object.keys(MAP_DATES).map(k => opt(k, k, m.dateFmt)).join('')}</select></div>
      <div class="field"><label>Decimals / decimal mark</label><div class="row" style="gap:6px"><select data-mp="decimals" style="width:auto">${[0, 1, 2, 3, 4].map(n => opt(String(n), String(n), String(m.decimals))).join('')}</select><select data-mp="decSep" style="width:auto">${opt('.', 'point ( . )', m.decSep)}${opt(',', 'comma ( , )', m.decSep)}</select></div></div>
      <div class="field"><label>Thousands / negatives</label><div class="row" style="gap:6px"><select data-mp="thousand" style="width:auto">${opt('', 'none', m.thousand)}${opt(',', 'comma', m.thousand)}${opt(' ', 'space', m.thousand)}${opt('.', 'point', m.thousand)}</select><select data-mp="neg" style="width:auto">${opt('minus', '-1.00', m.neg)}${opt('brackets', '(1.00)', m.neg)}${opt('trail', '1.00-', m.neg)}</select></div></div></div>
    <div class="row" style="gap:18px;margin:4px 0 12px"><label class="chk"><input type="checkbox" data-mp="header" ${m.header !== false ? 'checked' : ''}> Heading row</label>
      <label class="chk"><input type="checkbox" data-mp="skipZero" ${m.skipZero !== false ? 'checked' : ''}> Leave out zero lines</label>
      <label class="chk"><input type="checkbox" data-mp="summarise" ${m.summarise ? 'checked' : ''}> Add up lines per account</label>
      <label class="small">Include <select data-mp="only" style="width:auto;display:inline-block;padding:3px 6px">${opt('all', 'all lines', m.only)}${opt('debit', 'debit lines only', m.only)}${opt('credit', 'credit lines only', m.only)}</select></label></div>
    <div class="card scroll" style="margin-bottom:10px"><table class="t"><thead><tr><th>#</th><th>Column heading in the file</th><th>Takes its data from</th><th>Format / text</th><th>Max length</th><th>Case</th><th></th></tr></thead><tbody>${cols || '<tr><td colspan="7" class="empty">No columns yet.</td></tr>'}</tbody></table></div>
    <div class="row" style="margin-bottom:12px"><button class="btn sm" data-act="mpadd">＋ Add column</button><span class="small muted">Fixed text, combined fields (e.g. “{ref} – {desc}”) and an account split into main + sub are available under “Takes its data from”.</span></div>
    <details style="margin-bottom:12px"><summary class="small muted" style="cursor:pointer">Extra lines before / after the data (file headers, control totals)</summary>
      <div class="grid2" style="margin-top:8px"><div class="field"><label>Lines before the heading row</label><textarea data-mp="pre" rows="3" class="paste" style="min-height:70px">${esc(m.pre)}</textarea></div><div class="field"><label>Lines after the data</label><textarea data-mp="post" rows="3" class="paste" style="min-height:70px">${esc(m.post)}</textarea></div></div>
      <span class="small muted">Tokens: {count} {debits} {credits} {net} {date} {ref} {company} {period}. Separate cells with your separator.</span></details>
    <h3 style="font-size:14px;margin:6px 0">Preview <span class="small muted" id="mpWhich"></span></h3><div id="mpPrev"></div>
  </div>
  <div class="df"><span class="small muted" style="margin-right:auto">Saved mappings stay in this browser and travel with your project file.</span>
    <button class="btn" data-act="mpdel" ${MAPS.some(x => x.id === m.id) ? '' : 'disabled'}>Delete</button><button class="btn" data-act="mpdl" title="Download the preview as a real file">⬇ Test file</button><button class="btn" data-act="mpsave">Save</button><button class="btn primary" data-act="mpuse">Save &amp; use for my journals</button></div>`;
}
function mapPreview(){
  const el = $('#mpPrev'); if (!el) return;
  const m = mapFull(ui.mp.d), sm = mapSample(); let out;
  try { out = mapJournal(sm.entries, sm.ctx, m); } catch (e){ el.innerHTML = `<div class="note bad">${esc(e.message)}</div>`; return; }
  $('#mpWhich').textContent = sm.real ? '(using the journal you currently have open)' : '(sample data – load trial balances to preview your own)';
  const rows = out.rows.slice(0, 14), w = Math.max(...rows.map(r => r.length), 1);
  const warn = [];
  if (!m.cols.length) warn.push('Add at least one column.');
  if (m.header !== false && m.cols.some(c => !String(c.h || '').trim())) warn.push('Some columns have no heading.');
  if (Math.abs(out.debits - out.credits) > 0.005) warn.push(`Debits (${fmt(out.debits)}) and credits (${fmt(out.credits)}) differ in this selection.`);
  el.innerHTML = (warn.length ? `<div class="note warn" style="margin-bottom:8px">${warn.map(esc).join('<br>')}</div>` : '')
    + `<div class="card scroll" style="max-height:230px;margin-bottom:8px"><table class="t mapt"><tbody>${rows.map((r, n) => `<tr class="${n === 0 && out.hasHdr ? 'hd' : ''}">${Array.from({ length: w }, (_, c) => `<td class="${typeof r[c] === 'number' ? 'num' : ''}">${esc(r[c] === undefined ? '' : r[c])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
    + (m.kind === 'csv' ? `<details><summary class="small muted" style="cursor:pointer">Raw file text</summary><pre class="csv">${esc(out.text)}</pre></details>` : `<div class="small muted">Excel file with ${out.rows.length} rows – numbers are stored as numbers, dates as text.</div>`);
}
function openMapper(id){
  const base = id && mapById(id) ? mapFull(mapById(id)) : (isMapFmt(state.settings.format) && mapById(state.settings.format.slice(4)) ? mapFull(mapById(state.settings.format.slice(4))) : mapFull({ ...MAP_PRESETS.generic, name: '' }));
  ui.mp = { d: base };
  openDialog(mapDialogHTML()); $('#dlg').classList.add('wide'); mapPreview();
}
function mapRedraw(){ const y = $('#dlg .db') ? $('#dlg .db').scrollTop : 0; $('#dlg').innerHTML = mapDialogHTML(); mapPreview(); if ($('#dlg .db')) $('#dlg .db').scrollTop = y; }
function mapPersist(){
  const d = ui.mp.d; if (!String(d.name || '').trim()){ toast('Give the mapping a name first.'); return false; }
  if (!d.id) d.id = 'm' + Date.now().toString(36);
  const copy = JSON.parse(JSON.stringify(d)); const i = MAPS.findIndex(x => x.id === d.id);
  if (i >= 0) MAPS[i] = copy; else MAPS.push(copy);
  mapsSave(); audit(`Export mapping “${d.name}” saved`); return true;
}
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]'); if (!t || !ui.mp) return;
  const a = t.dataset.act, d = ui.mp.d, i = +t.dataset.i;
  if (a === 'mpnew'){ const k = $('#mpPreset').value, p = MAP_PRESETS[k]; ui.mp.d = mapFull({ ...p, id: '', name: p.name + ' (copy)' }); mapRedraw(); }
  else if (a === 'mpadd'){ d.cols.push({ h: '', src: 'text', val: '' }); mapRedraw(); }
  else if (a === 'mprm'){ d.cols.splice(i, 1); mapRedraw(); }
  else if (a === 'mpup' && i > 0){ [d.cols[i - 1], d.cols[i]] = [d.cols[i], d.cols[i - 1]]; mapRedraw(); }
  else if (a === 'mpdn' && i < d.cols.length - 1){ [d.cols[i + 1], d.cols[i]] = [d.cols[i], d.cols[i + 1]]; mapRedraw(); }
  else if (a === 'mpsave'){ if (mapPersist()){ mapRedraw(); toast('Mapping saved'); } }
  else if (a === 'mpuse'){ if (mapPersist()){ state.settings.format = 'map:' + d.id; dirty(); closeDialog(); render(); toast(`Journals now export using “${d.name}”`); } }
  else if (a === 'mpdel'){ if (confirm(`Delete the mapping “${d.name}”?`)){ MAPS = MAPS.filter(x => x.id !== d.id); mapsSave(); if (state.settings.format === 'map:' + d.id) state.settings.format = 'pastel'; audit(`Export mapping “${d.name}” deleted`); dirty(); ui.mp.d = mapFull({ ...MAP_PRESETS.generic, name: '' }); mapRedraw(); render(); } }
  else if (a === 'mpdl'){ const sm = mapSample(), o = mapJournal(sm.entries, sm.ctx, mapFull(d)); saveOut('Matchmaker test export', { ...o, fname: mapFileName(mapFull(d), sm.ctx) }); }
  else if (a === 'mpexp'){ if (!String(d.name || '').trim()){ toast('Give the mapping a name first.'); return; } download(`Matchmaker mapping - ${safeName(d.name)}.json`, new Blob([JSON.stringify({ matchmakerMapping: 1, mapping: { ...d, id: '' } }, null, 1)], { type: 'application/json' })); }
  else if (a === 'mpimp'){ $('#fileMap').click(); }
});
document.addEventListener('click', e => { const t = e.target.closest('[data-act="mapopen"]'); if (t){ e.stopPropagation(); openMapper(); } });
const _mpNum = new Set(['decimals']);
document.addEventListener('input', e => {
  const t = e.target; if (!ui.mp) return;
  if (t.dataset.mp && (t.type === 'text' || t.tagName === 'TEXTAREA' || t.type === 'number')){ ui.mp.d[t.dataset.mp] = t.value; mapPreview(); }
  else if (t.dataset.mpc && (t.type === 'text' || t.type === 'number')){ const c = ui.mp.d.cols[+t.dataset.i]; c[t.dataset.mpc] = t.dataset.mpc === 'len' ? (parseInt(t.value) || 0) : t.value; mapPreview(); }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'fileMap'){
    const f = t.files[0]; t.value = ''; if (!f) return;
    f.text().then(x => { const j = JSON.parse(x); if (!j.mapping) throw new Error('x'); ui.mp.d = mapFull({ ...j.mapping, id: '' }); mapRedraw(); toast('Mapping imported – review it, then Save'); }).catch(() => toast('That file is not a Matchmaker mapping.'));
    return;
  }
  if (!ui.mp) return;
  if (t.dataset.change === 'mpsel'){ const m = mapById(t.value); if (m){ ui.mp.d = mapFull(m); mapRedraw(); } return; }
  if (t.dataset.mp){
    const k = t.dataset.mp, d = ui.mp.d;
    if (k === 'enc'){ d.eol = t.value.startsWith('lf') ? 'lf' : 'crlf'; d.bom = t.value.endsWith('1'); }
    else if (k === 'header' || k === 'skipZero' || k === 'summarise') d[k] = t.checked;
    else if (k === 'decimals') d[k] = parseInt(t.value);
    else if (k === 'xlNumbers') d[k] = t.value === 'true';
    else if (t.type !== 'text' && t.tagName !== 'TEXTAREA') d[k] = t.value;
    else return;
    if (k === 'kind') mapRedraw(); else mapPreview();
  } else if (t.dataset.mpc && t.tagName === 'SELECT'){
    const c = ui.mp.d.cols[+t.dataset.i]; c[t.dataset.mpc] = t.value;
    if (t.dataset.mpc === 'src'){ if (!c.h || MAP_SOURCES.flatMap(g => g[1]).some(([k, n]) => n === c.h)) { const nm = MAP_SOURCES.flatMap(g => g[1]).find(([k]) => k === t.value); if (nm && !c.h) c.h = nm[1].split(' (')[0]; } mapRedraw(); } else mapPreview();
  }
});

/* ---------- sample data + about ---------- */
const APP_VERSION = '1.4.0';
const SAMPLE_TB = [
`Alpha Trading (Pty) Ltd
Trial Balance : 01/03/2024 to 28/02/2025
Account\tDescription\tDR\tCR
0100/000\tBank\t250000.00\t
0551/001\t- Beta Holdings CC\t500000.00\t
0551/002\t- Gamma Services t/a Gamma Fuel\t120000.00\t
0551/003\t- Delta Farms\t35000.00\t
1000/000\tSales\t\t1850000.00
2000/000\tCost of sales\t945000.00\t
3000/000\tShare capital\t\t100.00
3100/000\tRetained income\t\t0.00
4000/000\tTrade creditors\t\t0.00`,
`Beta Holdings CC
Trial Balance : 01/03/2024 to 28/02/2025
Account\tDescription\tDR\tCR
0100/000\tBank\t90000.00\t
0551/001\t- Alpha Trading Pty Ltd\t\t500000.00
0551/002\t- Gamma Services\t40000.00\t
1000/000\tRental income\t\t620000.00
2000/000\tOperating expenses\t310000.00\t
3000/000\tShare capital\t\t100.00`,
`Gamma Services t/a Gamma Fuel
Trial Balance : 01/03/2024 to 28/02/2025
Account\tDescription\tDR\tCR
0100/000\tBank\t75000.00\t
0551/001\t- Alpha Trading (Pty) Ltd\t\t118500.00
0551/002\t- Beta Holdngs\t\t40000.00
1000/000\tSales\t\t780000.00
2000/000\tCost of sales\t420000.00\t
3000/000\tShare capital\t\t100.00`
];
const SAMPLE_L = {
  A: `Date\tReference\tDescription\tDebit\tCredit
01/09/2025\tINV1001\tInvoice 1001\t11500.00\t
04/09/2025\tINV1002\tInvoice 1002\t8200.50\t
12/09/2025\tINV1003\tInvoice 1003\t4300.00\t
15/09/2025\tPAY771\tPayment inv 1001, 1002\t\t19700.50
22/09/2025\tINV1004\tInvoice 1004\t2750.00\t
30/09/2025\tINV1005\tInvoice 1005\t990.00\t
30/09/2025\tCLOSE\tClosing balance\t\t`,
  B: `Date\tReference\tDescription\tDebit\tCredit
02/09/2025\t1001\tPurchase inv 1001\t\t11500.00
05/09/2025\t1002\tPurchase inv 1002\t\t8200.50
13/09/2025\t1003\tPurchase inv 1003\t\t4300.00
16/09/2025\tEFT88\tEFT inv 1001\t11500.00\t
16/09/2025\tEFT89\tEFT inv 1002\t8200.50\t
23/09/2025\t1004\tPurchase inv 1004\t\t2570.00
01/10/2025\t1006\tPurchase inv 1006\t\t640.00`
};
function loadSample(kind){
  if (kind === 'tb'){
    if (state.companies.length && !confirm('Add the three sample companies to what you already have loaded?')) return;
    SAMPLE_TB.forEach(t => { const p = parseTBText(t); if (p && p.lines) upsertCompany(p); });
    state.project.name = state.project.name || 'Sample group'; state.mode = 'tb'; ui.tab = 'recon'; audit('Sample trial balances loaded');
  } else {
    if ((state.ledger.A.items.length || state.ledger.B.items.length) && !confirm('Replace the ledgers you have loaded with the sample statement and ledger?')) return;
    state.mode = 'ledger'; applyPreset('statement'); state.ledger.A.label = 'Supplier statement'; state.ledger.B.label = 'Our creditors ledger';
    ledgerFromGrid('A', splitDelimited(SAMPLE_L.A)); ledgerFromGrid('B', splitDelimited(SAMPLE_L.B)); ui.lraw = {}; ui.tab = 'lres'; ui.lsub = 'sum'; audit('Sample ledgers loaded');
  }
  dirty(); render(); window.scrollTo(0, 0);
}
function aboutHTML(){
  const keys = [['Ctrl + Z', 'Undo the last match / assignment'], ['↑ ↓ (or J / K)', 'Move through lines on the Review tab'], ['Enter (or A)', 'Accept the suggested company for the highlighted line'], ['I', 'Mark the highlighted line as not a group company']];
  return `<div class="dh"><h3>About Matchmaker</h3><button class="btn sm" data-act="closedlg">Close</button></div><div class="db">
    <div class="herologo" style="margin-bottom:10px">${LOGO}<div><h1 style="font-size:22px">Matchmaker <span class="small muted">v${APP_VERSION}</span></h1><span>Match intercompany loans, ledgers and statements.</span></div></div>
    <p class="small">Everything runs on your own computer. Nothing is uploaded; your work is kept in this app’s storage and in the project files you save.</p>
    <h3 style="font-size:14px;margin:12px 0 6px">Keyboard shortcuts</h3><table class="t"><tbody>${keys.map(([k, t]) => `<tr><td class="mono nowrap">${k}</td><td>${t}</td></tr>`).join('')}</tbody></table>
    <h3 style="font-size:14px;margin:12px 0 6px">Good to know</h3><ul class="small" style="margin:0;padding-left:18px;line-height:1.6"><li>Always import the <b>1-cent test file</b> into your accounting package before a real batch.</li><li>Save a <b>project file</b> at month end – it holds every decision, the audit trail and your export mappings.</li><li>PDF statements must contain real text; scanned images need OCR first.</li></ul></div>`;
}
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]'); if (!t) return;
  if (t.dataset.act === 'sample'){ e.stopPropagation(); loadSample(t.dataset.kind); }
  else if (t.dataset.act === 'about'){ e.stopPropagation(); openDialog(aboutHTML()); }
});
window.addEventListener('beforeunload', e => { if (ui.saveFail){ e.preventDefault(); e.returnValue = ''; } });
