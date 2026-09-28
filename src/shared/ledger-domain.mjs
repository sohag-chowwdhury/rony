import { validateOpening, protectTransaction, makeReversal, validateMatch, validateBackup } from './ledgerControls.mjs';
import { validatePaymentDetails, assertMinor, validateEntry, getBalance, canDeleteAgency, validDate, outgoingMigration, ticketHistory } from './accounting.mjs';
const textFields = ['id','code','name','contact','phone','address','agencyId','date','voucher','reference','ticket','passenger','sector','flightDate','airlineCode','airlineName','method','bank','sendingBank','receivingBank','sendingBankName','receivingBankName','chequeNumber','chequeDate','walletNumber','narration','createdAt','archivedAt','openingDate','closedThrough','reversalOf'];
const agencyFields = ['id','code','name','contact','phone','address','opening','openingSide','active','archivedAt','openingDate','closedThrough'];
const transactionFields = ['id','type','agencyId','date','voucher','reference','ticket','passenger','sector','flightDate','airlineCode','airlineName','amount','ticketCost','method','bank','sendingBank','receivingBank','sendingBankName','receivingBankName','chequeNumber','chequeDate','walletNumber','narration','status','createdAt','archivedAt','reversalOf','reconciliation','migration','nextMigration'];
export function validateId(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw Error('Invalid record ID.');
}
export function cleanRecord(entity, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Record is required.');
  const fields = entity === 'agency' ? agencyFields : transactionFields;
  const record = {};
  for (const key of Object.keys(input)) {
    if (!fields.includes(key)) throw Error(`Unsupported field: ${key}`);
    if (input[key] !== undefined) record[key] = input[key];
  }
  validateId(record.id);
  for (const key of textFields) if (key in record && (typeof record[key] !== 'string' || record[key].length > 4000)) throw Error(`Invalid ${key}.`);
  if (record.archivedAt && !Number.isFinite(Date.parse(record.archivedAt))) throw Error('Invalid archive date.');
  if (entity === 'agency') {
    if (!record.code?.trim() || !record.name?.trim() || typeof record.active !== 'boolean') throw Error('Agency code, name and active status are required.');
    if (!['Dr','Cr'].includes(record.openingSide)) throw Error('Invalid opening side.');
    assertMinor(record.opening, true);
    record.code = record.code.trim(); record.name = record.name.trim();
  } else {
    if (!record.agencyId || !['sale','payment'].includes(record.type) || !validDate(record.date) || !record.voucher?.trim()) throw Error('Invalid transaction.');
    assertMinor(record.amount);
    if (record.ticketCost !== undefined) {
      if (record.type !== 'sale') throw Error('Ticket cost is only valid for ticket sales.');
      assertMinor(record.ticketCost, true);
    }
    if (record.type === 'sale' && !record.reversalOf && (!record.ticket?.trim() || !record.passenger?.trim())) throw Error('Ticket number and passenger are required.');
    for (const key of ['flightDate','chequeDate']) if (record[key] && !validDate(record[key])) throw Error(`Invalid ${key}.`);
    if (record.archivedAt && !Number.isFinite(Date.parse(record.archivedAt))) throw Error('Invalid archive date.');
    record.voucher = record.voucher.trim(); record.status = 'synced';
  }
  return record;
}
export function applyMutation(snapshot, command, actor, timestamp) {
  const { entity, action, id } = command;
  if (!['agency','transaction'].includes(entity) || !['create','edit','delete','archive','restore','deactivate','reverse','reconcile','unreconcile'].includes(action)) throw Error('Unsupported action.');
  validateId(id);
  if (action === 'create' || action === 'edit') { if ((command.record?.migration || command.record?.nextMigration)) throw Error('Use the ticket migration action.'); }
  const list = entity === 'agency' ? snapshot.agencies : snapshot.transactions;
  const before = list.find(item => item.id === id) || null;
  if (action === 'create' ? Boolean(before) : !before) throw Error(action === 'create' ? 'Record already exists.' : 'Record no longer exists.');
  if (before?.migration) throw Error('Linked migration records cannot be changed individually.');
  if (action === 'reverse') {
    if (entity !== 'transaction') throw Error('Only transactions can be reversed.');
    const after=makeReversal(snapshot,before,command.record?.date,command.record?.reason || '',command.operationId,timestamp);
    after.status='synced';
    return { next:{...snapshot,transactions:[...snapshot.transactions,after]},after,event:{id:command.operationId,timestamp,action,entity,entityId:after.id,label:after.voucher,actor,before:null,after} };
  }
  let after = null;
  if (action === 'create' || action === 'edit') {
    after = cleanRecord(entity, command.record);
    if (after.id !== id) throw Error('Record ID mismatch.');
    if (before?.archivedAt) throw Error('Restore archived records before editing.');
    if (after.archivedAt) throw Error('Use the archive action.');
    if (entity === 'transaction') {
      if(after.reversalOf || after.reconciliation) throw Error('Use the reversal or bank matching action.');
      protectTransaction(snapshot,before,after);
      validatePaymentDetails(after);
      after.createdAt = before?.createdAt || timestamp;
      validateEntry(after, snapshot.agencies, snapshot.transactions, action === 'edit');
    } else { validateOpening(after,before || undefined,snapshot.transactions); }
    if (entity === 'agency' && snapshot.agencies.some(a => a.id !== id && a.code.trim().toLowerCase() === after.code.toLowerCase())) throw Error('Agency code already exists.');
  } else if (action === 'reconcile' || action === 'unreconcile') {
    if(entity!=='transaction')throw Error('Only receipts can be matched.');
    after={...before};
    if(action==='reconcile'){validateMatch(snapshot,before,command.record?.reconciliation);after.reconciliation=command.record.reconciliation;}else{if(!before.reconciliation)throw Error('Receipt is not matched.');delete after.reconciliation;}
  } else if (action === 'delete') {
    if(entity==='transaction') protectTransaction(snapshot,before,null);
    if(entity==='agency' && before.closedThrough)throw Error('Closed agencies cannot be deleted.');
    if (entity === 'agency' && !canDeleteAgency(before, snapshot.transactions)) throw Error('Agencies with balances or history cannot be deleted.');
  } else if (action === 'deactivate') {
    if (entity !== 'agency') throw Error('Only agencies can be deactivated.');
    after = { ...before, active: false };
  } else {
    if (Boolean(before.archivedAt) === (action === 'archive')) throw Error('Entry already has this archive state.');
    after = entity === 'transaction' ? { ...before, status: 'synced' } : { ...before, active: action === 'restore' };
    if (action === 'archive') after.archivedAt = timestamp;
    else delete after.archivedAt;
  }
  const nextList = action === 'create' ? [...list,after] : action === 'delete' ? list.filter(item=>item.id!==id) : list.map(item=>item.id===id?after:item);
  const next = { ...snapshot, [entity === 'agency' ? 'agencies' : 'transactions']: nextList };
  next.agencies.forEach(agency => getBalance(agency,next.transactions));
  const event = { id: command.operationId, timestamp, action, entity, entityId:id, label: (after||before).voucher || (after||before).name, actor, before, after };
  return { next, event, after };
}
export function validateImport(input) {
  validateBackup({version:2,...input});
  if (!input || !Array.isArray(input.agencies) || !Array.isArray(input.transactions) || !Array.isArray(input.activity)) throw Error('Invalid local backup.');
  if (input.agencies.length + input.transactions.length + input.activity.length > 400) throw Error('Import exceeds 400 records including history. Use a reviewed server migration for larger ledgers.');
  if (Buffer.byteLength(JSON.stringify(input),'utf8') > 5 * 1024 * 1024) throw Error('Import exceeds the 5 MB safety limit. Use a reviewed server migration.');
  const agencies=input.agencies.map(a=>cleanRecord('agency',a)),transactions=[];
  if (new Set(agencies.map(a=>a.id)).size!==agencies.length || new Set(agencies.map(a=>a.code.toLowerCase())).size!==agencies.length) throw Error('Duplicate agency IDs or codes.');
  for(const raw of input.transactions) { const tx=cleanRecord('transaction',raw);if(!tx.createdAt || !Number.isFinite(Date.parse(tx.createdAt)))throw Error('Imported transactions need a valid creation timestamp.');validateEntry(tx,agencies,transactions);transactions.push(tx); }
  for(const event of input.activity) {
    validateId(event.id);
    if (!['create','edit','delete','archive','restore','deactivate','import','reverse','reconcile','unreconcile','close','migrate'].includes(event.action) || !['agency','transaction','ledger'].includes(event.entity) || typeof event.label!=='string' || !Number.isFinite(Date.parse(event.timestamp))) throw Error('Invalid historical activity.');
  }
  if(new Set(input.activity.map(e=>e.id)).size!==input.activity.length)throw Error('Duplicate history IDs.');
  return {agencies,transactions,activity:input.activity};
}

export function applyTicketMigration(snapshot, request, actor, timestamp, options = {}) {
  const {sourceId, destination, operationId} = request;
  validateId(operationId); validateId(sourceId);
  const source = snapshot.transactions.find(t => t.id === sourceId);
  if (!source || source.type !== 'sale' || source.archivedAt || outgoingMigration(source) || source.reversalOf) throw Error('Select an active, unmigrated ticket sale.');
  if (source.amount !== request.sourcePrice) throw Error("Source price changed. Close and reopen the migration form.");
  if (options.legacyCloud && source.migration) throw Error('Further migration is unavailable with the current cloud rules.');
  protectTransaction(snapshot,{...source,migration:undefined},null);
  const root=ticketHistory(source,snapshot.transactions)[0];
  const from = snapshot.agencies.find(a => a.id === source.agencyId);
  const to = snapshot.agencies.find(a => a.id === destination.agencyId);
  if (!from || from.archivedAt || !to || !to.active || to.archivedAt || from.id === to.id) throw Error('Select a different active destination agency.');
  if (destination.date < source.date) throw Error('Migration date cannot precede the original sale.');
  const sale = cleanRecord('transaction',{...destination,id:operationId+'_sale',type:'sale',ticketCost:options.legacyCloud ? source.amount : root.ticketCost,createdAt:timestamp,status:'synced'});
  const credit = cleanRecord('transaction',{id:operationId+'_credit',type:'payment',agencyId:source.agencyId,date:sale.date,voucher:'C-'+operationId,amount:source.amount,createdAt:timestamp,status:'synced',narration:'Ticket adjustment',ticket:source.ticket,passenger:source.passenger});
  protectTransaction(snapshot,null,credit);protectTransaction(snapshot,null,sale);
  validateEntry(credit,snapshot.agencies,snapshot.transactions);
  validateEntry(sale,snapshot.agencies,[...snapshot.transactions,credit]);
  const migration={...(options.legacyCloud ? {} : {rootId:root.id}),id:operationId,sourceId,creditId:credit.id,saleId:sale.id,fromAgencyId:from.id,toAgencyId:to.id,sourcePrice:source.amount,sellingPrice:sale.amount,createdAt:timestamp};
  const after={...source,...(source.migration ? {nextMigration:migration} : {migration})};credit.migration=migration;sale.migration=migration;
  const next={...snapshot,transactions:[...snapshot.transactions.map(t=>t.id===sourceId?after:t),credit,sale]};
  const event={id:operationId,timestamp,action:'migrate',entity:'transaction',entityId:sourceId,label:source.voucher,actor,before:source,after};
  return {next,event,after,credit,sale};
}
