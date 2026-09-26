import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
if(!process.env.FIRESTORE_EMULATOR_HOST||!process.env.FIREBASE_AUTH_EMULATOR_HOST)throw Error('Emulators required');
const require=createRequire(new URL('../package.json',import.meta.url));
const {initializeApp}=require('firebase-admin/app'),{getAuth}=require('firebase-admin/auth'),{getFirestore}=require('firebase-admin/firestore');
const admin=initializeApp({projectId:'demo-agency-ledger'}),email=`browser-${Date.now()}@example.com`,password='BrowserTest123!';
const user=await getAuth(admin).createUser({email,password});await getAuth(admin).setCustomUserClaims(user.uid,{ledgerAccess:true});
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5179'],{windowsHide:true,stdio:'ignore',env:{...process.env,VITE_DATA_BACKEND:'firebase',VITE_USE_FIREBASE_EMULATORS:'true',VITE_FIREBASE_PROJECT_ID:'demo-agency-ledger',VITE_FIREBASE_API_KEY:'fake-api-key',VITE_FIREBASE_AUTH_DOMAIN:'demo-agency-ledger.firebaseapp.com',VITE_FIREBASE_APP_ID:'1:123:web:test'}});
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);let browser;
try{
 for(let i=0;i<40;i++){try{if((await fetch('http://127.0.0.1:5179')).ok)break;}catch{}await new Promise(r=>setTimeout(r,250));}
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true});const page=await browser.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5179',{waitUntil:'domcontentloaded'});await page.getByLabel('Email address').fill(email);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();
 const nav=async name=>page.locator('.nav-item').filter({hasText:name}).click();await nav('Settings');
 const backup={version:2,agencies:[{id:'a',code:'A',name:'Cloud recovery test',opening:10000,openingSide:'Dr',openingDate:'2026-01-01',active:true}],transactions:[{id:'p',agencyId:'a',type:'payment',amount:2000,date:'2026-02-01',voucher:'P',createdAt:'2026-02-01T00:00:00Z',status:'pending',method:'Cash'}],activity:[]};
 await page.getByLabel('Backup file').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});const dl=page.waitForEvent('download');await page.getByRole('button',{name:'Download current ledger before restore'}).click();await dl;await page.getByLabel('Replace current agencies').check();await page.getByRole('button',{name:'Restore confirmed backup'}).click();await page.getByText('Backup restored. Records and history are saved.').waitFor();
 const recoveryDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Download latest recovery copy'}).click();await recoveryDownload;
 const root=getFirestore(admin).doc(`ledgers/${user.uid}`);assert.equal((await root.collection('transactions').doc('p').get()).data().amount,2000);
 await nav('Reconciliation');await page.getByLabel('Payment receipt',{exact:true}).selectOption('p');await page.getByLabel('Bank account',{exact:true}).fill('BANK');await page.getByLabel('Bank statement reference').fill('REF');await page.getByLabel('Bank amount (BDT)').fill('20.00');await page.getByRole('button',{name:'Match receipt',exact:true}).click();await page.getByText('Receipt matched. Ledger balances are unchanged.').waitFor();assert.equal((await root.collection('transactions').doc('p').get()).data().reconciliation.bankReference,'REF');
 await page.getByRole('button',{name:'Remove bank match'}).click();await page.getByText('Bank match removed. Ledger balances are unchanged.').waitFor();
 await page.getByRole('button',{name:'Close periods',exact:true}).click();await page.getByLabel('Agency',{exact:true}).selectOption('a');await page.getByLabel('Close through').fill('2026-02-28');await page.getByLabel('I have reconciled').check();await page.getByRole('button',{name:'Close period',exact:true}).click();await page.getByText('Period closed. Historical financial changes are blocked.').waitFor();
 await page.getByRole('button',{name:'Corrections',exact:true}).click();await page.getByLabel('Original entry').selectOption('p');await page.getByLabel('Reversal date').fill('2026-03-01');await page.getByLabel('Reason',{exact:true}).fill('Wrong receipt');await page.getByRole('button',{name:'Post reversal'}).click();await page.getByText('Reversal saved. The original entry remains unchanged.').waitFor();assert.equal((await root.collection('transactions').get()).size,2);
 await page.reload({waitUntil:'domcontentloaded'});await nav('Reports');assert.match(await page.locator('.table-row').filter({hasText:'Cloud recovery test'}).innerText(),/100.00/);assert.deepEqual(errors,[]);console.log('PASS: cloud browser login, direct Firestore restore, bank match, period close, reversal, reload and report balance.');
}finally{if(browser)await browser.close();vite.kill();await admin.delete();}
