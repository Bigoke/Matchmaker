const { chromium } = require('playwright');
(async()=>{const b=await chromium.launch();const p=await (await b.newContext({viewport:{width:1400,height:900}})).newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));p.on('dialog',d=>d.accept());
await p.goto('http://127.0.0.1:47831/');
await p.click('[data-act=start][data-kind=statement]');
for (const f of [process.argv[2], process.argv[3]]){
  await p.evaluate(()=>{ui.lfileSide='A'});
  await p.setInputFiles('#fileLedger', f); await p.waitForSelector('.ocin',{timeout:120000});
  const g=await p.evaluate(()=>ui.ocr.grid.map(r=>r[1]));console.log(f.split('/').pop(),g.join(','));
  const i=g.indexOf('INVO001'); if(i>=0){ await p.fill(`[data-oc="${i},1"]`,'INV001'); }
  await p.click('[data-act=ocuse]');await p.waitForTimeout(400);
  console.log('mem',await p.evaluate(()=>JSON.stringify(MEM.ocr)), 'layouts', await p.evaluate(()=>Object.keys(MEM.lay||{}).length));
}
console.log(errs);await b.close()})();
