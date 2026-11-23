const { chromium } = require('playwright'); const fs=require('fs');
(async()=>{
 const E=require('../src/engine.js');
 const tb=(n,rows)=>`${n}\nTrial Balance : 01/03/2024 to 28/02/2025\nAccount\tDescription\tDR\tCR\n`+rows.join('\n');
 fs.writeFileSync('/tmp/fold/Alpha.txt',tb('Alpha Trading (Pty) Ltd',['0100/000\tBank\t250000.00\t','0551/001\t- Beta Holdings CC\t500000.00\t','1000/000\tSales\t\t750000.00']));
 fs.writeFileSync('/tmp/fold/sub/Beta.csv',tb('Beta Holdings CC',['0100/000\tBank\t90000.00\t','0551/001\t- Alpha Trading Pty Ltd\t\t500000.00','1000/000\tIncome\t410000.00\t']));
 fs.writeFileSync('/tmp/fold/sub/Beta copy.txt',tb('Beta Holdings CC',['0100/000\tBank\t90000.00\t','0551/001\t- Alpha Trading Pty Ltd\t\t500000.00','1000/000\tIncome\t410000.00\t']));
 fs.writeFileSync('/tmp/fold/notes.txt','just some notes');
 fs.writeFileSync('/tmp/fold/pic.png','x');
 const b=await chromium.launch();const p=await (await b.newContext({viewport:{width:1400,height:900}})).newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));p.on('dialog',d=>d.accept());
 await p.goto('file:///home/claude/matchmaker/dist/Matchmaker.html');
 await p.click('[data-act=start][data-kind=tb]');
 await p.setInputFiles('#fileFolder','/tmp/fold');await p.waitForSelector('#fiGo',{timeout:15000});
 console.log(await p.locator('.fick').count(),'rows;',await p.locator('.fick:checked').count(),'ticked');
 console.log((await p.locator('#dlg').innerText()).replace(/\n+/g,' | ').slice(0,500));
 await p.screenshot({path:'/tmp/ocrt/folder.png'});
 await p.click('#fiGo');await p.waitForTimeout(300);
 console.log(await p.evaluate(()=>state.companies.map(c=>c.name)),errs);await b.close()})();
