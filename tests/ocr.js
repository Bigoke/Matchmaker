const { chromium } = require('playwright');
(async()=>{const b=await chromium.launch();const p=await (await b.newContext({viewport:{width:1400,height:900}})).newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});p.on('dialog',d=>d.accept());
await p.goto('http://127.0.0.1:47831/');
await p.click('[data-act=start][data-kind=statement]');await p.waitForTimeout(300);
const file = process.argv[2];
const t0=Date.now();
await p.evaluate(()=>{ui.lfileSide='A'});
await p.setInputFiles('#fileLedger', file);
await p.waitForSelector('.ocin',{timeout:120000});console.log('ocr secs',(Date.now()-t0)/1000);
console.log(await p.evaluate(()=>ui.ocr.grid.map(r=>r.join(' | '))));
console.log('low',await p.evaluate(()=>ui.ocr.conf.flat().filter(c=>c<80).length));
// simulate a user correction to test learning
await p.screenshot({path:'/tmp/ocrt/review.png'});
await p.click('[data-act=ocuse]');await p.waitForTimeout(500);
console.log('items',await p.evaluate(()=>state.ledger.A.items.map(i=>i.ref+':'+i.amt)), await p.evaluate(()=>state.ledger.A.source));
console.log(errs);await b.close()})();
