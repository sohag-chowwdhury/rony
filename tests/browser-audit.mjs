import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true});
try {
const page=await browser.newPage();page.setDefaultTimeout(8000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto(process.env.AUDIT_URL || 'http://127.0.0.1:5178',{waitUntil:'domcontentloaded',timeout:30000});
const nav=async name=>page.locator('.nav-item').filter({hasText:name}).click();
const snapshot=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('aegis-ledger-v2')));
await nav('Agencies');await page.getByRole('button',{name:'New Agency',exact:true}).click();
await page.getByPlaceholder('ABC-001').fill('AUDIT-001');await page.getByPlaceholder('Agency name',{exact:true}).fill('Audit, "Dummy" Agency');await page.getByPlaceholder('0.00',{exact:true}).fill('100.25');
await page.getByRole('button',{name:'Save agency',exact:false}).click();
await page.locator('.modal').waitFor({state:'hidden'});
const agency=(await snapshot()).agencies.find(a=>a.code==='AUDIT-001');assert.equal(agency.opening,10025);
await nav('Ticket Sales');
await page.getByRole('button',{name:/Add.*ticket|New.*sale|Add.*sale/i}).first().click();
await page.getByLabel('Agency',{exact:false}).selectOption(agency.id);
await page.getByLabel('Ticket number').fill('AUDIT-T1');await page.getByLabel('Passenger name').fill('Dummy Passenger');await page.getByLabel('Ticket amount').fill('50.15');
await page.getByRole('button',{name:/Save entry/i}).click();await page.locator('.modal').waitFor({state:'hidden'});
let saved=await snapshot();assert.equal(saved.transactions.find(t=>t.agencyId===agency.id).amount,5015);
await nav('Payment Receipts');
await page.getByRole('button',{name:/Add.*credit|New.*payment|Add.*payment/i}).first().click();
await page.getByLabel('Agency',{exact:false}).selectOption(agency.id);
await page.getByPlaceholder('0.00',{exact:true}).fill('200.50');
await page.getByRole('button',{name:'Save entry',exact:true}).click();
assert.match(await page.locator('body').innerText(),/Select both sending and receiving banks/);
await page.getByRole('button',{name:'Cash',exact:true}).click();
await page.getByRole('button',{name:/Save entry/i}).click();await page.locator('.modal').waitFor({state:'hidden'});
saved=await snapshot();const own=saved.transactions.filter(t=>t.agencyId===agency.id);assert.equal(own.length,2);assert.equal(agency.opening+own.reduce((n,t)=>n+(t.type==='sale'?t.amount:-t.amount),0),-5010);
await page.reload();assert.equal((await snapshot()).transactions.filter(t=>t.agencyId===agency.id).length,2);
await nav('Payment Receipts');
const paymentRow=page.locator('.transaction-row').filter({hasText:agency.name});
const receiptDownload=page.waitForEvent('download');await paymentRow.getByRole('button',{name:/Download receipt/i}).click();assert.match((await receiptDownload).suggestedFilename(),/pdf$/);
await paymentRow.getByRole('button',{name:'Edit',exact:true}).click();await page.getByPlaceholder('0.00',{exact:true}).fill('200.60');await page.getByRole('button',{name:'Save entry',exact:true}).click();await page.locator('.modal').waitFor({state:'hidden'});
assert.equal((await snapshot()).transactions.find(t=>t.agencyId===agency.id&&t.type==='payment').amount,20060);
await paymentRow.getByRole('button',{name:'Archive',exact:true}).click();
await page.getByPlaceholder('Type the 6-character code').fill(await page.locator('.delete-code-box strong').innerText());await page.getByRole('button',{name:'Archive now',exact:true}).click();await page.locator('.modal').waitFor({state:'hidden'});
assert((await snapshot()).transactions.find(t=>t.agencyId===agency.id&&t.type==='payment').archivedAt);
await nav('Archive');await page.locator('.transaction-row').filter({hasText:agency.name}).getByRole('button',{name:'Restore',exact:true}).click();
assert(!(await snapshot()).transactions.find(t=>t.agencyId===agency.id&&t.type==='payment').archivedAt);
await nav('Agency Ledger');await page.locator('.ledger-toolbar select').selectOption(agency.id);
assert.match(await page.locator('.ledger-summary').innerText(),/50.20/);
const ledgerDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Download PDF',exact:true}).click();assert.match((await ledgerDownload).suggestedFilename(),/pdf$/);
await page.locator('.ledger-date-input').first().fill('2099-01-01');assert(await page.getByRole('button',{name:'Download PDF',exact:true}).isDisabled());
await nav('Reports');const reportRow=page.locator('.table-row').filter({hasText:agency.name});assert.match(await reportRow.innerText(),/50.20/);assert.match(await reportRow.innerText(),/Cr/);
const csvDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Excel / CSV'}).click();const csv=await csvDownload;assert.match(csv.suggestedFilename(),/csv$/);
await nav('Settings');const backupDownload=page.waitForEvent('download');await page.getByRole('button',{name:/Download ledger backup/}).click();const backup=await backupDownload;assert.match(backup.suggestedFilename(),/json$/);
for(const name of ['Dashboard','Agencies','Ticket Sales','Payment Receipts','Agency Ledger','Reports','Archive','Activity Log','Settings']){await nav(name);assert((await page.locator('body').innerText()).length>100);}
assert.deepEqual(errors,[]);console.log('PASS: browser agency, sale, payment, overpayment Cr, edit, archive, restore, ledger/receipt PDFs, invalid date range, reload, navigation, CSV and backup downloads.');
} finally {await browser.close();}


