import { collection, doc, getDocFromServer, getDocsFromServer, runTransaction, serverTimestamp, type Firestore } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import type { Agency, Transaction } from './App';
import type { AuditEvent, LedgerSnapshot } from './history';
import { validateBackup } from './ledgerControls';
import { applyMutation } from './shared/ledger-domain.mjs';
export type DirectSnapshot=LedgerSnapshot<Agency,Transaction>&{revision:number};
const clean=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
const fingerprint=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).map(b=>b.toString(16).padStart(2,'0')).join('');
export async function readDirectLedger(db:Firestore,uid:string):Promise<DirectSnapshot>{
 const root=doc(db,'ledgers',uid);
 for(let attempt=0;attempt<4;attempt++){
  const before=await getDocFromServer(root);
  const [agencies,transactions,activity]=await Promise.all(['agencies','transactions','activity'].map(name=>getDocsFromServer(collection(root,name))));
  const after=await getDocFromServer(root);
  if((before.data()?.revision||0)!==(after.data()?.revision||0))continue;
  return {version:2,revision:after.data()?.revision||0,agencies:agencies.docs.map(d=>d.data() as Agency),transactions:transactions.docs.map(d=>d.data() as Transaction),activity:activity.docs.map(d=>{const {committedAt,requestHash,...event}=d.data();return {...event,timestamp:committedAt?.toDate?.().toISOString()||event.timestamp} as AuditEvent;}).sort((a,b)=>a.timestamp.localeCompare(b.timestamp)||a.id.localeCompare(b.id))};
 }
 throw Error('Ledger is changing on another device. Wait briefly and refresh.');
}
export async function mutateDirectLedger(db:Firestore,user:Pick<User,'uid'|'email'>,event:AuditEvent,expectedRevision:number):Promise<DirectSnapshot>{
 const root=doc(db,'ledgers',user.uid),audit=doc(root,'activity',event.id),requestHash=await fingerprint({event,expectedRevision});
 const snapshot=await readDirectLedger(db,user.uid);
 const prior=snapshot.activity.find(e=>e.id===event.id);
 if(!prior&&snapshot.revision!==expectedRevision)throw Error('Ledger changed on another device. Refresh and review your changes.');
 await runTransaction(db,async batch=>{
  const [meta,replay]=await Promise.all([batch.get(root),batch.get(audit)]);
  if(replay.exists()){if(replay.data().requestHash!==requestHash)throw Error('This operation ID was already used.');return;}
  if((meta.data()?.revision||0)!==expectedRevision)throw Error('Ledger changed on another device. Refresh and review your changes.');
  const command={entity:event.entity,action:event.action,id:event.action==='reverse'?String(event.after?.reversalOf):event.entityId,record:event.action==='reverse'?{date:event.after?.date,reason:String(event.after?.narration||'').replace(/^Reversal of [^:]+: /,'')}:event.after,operationId:event.id};
  const result=applyMutation(snapshot,command,user.email||user.uid,new Date().toISOString());
  const target=doc(root,event.entity==='agency'?'agencies':'transactions',result.after?.id||event.entityId);
  if(result.after)batch.set(target,clean(result.after));else batch.delete(target);
  if(event.action==='reverse')batch.set(doc(root,'reversals',command.id),{originalId:command.id,reversalId:result.after!.id,operationId:event.id});
  batch.set(audit,clean({...result.event,actorUid:user.uid,requestHash}));
  batch.update(audit,{committedAt:serverTimestamp()});
  batch.set(root,{revision:expectedRevision+1,ownerUid:user.uid,updatedAt:serverTimestamp(),hasClosedPeriods:Boolean(meta.data()?.hasClosedPeriods||result.next.agencies.some(a=>a.closedThrough)),lastOperation:{id:event.id,entity:event.entity,entityId:result.after?.id||event.entityId,action:event.action}});
 });
 return readDirectLedger(db,user.uid);
}
export async function restoreDirectLedger(db:Firestore,user:Pick<User,'uid'|'email'>,input:LedgerSnapshot<Agency,Transaction>,expectedRevision:number,operationId=crypto.randomUUID(),importOnly=false):Promise<DirectSnapshot>{
 const data=validateBackup(input),current=await readDirectLedger(db,user.uid);
 const root=doc(db,'ledgers',user.uid),audit=doc(root,'activity',operationId),requestHash=await fingerprint({data,expectedRevision,importOnly});
 if(current.activity.some(e=>e.id===operationId)){const replay=await getDocFromServer(audit);if(replay.data()?.requestHash!==requestHash)throw Error('Restore operation changed.');return current;}
 if(importOnly&&(current.revision||current.agencies.length||current.transactions.length||current.activity.length))throw Error('Import requires an empty cloud ledger.');
 if(current.revision!==expectedRevision)throw Error('Ledger changed after preview. Preview the backup again.');
 if(current.agencies.some(a=>a.closedThrough))throw Error('Restore cannot overwrite closed periods. Use an empty ledger.');
 if(new TextEncoder().encode(JSON.stringify(current)).length>900000)throw Error('Current ledger exceeds the recovery-copy limit.');
 const reversalDocs=await getDocsFromServer(collection(db,'ledgers',user.uid,'reversals'));
 if(current.agencies.length+current.transactions.length+data.agencies.length+data.transactions.length+data.activity.length+reversalDocs.size+data.transactions.filter(t=>t.reversalOf).length>440)throw Error('Restore exceeds the atomic write limit.');
 await runTransaction(db,async batch=>{
  const [meta,replay]=await Promise.all([batch.get(root),batch.get(audit)]);
  if(replay.exists()){if(replay.data().requestHash!==requestHash)throw Error('Restore operation changed.');return;}
  if((meta.data()?.revision||0)!==expectedRevision)throw Error('Ledger changed after preview. Preview again.');
  if(meta.data()?.hasClosedPeriods)throw Error('Restore cannot overwrite closed periods.');
  batch.set(doc(root,'recovery',operationId),{snapshot:clean(current),createdAt:serverTimestamp(),operationId});
  for(const a of current.agencies)if(!data.agencies.some(x=>x.id===a.id))batch.delete(doc(root,'agencies',a.id));
  for(const t of current.transactions)if(!data.transactions.some(x=>x.id===t.id))batch.delete(doc(root,'transactions',t.id));
  for(const r of reversalDocs.docs)batch.delete(r.ref);
  for(const a of data.agencies)batch.set(doc(root,'agencies',a.id),clean(a));
  for(const t of data.transactions){batch.set(doc(root,'transactions',t.id),clean({...t,status:'synced'}));if(t.reversalOf)batch.set(doc(root,'reversals',t.reversalOf),{originalId:t.reversalOf,reversalId:t.id,operationId});}
  data.activity.forEach((item,index)=>{const id=`restored-${operationId}-${index}`;batch.set(doc(root,'activity',id),clean({...item,id,actor:'Restored backup history (unverified)',actorUid:user.uid,imported:true,importOperation:operationId}));});
  batch.set(audit,{id:operationId,entity:'ledger',entityId:user.uid,action:importOnly?'import':'restore',label:'JSON backup restored',actor:user.email||user.uid,actorUid:user.uid,timestamp:new Date().toISOString(),before:{agencies:current.agencies.length,transactions:current.transactions.length},after:{agencies:data.agencies.length,transactions:data.transactions.length},requestHash,committedAt:serverTimestamp()});
  batch.set(root,{revision:expectedRevision+1,ownerUid:user.uid,updatedAt:serverTimestamp(),hasClosedPeriods:data.agencies.some(a=>a.closedThrough),lastOperation:{id:operationId,entity:'ledger',entityId:user.uid,action:importOnly?'import':'restore'}});
 });
 return readDirectLedger(db,user.uid);
}
