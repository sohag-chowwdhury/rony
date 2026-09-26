import fs from 'node:fs/promises';
import { transformWithOxc } from 'vite';
const source=await fs.readFile(new URL('../src/accounting.ts',import.meta.url),'utf8');
const {code}=await transformWithOxc(source,'accounting.ts');
await fs.writeFile(new URL('../src/shared/accounting.mjs',import.meta.url),'// Generated from src/accounting.ts. Run npm run build:domain.\n'+code);
console.log('Shared ledger validation compiled.');

const controls=await fs.readFile(new URL('../src/ledgerControls.ts',import.meta.url),'utf8');
const compiled=await transformWithOxc(controls,'ledgerControls.ts');
await fs.writeFile(new URL('../src/shared/ledgerControls.mjs',import.meta.url),compiled.code.replaceAll('"./accounting"','"./accounting.mjs"').replaceAll("'./accounting'","'./accounting.mjs'"));
