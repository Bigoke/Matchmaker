const { chromium } = require('playwright');
(async()=>{const b=await chromium.launch();const c=await b.newContext({acceptDownloads:true,viewport:{width:1400,height:900}});const p=await c.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));p.on('dialog',d=>d.accept());
await p.goto('file:///home/claude/matchmaker/dist/Matchmaker.html');
await p.click('[data-act=sample][data-kind=tb]');await p.waitForTimeout(300);
const [d]=await Promise.all([p.waitForEvent('download'),p.click('[data-act=pack]')]);await d.saveAs('/tmp/pack.xlsx');console.log(d.suggestedFilename());
await p.click('.brand');console.log(await p.locator('.optcard b').allInnerTexts());
await p.click('[data-act=start][data-kind=bank]');console.log(await p.evaluate(()=>state.ledger.opts.days+' '+state.ledger.A.label));
console.log(errs);await b.close()})();
