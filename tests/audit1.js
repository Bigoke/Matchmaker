const E=require('../src/engine.js');
console.log('parseNum:');
for (const v of ['1,234.50','1 234,50','(100.00)','100.00-','100.00 Cr','100.00CR','-100','1.234,56','R 1 234.50','1234.5','−45.10','45.10 DR','']) console.log(JSON.stringify(v),'→',E.parseNum(v));
console.log('parseDate:');
for (const v of ['2025-09-01','01/09/2025','1/9/25','01 Sep 2025','1-Sep-25','45901','45901.5','20250901','Sep 1, 2025','01.09.2025','2025/09/01','31/12/2025','13/13/2025']) console.log(JSON.stringify(v),'→',E.parseDate(v,'dmy'));
// excel-style grid with serial dates + numeric cells
const g=[['Date','Reference','Description','Debit','Credit'],[45901,'INV1','x',1000,''],[45905,'INV2','y','',250.5],['Closing balance','','','',''],['Total','','',1000,250.5]];
const gm=E.guessLedgerMap(g);const L=E.buildLedger(g,gm.map,{hdr:gm.hdr,dateOrder:'dmy',skipBal:true});console.log(JSON.stringify(gm.map),L.items,L.skipped);
// Cr/Dr suffix single amount column + balance column
const g2=[['Date','Ref','Details','Amount','Balance'],['01/09/2025','A1','inv','1,000.00 Dr','1,000.00 Dr'],['05/09/2025','A2','pay','400.00 Cr','600.00 Dr']];
const m2=E.guessLedgerMap(g2);console.log(JSON.stringify(m2.map),E.buildLedger(g2,m2.map,{hdr:m2.hdr,dateOrder:'dmy',skipBal:true}).items);
// perf
function gen(n){const A=[],B=[];for(let i=0;i<n;i++){const d=new Date(Date.UTC(2025,0,1)+ (i%300)*864e5).toISOString().slice(0,10);const a=Math.round((Math.random()*5000+10)*100)/100;A.push({date:d,ref:'INV'+(100000+i),desc:'Invoice '+i,amt:a,row:i});if(Math.random()<0.9)B.push({date:d,ref:Math.random()<0.8?'INV'+(100000+i):'X'+i,desc:'Inv '+i,amt:-(Math.random()<0.9?a:a+1),row:i});}return [A,B];}
for (const n of [1000,5000,20000]){const [A,B]=gen(n);const t=Date.now();const R=E.matchLedgers(A,B,{mirror:true,days:30,grouped:true});console.log(n,'items',Date.now()-t,'ms matches',R.matches.length,'unA',R.unA.length,'unB',R.unB.length);}
