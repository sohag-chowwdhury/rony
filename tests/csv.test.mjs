import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { transformWithOxc } from 'vite';
const {code}=await transformWithOxc(await fs.readFile(new URL('../src/csv.ts',import.meta.url),'utf8'),'csv.ts');
const {encodeCsv}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
test('CSV preserves commas, quotes and newlines and neutralizes formulas',()=>{
 const cells=encodeCsv([['A, B','He said "Hi"','=1+1',12.5]]);
 assert.equal(cells, "\"A, B\",\"He said \"\"Hi\"\"\",\"'=1+1\",\"12.5\"");
 assert.equal(encodeCsv([['line1\nline2']]), "\"line1\nline2\"");
});
