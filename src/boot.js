{ const bl = document.getElementById('brandlogo'); if (bl) bl.innerHTML = LOGO; }
{
  const THEMES = [["forest","Forest","#1d6b52"],["ocean","Ocean","#1f5f9e"],["plum","Plum","#7a3b8f"],["ember","Ember","#c2571a"],["graphite","Graphite","#3b4651"],["rose","Rose","#b4325a"]], root = document.documentElement, LOOKS = [['auto', 'Match my device'], ['tint', 'Light – soft tint'], ['white', 'Light – plain white'], ['dark', 'Dark']];
  let saved = {}; try { saved = JSON.parse(localStorage.getItem('matchmaker.theme') || '{}'); } catch (e) {}
  let cur = { theme: root.dataset.theme || 'forest', look: saved.look || (saved.mode === 'dark' ? 'dark' : saved.mode === 'light' ? (saved.bg === 'white' ? 'white' : 'tint') : 'auto') };
  const draw = () => {
    $('#themebar').innerHTML = THEMES.map(([k, n, c]) => `<button class="sw ${cur.theme === k ? 'on' : ''}" style="background:${c}" data-theme="${k}" title="${n} colour scheme"></button>`).join('')
      + `<select class="md" data-look title="Page background">${LOOKS.map(([k, n]) => `<option value="${k}" ${cur.look === k ? 'selected' : ''}>${n}</option>`).join('')}</select>`;
  };
  const apply = () => {
    if (cur.theme === 'forest') delete root.dataset.theme; else root.dataset.theme = cur.theme;
    delete root.dataset.mode; delete root.dataset.bg;
    if (cur.look === 'dark') root.dataset.mode = 'dark';
    else if (cur.look === 'tint' || cur.look === 'white') root.dataset.mode = 'light';
    if (cur.look === 'white') root.dataset.bg = 'white';
    try { localStorage.setItem('matchmaker.theme', JSON.stringify(cur)); } catch (e) {} draw();
  };
  $('#themebar').addEventListener('click', e => { const s = e.target.closest('[data-theme]'); if (s){ cur.theme = s.dataset.theme; apply(); } });
  $('#themebar').addEventListener('change', e => { if (e.target.dataset.look !== undefined){ cur.look = e.target.value; apply(); } });
  apply();
}
render();

/* Windows app launcher: keep the local server alive while this window is open */
if (location.protocol === 'http:' && location.hostname === '127.0.0.1') {
  const beat = () => { try { fetch('/beat', { cache: 'no-store' }).catch(() => {}); } catch (e) {} };
  beat(); setInterval(beat, 15000);
}
