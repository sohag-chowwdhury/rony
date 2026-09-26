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
