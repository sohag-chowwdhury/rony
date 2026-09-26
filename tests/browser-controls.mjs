import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true});
try{
 const page=await browser.newPage();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5178',{waitUntil:'domcontentloaded'});
 const nav=async name=>page.locator('.nav-item').filter({hasText:name}).click();
 const snapshot=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('aegis-ledger-v2')));
 const backup={version:2,agencies:[{id:'restored',code:'RESTORE',name:'Recovery test',opening:10000,openingSide:'Dr',openingDate:'2026-01-01',active:true}],transactions:[{id:'receipt',agencyId:'restored',type:'payment',method:'Cash',amount:2000,date:'2026-02-01',voucher:'RESTORE-P',createdAt:'2026-02-01T00:00:00Z',status:'pending'}],activity:[]};
 await nav('Settings');await page.getByLabel('Backup file').setInputFiles({name:'test-backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
 assert.match(await page.locator('.restore-preview').innerText(),/80.00/);
 const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Download current ledger before restore'}).click();await downloading;
 await page.getByLabel('Replace current agencies').check();await page.getByRole('button',{name:'Restore confirmed backup'}).click();
 await page.getByText('Backup restored. Records and history are saved.').waitFor();assert.equal((await snapshot()).agencies[0].id,'restored');assert(await page.evaluate(()=>localStorage.getItem('aegis-pre-restore-backup')));
 await page.reload({waitUntil:'domcontentloaded',timeout:30000});await nav('Reconciliation');await page.getByLabel('Payment receipt',{exact:true}).selectOption('receipt');
 await page.getByLabel('Bank account',{exact:true}).fill('Bank 1234');await page.getByLabel('Bank statement reference').fill('REF-1');await page.getByLabel('Bank statement date').fill('2026-02-01');await page.getByLabel('Bank amount (BDT)').fill('19.99');await page.getByRole('button',{name:'Match receipt',exact:true}).click();await page.getByRole('alert').filter({hasText:'exactly equal'}).waitFor();
 await page.getByLabel('Bank amount (BDT)').fill('20.00');await page.getByRole('button',{name:'Match receipt',exact:true}).click();await page.getByText('Receipt matched. Ledger balances are unchanged.').waitFor();assert.equal((await snapshot()).transactions[0].reconciliation.bankReference,'REF-1');
 await page.getByRole('button',{name:'Remove bank match'}).click();await page.getByText('Bank match removed. Ledger balances are unchanged.').waitFor();
 await page.getByRole('button',{name:'Close periods',exact:true}).click();await page.getByLabel('Agency',{exact:true}).selectOption('restored');await page.getByLabel('Close through').fill('2026-02-28');await page.getByLabel('I have reconciled this period').check();await page.getByRole('button',{name:'Close period',exact:true}).click();await page.getByText('Period closed. Historical financial changes are blocked.').waitFor();
 await page.getByRole('button',{name:'Corrections',exact:true}).click();await page.getByLabel('Original entry').selectOption('receipt');await page.getByLabel('Reversal date').fill('2026-03-01');await page.getByLabel('Reason',{exact:true}).fill('Wrong receipt');await page.getByRole('button',{name:'Post reversal'}).click();await page.getByText('Reversal saved. The original entry remains unchanged.').waitFor();assert.equal((await snapshot()).transactions.length,2);
 await nav('Agency Ledger');await page.locator('.ledger-toolbar select').selectOption('restored');await page.locator('.ledger-date-input').first().fill('2026-01-01');assert.match(await page.locator('.ledger-summary').innerText(),/100.00/);
 await nav('Agencies');await page.getByRole('button',{name:'New Agency',exact:true}).click();await page.getByPlaceholder('Agency name',{exact:true}).fill('Unsaved agency');
 page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'Cancel',exact:true}).click();assert(await page.locator('.modal').isVisible());
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.locator('.modal').waitFor({state:'hidden'});
 assert.deepEqual(errors,[]);console.log('PASS: browser restore/reload, recovery copy, mismatch rejection, bank match/unmatch, close period, linked reversal, dated statement and unsaved-change warning.');
}finally{await browser.close();}

