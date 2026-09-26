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
