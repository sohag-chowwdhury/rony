import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { transformWithOxc } from 'vite';
const { code } = await transformWithOxc(await fs.readFile('src/ledgerAccess.ts','utf8'),'ledgerAccess.ts');
const { resolveLedgerId } = await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
test('both shared admins resolve the same ledger; ordinary users retain their own ledger',()=>{
 const claims={ledgerAccess:true,ledgerRole:'admin',ledgerId:'shared'};
 assert.equal(resolveLedgerId('robin',claims),'shared');
 assert.equal(resolveLedgerId('sohag',claims),'shared');
 assert.equal(resolveLedgerId('ordinary',{ledgerAccess:true}),'ordinary');
});
test('unapproved, malformed and incomplete shared permissions fail closed',()=>{
 for(const claims of [{},{ledgerAccess:false},{ledgerAccess:true,ledgerId:'shared'},{ledgerAccess:true,ledgerRole:'viewer',ledgerId:'shared'},{ledgerAccess:true,ledgerRole:'admin',ledgerId:'../other'},{ledgerAccess:true,ledgerRole:'admin',ledgerId:42}])assert.throws(()=>resolveLedgerId('user',claims));
});
