import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {transformWithOxc} from 'vite';
import {initializeTestEnvironment,assertFails} from '@firebase/rules-unit-testing';
import {doc,setDoc,updateDoc,writeBatch,serverTimestamp,getDoc} from 'firebase/firestore';
if(!process.env.FIRESTORE_EMULATOR_HOST)throw Error('Run with Firestore emulator only');
const source=await fs.readFile(new URL('../src/directLedger.ts',import.meta.url),'utf8');
const {code}=await transformWithOxc(source,'directLedger.ts');
const compiled=code.replace('"firebase/firestore"',JSON.stringify(import.meta.resolve('firebase/firestore'))).replace('"./ledgerControls"',JSON.stringify(new URL('../src/shared/ledgerControls.mjs',import.meta.url).href)).replace('"./shared/ledger-domain.mjs"',JSON.stringify(new URL('../src/shared/ledger-domain.mjs',import.meta.url).href));
const {readDirectLedger,mutateDirectLedger,restoreDirectLedger}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const env=await initializeTestEnvironment({projectId:'demo-agency-ledger',firestore:{host:'127.0.0.1',port:8080,rules:await fs.readFile('firestore.rules','utf8')}});after(()=>env.cleanup());
const agency={id:'a',code:'A',name:'Direct test',opening:10000,openingSide:'Dr',openingDate:'2026-01-01',active:true};
function session(uid){const user={uid,email:`${uid}@example.com`},db=env.authenticatedContext(uid,{ledgerAccess:true,email:user.email}).firestore();return {user,db};}
function event(entity,action,before,after){return {id:crypto.randomUUID(),entity,action,entityId:(after||before).id,label:(after||before).voucher||(after||before).name,actor:'Local user (not authenticated)',timestamp:new Date().toISOString(),before,after};}
test('direct Firestore create/edit/close/reverse/match and immutable activity',async()=>{
 const {db,user}=session('direct');let snapshot=await readDirectLedger(db,user.uid);
 const save=async(e)=>snapshot=await mutateDirectLedger(db,user,e,snapshot.revision);
 await save(event('agency','create',null,agency));assert.equal(snapshot.revision,1);
 const tx={id:'p',type:'payment',agencyId:'a',amount:2000,date:'2026-02-01',voucher:'P',method:'Cash',createdAt:new Date().toISOString(),status:'pending'};
 const create=event('transaction','create',null,tx);await save(create);
 const replay=await mutateDirectLedger(db,user,create,1);assert.equal(replay.revision,2);
 const before=snapshot.transactions[0],match={bankAccount:'BANK',bankReference:'REF',date:'2026-02-01',amount:2000};
 await save(event('transaction','reconcile',before,{...before,reconciliation:match}));assert.equal(snapshot.transactions[0].reconciliation.amount,2000);
 await save(event('transaction','unreconcile',snapshot.transactions[0],before));
 await save(event('agency','edit',snapshot.agencies[0],{...snapshot.agencies[0],closedThrough:'2026-02-28'}));
 await assert.rejects(save(event('transaction','edit',snapshot.transactions[0],{...snapshot.transactions[0],amount:2500})),/closed/);
 await save(event('transaction','reverse',null,{...tx,id:'rev',date:'2026-03-01',type:'sale',reversalOf:'p',narration:'Reversal of P: wrong receipt'}));
 assert.equal(snapshot.transactions.length,2);assert(snapshot.transactions.some(t=>t.reversalOf==='p'));
 await assertFails(updateDoc(doc(db,'ledgers',user.uid,'transactions','p'),{amount:-5}));
 await assertFails(updateDoc(doc(db,'ledgers',user.uid,'activity',snapshot.activity[0].id),{actor:'forged'}));
 await assertFails(getDoc(doc(env.authenticatedContext('other',{ledgerAccess:true}).firestore(),'ledgers',user.uid)));
});
test('direct restore replaces a nonempty ledger and protects recovery/history',async()=>{
 const {db,user}=session('restore');let snapshot=await mutateDirectLedger(db,user,event('agency','create',null,agency),0);
 const backup={version:2,agencies:[agency],transactions:[{id:'p',agencyId:'a',type:'payment',amount:2000,date:'2026-02-01',voucher:'P',method:'Cash',createdAt:'2026-02-01T00:00:00Z',status:'pending'}],activity:[]};
 snapshot=await restoreDirectLedger(db,user,backup,snapshot.revision,'restore-op');assert.equal(snapshot.transactions[0].amount,2000);assert.equal(snapshot.activity.length,2);
 const recovery=await getDoc(doc(db,'ledgers',user.uid,'recovery','restore-op'));assert.equal(recovery.data().snapshot.agencies.length,1);
 await assertFails(updateDoc(recovery.ref,{snapshot:{}}));await assert.rejects(restoreDirectLedger(db,user,backup,0),/changed/);
});
test('malicious atomic writes still cannot bypass money validation and closed periods',async()=>{
 const {db,user}=session('attacks');let snapshot=await mutateDirectLedger(db,user,event('agency','create',null,agency),0);
 async function forge(record){const id=crypto.randomUUID(),batch=writeBatch(db);batch.set(doc(db,'ledgers',user.uid,'transactions',record.id),record);batch.set(doc(db,'ledgers',user.uid,'activity',id),{id,entity:'transaction',entityId:record.id,action:'create',actor:user.email,actorUid:user.uid,before:null,after:record,committedAt:serverTimestamp()});batch.set(doc(db,'ledgers',user.uid),{ownerUid:user.uid,revision:snapshot.revision+1,updatedAt:serverTimestamp(),hasClosedPeriods:Boolean(snapshot.agencies[0].closedThrough),lastOperation:{id,entity:'transaction',entityId:record.id,action:'create'}});return batch.commit();}
 const tx={id:'bad',type:'payment',agencyId:'a',amount:-10,date:'2026-02-01',voucher:'BAD',createdAt:'2026-02-01T00:00:00Z',status:'synced'};
 await assertFails(forge(tx));
 snapshot=await mutateDirectLedger(db,user,event('agency','edit',snapshot.agencies[0],{...snapshot.agencies[0],closedThrough:'2026-02-28'}),snapshot.revision);
 await assertFails(forge({...tx,amount:100}));
});

test('ticket cost survives cloud create, edit and reload while debit stays at selling price',async()=>{
 const {db,user}=session('ticket-cost');let snapshot=await mutateDirectLedger(db,user,event('agency','create',null,agency),0);
 const sale={id:'sale',type:'sale',agencyId:'a',amount:120015,ticketCost:100010,date:'2026-03-01',voucher:'SALE-1',ticket:'T1',passenger:'Passenger',createdAt:'2026-03-01T00:00:00Z',status:'pending'};
 snapshot=await mutateDirectLedger(db,user,event('transaction','create',null,sale),snapshot.revision);
 assert.equal(snapshot.transactions[0].ticketCost,100010);
 const before=snapshot.transactions[0];
 snapshot=await mutateDirectLedger(db,user,event('transaction','edit',before,{...before,ticketCost:110000}),snapshot.revision);
 const reloaded=await readDirectLedger(db,user.uid);
 assert.equal(reloaded.transactions[0].ticketCost,110000);assert.equal(reloaded.transactions[0].amount,120015);
});

test('ticket migration is atomic, replayable and locked against individual edits',async()=>{
 const {migrateDirectLedger}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
 const {db,user}=session('migration');let snapshot=await mutateDirectLedger(db,user,event('agency','create',null,agency),0);
 snapshot=await mutateDirectLedger(db,user,event('agency','create',null,{...agency,id:'b',code:'B'}),snapshot.revision);
 const source={id:'original',agencyId:'a',type:'sale',date:'2026-03-01',amount:5000000,ticketCost:4500000,ticket:'T1',passenger:'Original',voucher:'V1',createdAt:'2026-03-01T01:00:00Z',status:'synced'};
 snapshot=await mutateDirectLedger(db,user,event('transaction','create',null,source),snapshot.revision);
 const request={sourceId:source.id,sourcePrice:source.amount,operationId:'migration-one',destination:{agencyId:'b',date:'2026-03-02',amount:5500000,ticket:'T2',passenger:'New passenger',voucher:'V2'}};
 const revision=snapshot.revision;
 snapshot=await migrateDirectLedger(db,user,request,revision);
 assert.equal(snapshot.transactions.length,3);assert.equal(snapshot.revision,revision+1);
 const sale=snapshot.transactions.find(t=>t.id==='migration-one_sale'),credit=snapshot.transactions.find(t=>t.id==='migration-one_credit');
 assert.equal(sale.amount,5500000);assert.equal(sale.ticketCost,5000000);assert.equal(credit.amount,5000000);
 assert.equal((await migrateDirectLedger(db,user,request,revision)).revision,snapshot.revision);
 await assert.rejects(migrateDirectLedger(db,user,{...request,operationId:'second'},snapshot.revision),/unmigrated/);
 await assert.rejects(mutateDirectLedger(db,user,event('transaction','archive',sale,{...sale,archivedAt:'2026-03-03T00:00:00Z'}),snapshot.revision),/individually/);
});

test('security rules reject partial migration and altered paired prices',async()=>{
 const {applyTicketMigration}=await import('../src/shared/ledger-domain.mjs');
 const {db,user}=session('migration-attacks');let snapshot=await mutateDirectLedger(db,user,event('agency','create',null,agency),0);
 snapshot=await mutateDirectLedger(db,user,event('agency','create',null,{...agency,id:'b',code:'B'}),snapshot.revision);
 const original={id:'original',agencyId:'a',type:'sale',date:'2026-03-01',amount:5000000,ticket:'T1',passenger:'Original',voucher:'V1',createdAt:'2026-03-01T01:00:00Z',status:'synced'};
 snapshot=await mutateDirectLedger(db,user,event('transaction','create',null,original),snapshot.revision);
 const result=applyTicketMigration(snapshot,{sourceId:'original',sourcePrice:5000000,operationId:'attack',destination:{agencyId:'b',date:'2026-03-02',amount:5500000,ticket:'T2',passenger:'New',voucher:'V2'}},user.email,'2026-03-02T01:00:00Z',{legacyCloud:true});
 async function forge(records){const batch=writeBatch(db),root=doc(db,'ledgers',user.uid);for(const record of records)batch.set(doc(root,'transactions',record.id),record);batch.set(doc(root,'activity','attack'),{...result.event,actorUid:user.uid,committedAt:serverTimestamp()});batch.set(root,{ownerUid:user.uid,revision:snapshot.revision+1,updatedAt:serverTimestamp(),hasClosedPeriods:false,lastOperation:{id:'attack',entity:'transaction',entityId:'original',action:'migrate'}});return batch.commit()}
 await assertFails(forge([result.after,result.sale]));
 await assertFails(forge([result.after,{...result.credit,amount:1},result.sale]));
 assert.equal((await readDirectLedger(db,user.uid)).transactions.length,1);
});

test('cloud migration keeps existing rules and reports original-cost profit after reload',async()=>{
 const {migrateDirectLedger}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
 const {profitSummary,ticketHistory,activeLedgerRecords}=await import('../src/shared/accounting.mjs');
 const {validateBackup}=await import('../src/shared/ledgerControls.mjs');
 const {db,user}=session('original-cost-migration');let snapshot=await readDirectLedger(db,user.uid);
 for(const id of ['a','b','c'])snapshot=await mutateDirectLedger(db,user,event('agency','create',null,{...agency,id,code:id.toUpperCase()}),snapshot.revision);
 const original={id:'original',agencyId:'a',type:'sale',date:'2026-03-01',amount:1100000,ticketCost:1000000,ticket:'T1',passenger:'Original',voucher:'V1',createdAt:'2026-03-01T01:00:00Z',status:'synced'};
 snapshot=await mutateDirectLedger(db,user,event('transaction','create',null,original),snapshot.revision);
 snapshot=await migrateDirectLedger(db,user,{sourceId:original.id,sourcePrice:original.amount,operationId:'move1',destination:{agencyId:'b',date:'2026-03-02',amount:1050000,ticket:'T2',passenger:'Passenger',voucher:'V2'}},snapshot.revision);
 snapshot=await readDirectLedger(db,user.uid);const sale=snapshot.transactions.find(t=>t.id==='move1_sale');
 assert.equal(sale.ticketCost,1100000);assert.equal(sale.migration.rootId,undefined);
 assert.equal(ticketHistory(sale,snapshot.transactions)[0].ticketCost,1000000);
 assert.doesNotThrow(()=>validateBackup(snapshot));
 const rows=activeLedgerRecords(snapshot.agencies,snapshot.transactions).transactions;
 assert.equal(profitSummary(rows).total,50000);
 assert.equal(rows.find(t=>t.id===sale.id).ticketCost,1000000);
 for(const a of snapshot.agencies)assert.equal(profitSummary(rows.filter(t=>t.agencyId===a.id),rows).total,a.id==='b'?50000:0);
 await assert.rejects(migrateDirectLedger(db,user,{sourceId:sale.id,sourcePrice:sale.amount,operationId:'move2',destination:{agencyId:'c',date:'2026-03-03',amount:1200000,ticket:'T3',passenger:'Passenger',voucher:'V3'}},snapshot.revision),/current cloud rules/);
 assert.equal((await readDirectLedger(db,user.uid)).revision,snapshot.revision);
});
test('cloud migration with missing purchase cost keeps profit unknown',async()=>{
 const {migrateDirectLedger}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
 const {profitSummary}=await import('../src/shared/accounting.mjs');
 const {db,user}=session('unknown-migration');let snapshot=await readDirectLedger(db,user.uid);
 for(const id of ['a','b'])snapshot=await mutateDirectLedger(db,user,event('agency','create',null,{...agency,id,code:id}),snapshot.revision);
 const original={id:'original',agencyId:'a',type:'sale',date:'2026-03-01',amount:1100000,ticket:'T1',passenger:'Original',voucher:'V1',createdAt:'2026-03-01T01:00:00Z',status:'synced'};
 snapshot=await mutateDirectLedger(db,user,event('transaction','create',null,original),snapshot.revision);
 snapshot=await migrateDirectLedger(db,user,{sourceId:'original',sourcePrice:1100000,operationId:'unknown',destination:{agencyId:'b',date:'2026-03-02',amount:1200000,ticket:'T2',passenger:'Passenger',voucher:'V2'}},snapshot.revision);
 assert.deepEqual(profitSummary(snapshot.transactions),{total:0,missingCosts:1});
});

test('two scoped admins share writes, restore and migration while retaining their own audit identities',async()=>{
 const ledgerId='shared-admin-ledger';
 const member=uid=>({user:{uid,email:uid+'@example.com'},db:env.authenticatedContext(uid,{email:uid+'@example.com',ledgerAccess:true,ledgerRole:'admin',ledgerId}).firestore()});
 const robin=member('shared-robin'),sohag=member('shared-sohag');
 let snapshot=await mutateDirectLedger(robin.db,robin.user,event('agency','create',null,agency),0,ledgerId);
 snapshot=await mutateDirectLedger(sohag.db,sohag.user,event('agency','edit',snapshot.agencies[0],{...agency,name:'Edited by Sohag'}),snapshot.revision,ledgerId);
 assert.equal((await readDirectLedger(robin.db,ledgerId)).agencies[0].name,'Edited by Sohag');
 assert.equal((await getDoc(doc(sohag.db,'ledgers',ledgerId))).data().ownerUid,ledgerId);
 for(const member of [robin,sohag]){
  const entries=snapshot.activity.filter(e=>e.actor===member.user.email);assert(entries.length);
  for(const entry of entries)assert.equal((await getDoc(doc(member.db,'ledgers',ledgerId,'activity',entry.id))).data().actorUid,member.user.uid);
 }
 await assert.rejects(mutateDirectLedger(robin.db,robin.user,event('agency','edit',agency,{...agency,name:'Stale'}),1,ledgerId),/changed/);
 for(const outsider of [env.unauthenticatedContext().firestore(),env.authenticatedContext('outsider',{ledgerAccess:true}).firestore(),env.authenticatedContext('wrong-target',{ledgerAccess:true,ledgerRole:'admin',ledgerId:'other'}).firestore(),env.authenticatedContext('wrong-role',{ledgerAccess:true,ledgerRole:'viewer',ledgerId}).firestore()])await assertFails(getDoc(doc(outsider,'ledgers',ledgerId)));
 await assertFails(getDoc(doc(sohag.db,'ledgers',robin.user.uid)));
 await assertFails(getDoc(doc(sohag.db,'ledgers',sohag.user.uid)));
 await assertFails(setDoc(doc(sohag.db,'ledgers',ledgerId,'transactions','invalid'),{amount:-1}));
 const before=snapshot.agencies[0],afterAgency={...before,name:'Forged actor'};
 const op=event('agency','edit',before,afterAgency),batch=writeBatch(sohag.db),root=doc(sohag.db,'ledgers',ledgerId);
 batch.set(doc(root,'agencies',agency.id),afterAgency);
 batch.set(doc(root,'activity',op.id),{...op,actor:sohag.user.email,actorUid:ledgerId,committedAt:serverTimestamp()});
 batch.set(root,{ownerUid:ledgerId,revision:snapshot.revision+1,updatedAt:serverTimestamp(),hasClosedPeriods:false,lastOperation:{id:op.id,entity:'agency',entityId:agency.id,action:'edit'}});
 await assertFails(batch.commit());
 const backup={version:2,agencies:[agency,{...agency,id:'b',code:'B'}],transactions:[{id:'shared-sale',agencyId:'a',type:'sale',date:'2026-03-01',amount:5000000,ticket:'T1',passenger:'Original',voucher:'S1',createdAt:'2026-03-01T01:00:00Z',status:'synced'}],activity:[]};
 snapshot=await restoreDirectLedger(sohag.db,sohag.user,backup,snapshot.revision,'shared-restore',false,ledgerId);
 const recovery=await getDoc(doc(robin.db,'ledgers',ledgerId,'recovery','shared-restore'));assert.equal(recovery.data().snapshot.agencies[0].name,'Edited by Sohag');
 const {migrateDirectLedger}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
 snapshot=await migrateDirectLedger(robin.db,robin.user,{sourceId:'shared-sale',sourcePrice:5000000,operationId:'shared-migration',destination:{agencyId:'b',date:'2026-03-02',amount:5500000,ticket:'T2',passenger:'New',voucher:'S2'}},snapshot.revision,ledgerId);
 assert.equal(snapshot.transactions.length,3);
 assert.equal((await readDirectLedger(sohag.db,ledgerId)).revision,snapshot.revision);
 await assert.rejects(restoreDirectLedger(robin.db,robin.user,backup,snapshot.revision,'shared-import',true,ledgerId),/empty/);
});
