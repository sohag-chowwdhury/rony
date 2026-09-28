import fs from 'node:fs';
import { after, test } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc, updateDoc } from 'firebase/firestore';
const env=await initializeTestEnvironment({projectId:'demo-agency-ledger',firestore:{host:'127.0.0.1',port:8080,rules:fs.readFileSync('firestore.rules','utf8')}});
after(()=>env.cleanup());
await env.withSecurityRulesDisabled(async context=>{
 const db=context.firestore();
 await setDoc(doc(db,'ledgers/alice'),{revision:1});
 await setDoc(doc(db,'ledgers/alice/transactions/t'),{amount:100});
 await setDoc(doc(db,'ledgers/alice/activity/log'),{actor:'alice'});
 await setDoc(doc(db,'ledgers/alice/recovery/copy'),{snapshot:{version:2}});
 await setDoc(doc(db,'ledgers/alice/operations/op'),{hash:'private'});
});
const owner=env.authenticatedContext('alice',{ledgerAccess:true}).firestore();
test('authorized owner can read metadata, records and audit',async()=>{
 for(const path of ['ledgers/alice','ledgers/alice/transactions/t','ledgers/alice/activity/log','ledgers/alice/recovery/copy'])await assertSucceeds(getDoc(doc(owner,path)));
});
test('unauthenticated, unapproved and other users cannot read financial data',async()=>{
 for(const db of [env.unauthenticatedContext().firestore(),env.authenticatedContext('alice').firestore(),env.authenticatedContext('bob',{ledgerAccess:true}).firestore()])await assertFails(getDoc(doc(db,'ledgers/alice/transactions/t')));
});
test('even owner cannot bypass server validation or rewrite audit',async()=>{
 for(const path of ['ledgers/alice','ledgers/alice/transactions/t','ledgers/alice/activity/log']){
  await assertFails(setDoc(doc(owner,path),{amount:-100}));await assertFails(updateDoc(doc(owner,path),{amount:200}));await assertFails(deleteDoc(doc(owner,path)));
 }
});
test('operation receipts and unknown collections are private',async()=>{
 await assertFails(getDoc(doc(owner,'ledgers/alice/operations/op')));await assertFails(setDoc(doc(owner,'ledgers/alice/unknown/x'),{}));
});

test('personal records are private and cannot alter business balances',async()=>{
 const path='personalLedgers/alice/entries/personal-one';
 const record={id:'personal-one',person:'Rahim',direction:'receivable',amount:10000,paid:0,date:'2026-09-28',reason:'Rent',createdAt:'2026-09-28T10:00:00Z'};
 await assertSucceeds(setDoc(doc(owner,path),record));
 await assertSucceeds(getDoc(doc(owner,path)));
 for(const db of [env.unauthenticatedContext().firestore(),env.authenticatedContext('alice').firestore(),env.authenticatedContext('bob',{ledgerAccess:true,ledgerRole:'admin',ledgerId:'alice'}).firestore()]) await assertFails(getDoc(doc(db,path)));
 await assertFails(updateDoc(doc(owner,path),{paid:100}));
 await assertSucceeds(updateDoc(doc(owner,path),{person:'Karim',reason:'Updated',amount:12000}));
 await assertSucceeds(updateDoc(doc(owner,path),{amount:10000}));
 await assertFails(deleteDoc(doc(owner,path)));
 const {runTransaction}=await import('firebase/firestore');
 const repay=amount=>runTransaction(owner,async transaction=>{
  const ref=doc(owner,path),snapshot=await transaction.get(ref);
  const id=`payment-${amount}`;
  transaction.update(ref,{paid:snapshot.data().paid+amount,lastPaymentId:id});
  transaction.set(doc(owner,`${path}/payments/${id}`),{id,amount,date:'2026-09-28',note:''});
 });
 await assertSucceeds(repay(3000));
 await assertFails(updateDoc(doc(owner,path),{amount:2999}));
 await assertFails(updateDoc(doc(owner,path),{date:'2026-09-29'}));
 await assertFails(updateDoc(doc(owner,path),{paid:0}));
 await assertSucceeds(updateDoc(doc(owner,path),{direction:'payable'}));
 await assertFails(updateDoc(doc(env.authenticatedContext('bob',{ledgerAccess:true}).firestore(),path),{deleted:true}));
 await assertFails(repay(8000));
 await assertSucceeds(repay(7000));
 await assertSucceeds(updateDoc(doc(owner,path),{deleted:true}));
 await assertFails(updateDoc(doc(owner,path),{deleted:false}));
 await assertFails(updateDoc(doc(owner,path),{amount:20000}));
 await assertFails(repay(1));
 await assertSucceeds(getDoc(doc(owner,path+'/payments/payment-3000')));
 const business=await getDoc(doc(owner,'ledgers/alice'));
 if(business.data().revision!==1)throw Error('Personal repayment changed business revision');
});

test('deleted personal entries reject repayments even with an outstanding balance', async () => {
 const { runTransaction } = await import('firebase/firestore');
 const ref = doc(owner, 'personalLedgers/alice/entries/deleted-outstanding');
 await assertSucceeds(setDoc(ref, { id: 'deleted-outstanding', person: 'Rahim', direction: 'receivable', amount: 10000, paid: 0, date: '2026-09-28', reason: 'Rent', createdAt: '2026-09-28T10:00:00Z' }));
 await assertSucceeds(updateDoc(ref, { deleted: true }));
 await assertFails(runTransaction(owner, async tx => {
  await tx.get(ref);
  tx.update(ref, { paid: 100, lastPaymentId: 'p' });
  tx.set(doc(ref, 'payments/p'), { id: 'p', amount: 100, date: '2026-09-28', note: '' });
 }));
});
