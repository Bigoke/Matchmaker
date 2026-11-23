const { chromium } = require('playwright');
(async()=>{const b=await chromium.launch();const p=await (await b.newContext({viewport:{width:900,height:520},deviceScaleFactor:1.5})).newPage();
await p.setContent(`<body style="background:#fff;font:15px Arial;padding:30px"><h3>Supplier Statement - ABC Traders</h3><table cellpadding=7 style="border-collapse:collapse"><tr><th align=left>Date<th align=left>Reference<th align=left>Description<th align=right>Debit<th align=right>Credit
<tr><td>01/09/2025<td>INV001<td>Invoice<td align=right>1,000.00<td>
<tr><td>05/09/2025<td>INV002<td>Invoice goods<td align=right>2,500.50<td>
<tr><td>10/09/2025<td>PAY001<td>Payment received<td><td align=right>1,000.00
<tr><td>15/09/2025<td>INV003<td>Invoice<td align=right>300.00<td></table></body>`);
await p.screenshot({path:'/tmp/ocrt/scan.png'});await b.close()})()
