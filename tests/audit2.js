const { chromium } = require('playwright');
(async()=>{const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:1300,height:900},acceptDownloads:true});const p=await ctx.newPage();const errs=[];let pwned=false;
p.on('pageerror',e=>errs.push(e.message));p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});p.on('dialog',d=>{if(/XSS/.test(d.message())) pwned=true; d.accept()});
await p.goto('file://'+require('path').resolve(__dirname,'../dist/Matchmaker.html')+'');
const X='"><img src=x onerror=alert("XSS")><b>';
// project name + TB name + ledger label + mapper name
await p.fill('.pname',X);await p.press('.pname','Tab');
await p.click('[data-kind=tb]');
const tb=(name,rows)=>`${name}\nTrial Balance : 01/03/2024 to 28/02/2025\nAccount\tDescription\tDR\tCR\n`+rows.join('\n');
await p.click('[data-act=paste]').catch(()=>{});
await p.evaluate((X)=>{ openPaste(`${X} Co\nTrial Balance : 01/03/2024 to 28/02/2025\nAccount\tDescription\tDR\tCR\n0551/001\t- ${X} Loan\t100.00\t\n0100/001\tBank\t\t100.00`); },X);
await p.waitForTimeout(500);
await p.evaluate(()=>{const n=document.querySelector('#pasteName'); if(n){n.value='<img src=x onerror=alert("XSS")>';n.dispatchEvent(new Event('input',{bubbles:true}))}});
await p.waitForTimeout(300);
console.log('dialog text sample:', (await p.locator('#dlg').innerText()).slice(0,80).replace(/\n/g,' '));
await p.evaluate(()=>{const b=document.querySelector('#impGo, #pasteGo, [data-act=pastego]'); b&&b.click()});await p.waitForTimeout(400);
await p.evaluate(()=>closeDialog());
for (const t of ['tb','recon','review','jnl','fix','audit']){ await p.click(`[data-act=tab][data-tab=${t}]`).catch(()=>{}); await p.waitForTimeout(150); }
// ledger with evil content
await p.click('.brand'); await p.click('[data-kind=statement]');
await p.fill('[data-change=llabel][data-side=A]',X);await p.press('[data-change=llabel][data-side=A]','Tab');
await p.fill('[data-lta=A]',`Date\tReference\tDescription\tDebit\tCredit\n01/09/2025\t${X}\t${X}\t100.00\t`);
await p.fill('[data-lta=B]',`Date\tReference\tDescription\tDebit\tCredit\n01/09/2025\tZ\t<script>alert("XSS")</script>\t\t100.00`);await p.waitForTimeout(800);
await p.click('[data-act=lgo]');for(const v of ['sum','matched','diff','un','jnl']){await p.click(`[data-act=lsub][data-v=${v}]`);}
await p.evaluate(()=>{ui.tab='audit';render();});
await p.waitForTimeout(300);
console.log('XSS executed?', pwned, '| injected img elements:', await p.locator('img[src=x]').count(), '| errors', errs.slice(0,3));
// quota test: huge project
const big=await p.evaluate(()=>{ try{ const s=JSON.stringify(state).length; state.ledger.A.items=Array.from({length:60000},(_,i)=>({date:'2025-01-01',ref:'R'+i,desc:'Item number '+i+' lorem ipsum dolor',amt:i,row:i})); dirty(); return s;}catch(e){return e.message}});
await p.waitForTimeout(1500);
console.log('after 60k items: toast text =', (await p.locator('.toast').allInnerTexts()).join('|')||'(none)', '| saved in LS?', await p.evaluate(()=>!!localStorage.getItem('icr.session.v1')));
// narrow screen
await p.evaluate(()=>{state=freshState();dirty();ui.tab='home';render()});await p.setViewportSize({width:390,height:800});await p.screenshot({path:'s_mobile.png'});
await b.close()})();
