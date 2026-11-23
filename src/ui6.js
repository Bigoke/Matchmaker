/* =====================================================================
   Offline OCR (scanned PDFs and photos) + learning from corrections
   OCR files are served by the Windows app from /ocr/ – nothing leaves the PC.
   ===================================================================== */
const OCR_OK = () => location.protocol === 'http:' && location.hostname === '127.0.0.1';
const IMG_RE = /\.(png|jpe?g|bmp|webp|tiff?)$/i;
const loadScript = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src)); document.head.appendChild(s); });
let ocrWorker = null, ocrProg = null;

/* ---------- learning store (inside MEM, so it is saved, undone and exported with the rest) ---------- */
function ocrMem(){ MEM.ocr = MEM.ocr || { cell: {}, chr: {} }; MEM.ocr.cell = MEM.ocr.cell || {}; MEM.ocr.chr = MEM.ocr.chr || {}; return MEM.ocr; }
function layMem(){ MEM.lay = MEM.lay || {}; return MEM.lay; }
const laySig = (grid, hdr) => hdr >= 0 && grid[hdr] ? norm(grid[hdr].join('|')) : '';
function layApply(raw){
  const sig = laySig(raw.grid, raw.hdr), m = sig && layMem()[sig];
  if (!m) return false;
  const width = Math.max(...raw.grid.slice(0, 20).map(r => r.length));
  if (Object.values(m).some(c => c >= width)) return false;
  raw.map = Object.assign({}, m); raw.learned = true; return true;
}
function layLearn(raw){
  const sig = laySig(raw.grid, raw.hdr); if (!sig) return;
  layMem()[sig] = Object.assign({}, raw.map); memSave();
}

/* ---------- cleaning OCR text, using the built-in rules and what has been learned ---------- */
const NUMISH = /^[-(+]?[\dOolIiSsBbZz|., ]*\d[\dOolIiSsBbZz|., ]*[.,][\dOolIiSsBbZz|]{2}\)?(\s?(CR|DR|Cr|Dr))?$/;
function ocrClean(text){
  const M = ocrMem(); let t = text.trim();
  if (M.cell[t] != null) return M.cell[t];
  if (NUMISH.test(t)){
    const fix = { O: '0', o: '0', l: '1', I: '1', i: '1', '|': '1', S: '5', s: '5', B: '8', b: '6', Z: '2', z: '2' };
    let out = '';
    for (const ch of t){
      let c = fix[ch] || ch;
      for (const k in M.chr){ const [f, to] = k.split('>'); if (f === ch && M.chr[k] >= 2) c = to; }
      out += c;
    }
    t = out;
  }
  return t;
}
/* learn from what the user changed on the review screen */
function ocrLearn(orig, edited){
  const M = ocrMem(); let n = 0;
  edited.forEach((row, r) => row.forEach((v, c) => {
    const o = orig[r] && orig[r][c]; if (o == null || o === v || !o.trim()) return;
    M.cell[o.trim()] = v; n++;
    if (o.length === v.length){ const d = []; for (let i = 0; i < o.length; i++) if (o[i] !== v[i]) d.push([o[i], v[i]]); if (d.length && d.length <= 2) d.forEach(([f, t]) => { if (/\d/.test(t) || /\d/.test(f)){ const k = f + '>' + t; M.chr[k] = (M.chr[k] || 0) + 1; } }); }
  }));
  const ks = Object.keys(M.cell); if (ks.length > 4000) ks.slice(0, ks.length - 4000).forEach(k => delete M.cell[k]);
  if (n){ memSave(); audit(`OCR: learned ${n} correction${n === 1 ? '' : 's'}`); }
  return n;
}

/* ---------- running the OCR ---------- */
async function ocrGetWorker(){
  if (!window.Tesseract) await loadScript('/ocr/tesseract.min.js');
  if (!ocrWorker){
    ocrWorker = await Tesseract.createWorker('eng', 1, { workerPath: '/ocr/worker.min.js', corePath: '/ocr/', langPath: '/ocr/lang', workerBlobURL: false, logger: m => { if (ocrProg) ocrProg(m); } });
    await ocrWorker.setParameters({ preserve_interword_spaces: '1', tessedit_pageseg_mode: '6' });
  }
  return ocrWorker;
}
async function ocrCanvases(file, each){
  if (/\.pdf$/i.test(file.name)){
    if (!window.pdfjsLib){ await loadScript('/ocr/pdf.min.js'); pdfjsLib.GlobalWorkerOptions.workerSrc = '/ocr/pdf.worker.min.js'; }
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise, n = Math.min(doc.numPages, 80);
    for (let p = 1; p <= n; p++){
      const page = await doc.getPage(p), vp = page.getViewport({ scale: 2.5 }), cv = document.createElement('canvas');
      cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
      await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
      await each(cv, p, n);
    }
  } else {
    const bmp = await createImageBitmap(file), k = bmp.width < 1800 ? 1800 / bmp.width : 1, cv = document.createElement('canvas');
    cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
    const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(bmp, 0, 0, cv.width, cv.height);
    await each(cv, 1, 1);
  }
}
async function ocrToGrid(file){
  if (!OCR_OK()) throw new Error('Reading scanned documents works in the Matchmaker Windows app (Matchmaker.exe).');
  const d = openDialog(`<div class="db" style="min-width:320px"><h3 style="margin-top:0">Reading the scan…</h3><div class="small muted" id="ocrMsg">Starting the text reader</div><div style="height:8px;border-radius:4px;background:var(--line);margin-top:12px;overflow:hidden"><div id="ocrBar" style="height:100%;width:2%;background:var(--accent);transition:width .2s"></div></div></div>`);
  const msg = t => { const e = $('#ocrMsg'); if (e) e.textContent = t; }, bar = f => { const e = $('#ocrBar'); if (e) e.style.width = Math.max(2, Math.min(100, f * 100)) + '%'; };
  const items = []; let pageOf = 0, total = 1;
  try {
    const w = await ocrGetWorker();
    await ocrCanvases(file, async (cv, p, n) => {
      pageOf = p; total = n; msg(`Page ${p} of ${n}`); bar((p - 1) / n);
      ocrProg = m => { if (m.status === 'recognizing text') bar((p - 1 + m.progress) / n); };
      const { data } = await w.recognize(cv), k = 595 / cv.width;
      (data.words || []).forEach(wd => { const b = wd.bbox; if (!wd.text || !wd.text.trim()) return; items.push({ page: p, x: b.x0 * k, x2: b.x1 * k, y: -((b.y0 + b.y1) / 2) * k, text: wd.text, fs: Math.max(4, (b.y1 - b.y0) * k), cf: wd.confidence }); });
    });
  } finally { ocrProg = null; closeDialog(); }
  if (!items.length) throw new Error('no text could be read from that scan');
  const L = pdfLayout(items);
  L.grid = L.grid.map(r => r.map(ocrClean));
  return { grid: L.grid, conf: L.conf, pages: total };
}

/* ---------- review screen: check / fix the text before it is used ---------- */
function ocrReview(file, res, done){
  ui.ocr = { grid: res.grid.map(r => r.slice()), orig: res.grid.map(r => r.slice()), conf: res.conf, file: file.name, done };
  const d = openDialog(ocrReviewHTML()); d.classList.add('wide');
}
function ocrReviewHTML(){
  const O = ui.ocr, w = Math.max(...O.grid.map(r => r.length));
  const rows = O.grid.map((r, i) => `<tr data-r="${i}"><td class="muted small">${i + 1}</td>${Array.from({ length: w }, (_, c) => { const cf = O.conf[i][c], bad = cf < 80 && (r[c] || '') !== ''; return `<td><input class="ocin ${bad ? 'lowc' : ''}" data-oc="${i},${c}" value="${esc(r[c] || '')}" title="${bad ? 'Low confidence: ' + Math.round(cf) + '%' : ''}"></td>`; }).join('')}<td><button class="btn sm" data-act="ocdel" data-r="${i}" title="Remove this row">✕</button></td></tr>`).join('');
  return `<div class="dh"><h3>Check the scanned text</h3><button class="btn sm" data-act="occancel">Cancel</button></div><div class="db">
    <p class="small" style="margin-top:0">Matchmaker read <b>${O.grid.length}</b> rows from <b>${esc(O.file)}</b>. Cells shaded <span class="chip warn">amber</span> were hard to read – please check them against the original, especially amounts. Anything you correct is <b>learned</b> and fixed automatically next time.</p>
    <div class="scroll" style="max-height:52vh"><table class="t ocrt"><tbody>${rows}</tbody></table></div>
    <div class="row" style="margin-top:12px"><button class="btn primary" data-act="ocuse">Use this text</button><span class="small muted">${ui.ocr.conf.flat().filter(c => c < 80).length} cells to check</span></div></div>`;
}

/* ---------- entry points used by the file loaders ---------- */
async function readScanned(file){
  if (!OCR_OK()){ toast('Scanned documents can be read in the Matchmaker Windows app (Matchmaker.exe).'); return null; }
  const res = await ocrToGrid(file);
  return new Promise(resolve => ocrReview(file, res, g => resolve(g)));
}

document.addEventListener('DOMContentLoaded', () => { const d = $('#dlg'); if (d) d.addEventListener('close', () => { if (ui.ocr && !d.open){ const O = ui.ocr; ui.ocr = null; O.done(null); } }); });
document.addEventListener('input', e => {
  const t = e.target; if (!t.dataset || !t.dataset.oc || !ui.ocr) return;
  const [r, c] = t.dataset.oc.split(',').map(Number); ui.ocr.grid[r][c] = t.value; t.classList.remove('lowc');
});
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]'); if (!t || !ui.ocr) return;
  const a = t.dataset.act;
  if (a === 'ocdel'){ e.stopPropagation(); const r = +t.dataset.r; ui.ocr.grid.splice(r, 1); ui.ocr.orig.splice(r, 1); ui.ocr.conf.splice(r, 1); const d = $('#dlg'); d.innerHTML = ocrReviewHTML(); }
  else if (a === 'ocuse'){ e.stopPropagation(); const O = ui.ocr; ocrLearn(O.orig, O.grid); ui.ocr = null; closeDialog(); O.done(O.grid); }
  else if (a === 'occancel'){ e.stopPropagation(); const O = ui.ocr; ui.ocr = null; closeDialog(); O.done(null); }
}, true);

/* =====================================================================
   Import a whole folder of trial balances (button or drag a folder in)
   ===================================================================== */
const TB_EXT = /\.(xlsx|xlsm|xltx|xltm|csv|txt|tsv|pdf)$/i;
function tbFlagsOf(sheets){
  const flags = {};
  for (const sh of sheets){
    const r = sh.rows.findIndex(row => row.some(c => typeof c === 'string' && /hef rente|charge interest/i.test(c)));
    if (r < 0) continue; const fr = sh.rows[r];
    for (let h = 0; h < Math.min(8, sh.rows.length); h++){
      const hr = sh.rows[h]; let ok = 0; const isNo = c => Number.isInteger(hr[c]) && hr[c] >= 1;
      fr.forEach((v, c) => { if (typeof v === 'string' && /^(geen|rente)$/i.test(v.trim()) && isNo(c)) ok++; });
      if (ok >= 3){ fr.forEach((v, c) => { if (typeof v === 'string' && /^(geen|rente)$/i.test(v.trim()) && isNo(c)) flags[String(hr[c])] = !/^geen$/i.test(v.trim()); }); break; }
    }
  }
  return flags;
}
async function readTBFile(file){
  const out = [];
  if (/\.(xlsx|xlsm|xltx|xltm)$/i.test(file.name)){
    const sheets = await readWorkbookSheets(await file.arrayBuffer()), flags = tbFlagsOf(sheets);
    for (const sh of sheets){ const p = parseTBGrid(sh.rows); if (p.error || !p.hasHeader || p.lines.length < 2) continue; out.push({ file: file.webkitRelativePath || file.name, sheet: sh.name, p, flag: flags[sh.name] }); }
  } else if (/\.pdf$/i.test(file.name)){
    const p = parseTBGrid(await pdfToGrid(await file.arrayBuffer())); if (!p.error && p.hasHeader && p.lines.length >= 2) out.push({ file: file.webkitRelativePath || file.name, sheet: '', p });
  } else {
    const p = parseTBText(await file.text()); if (!p.error && p.hasHeader && p.lines.length >= 2) out.push({ file: file.webkitRelativePath || file.name, sheet: '', p });
  }
  return out;
}
async function importFolder(files){
  const list = [...files].filter(f => TB_EXT.test(f.name) && !/^~\$/.test(f.name)).sort((a, b) => (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name));
  if (!list.length){ toast('No Excel, CSV, text or PDF files found in that folder.'); return; }
  if (state.mode !== 'tb'){ state.mode = 'tb'; ui.tab = 'tb'; }
  const d = openDialog(`<div class="db"><h3 style="margin-top:0">Reading ${list.length} file${list.length === 1 ? '' : 's'}…</h3><div class="small muted" id="fiMsg"></div></div>`);
  const found = [], skipped = [];
  for (let i = 0; i < list.length; i++){
    const e = $('#fiMsg'); if (e) e.textContent = `${i + 1} of ${list.length}: ${list[i].name}`;
    await new Promise(r => setTimeout(r, 0));
    try { const r = await readTBFile(list[i]); if (r.length) found.push(...r); else skipped.push([list[i].webkitRelativePath || list[i].name, 'no trial balance found (needs Account / DR / CR columns)']); }
    catch (err){ skipped.push([list[i].webkitRelativePath || list[i].name, err.message]); }
  }
  if (!found.length){ closeDialog(); render(); toast('No trial balances found in that folder.'); return; }
  const seen = new Set();
  const row = (f, n) => { const key = norm(f.p.name), dupInFolder = seen.has(key); seen.add(key); const ex = state.companies.some(c => norm(c.name) === key);
    return `<tr><td><input type="checkbox" class="fick" data-n="${n}" ${dupInFolder ? '' : 'checked'}></td><td class="small">${esc(short(f.file, 46))}${f.sheet ? ' · ' + esc(f.sheet) : ''}</td><td>${esc(f.p.name)}</td><td class="num">${f.p.lines.length}</td><td>${ex ? '<span class="chip warn">replaces loaded</span>' : ''}${dupInFolder ? '<span class="chip bad">duplicate – unticked</span>' : ''}</td></tr>`; };
  d.classList.add('wide');
  d.innerHTML = `<div class="dh"><h3>Import folder</h3><button class="btn sm" data-act="closedlg">Cancel</button></div><div class="db">
    <p class="small muted" style="margin-top:0">${found.length} trial balance${found.length === 1 ? '' : 's'} found in ${list.length} file${list.length === 1 ? '' : 's'}. Untick any you do not want.</p>
    <div class="toolbar"><button class="btn sm" id="fiAll">Select all</button><button class="btn sm" id="fiNone">Select none</button></div>
    <div class="scroll" style="max-height:48vh"><table class="t"><thead><tr><th></th><th>File</th><th>Company</th><th class="num">Accounts</th><th></th></tr></thead><tbody>${found.map(row).join('')}</tbody></table></div>
    ${skipped.length ? `<details style="margin-top:10px"><summary class="small">${skipped.length} file${skipped.length === 1 ? '' : 's'} skipped</summary><ul class="small muted">${skipped.map(([n, why]) => `<li>${esc(n)} – ${esc(why)}</li>`).join('')}</ul></details>` : ''}
    <div class="df"><button class="btn" data-act="closedlg">Cancel</button><button class="btn primary" id="fiGo">Import selected</button></div></div>`;
  $('#fiAll', d).onclick = () => $$('.fick', d).forEach(c => c.checked = true);
  $('#fiNone', d).onclick = () => $$('.fick', d).forEach(c => c.checked = false);
  $('#fiGo', d).onclick = () => {
    let n = 0;
    $$('.fick', d).filter(c => c.checked).forEach(c => { const f = found[+c.dataset.n]; const r = upsertCompany(f.p); if (f.flag !== undefined) state.companies[r.idx].interest = f.flag; n++; });
    memApplyTB(); audit(`Folder imported: ${n} trial balance${n === 1 ? '' : 's'}`); dirty(); closeDialog(); ui.tab = 'recon'; ui.sel = 0; render(); toast(`Imported ${n} trial balance${n === 1 ? '' : 's'} from the folder`);
  };
}
/* dropping a folder onto the window */
async function entryFiles(entry, acc){
  if (entry.isFile){ await new Promise(r => entry.file(f => { try { Object.defineProperty(f, 'webkitRelativePath', { value: entry.fullPath.replace(/^\//, '') }); } catch (e) {} acc.push(f); r(); }, r)); }
  else if (entry.isDirectory){ const rd = entry.createReader(); let batch; do { batch = await new Promise(r => rd.readEntries(r, () => r([]))); for (const e of batch) await entryFiles(e, acc); } while (batch.length); }
}
document.addEventListener('drop', async e => {
  const items = [...(e.dataTransfer && e.dataTransfer.items || [])].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  if (!items.some(x => x.isDirectory)) return;
  e.preventDefault(); e.stopPropagation(); document.body.classList.remove('dropping');
  const acc = []; for (const it of items) await entryFiles(it, acc); importFolder(acc);
}, true);
document.addEventListener('click', e => { const t = e.target.closest('[data-act="importfolder"]'); if (t){ e.stopPropagation(); $('#fileFolder').click(); } }, true);
document.addEventListener('change', e => { if (e.target.id === 'fileFolder'){ const f = [...e.target.files]; e.target.value = ''; importFolder(f); } }, true);
