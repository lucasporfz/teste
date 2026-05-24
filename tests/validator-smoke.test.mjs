import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadSimulator } from '../scripts/harness.mjs';

const { sandbox } = loadSimulator();
const fixtureDir = 'tests/fixtures';

const cases = [
  { file: 'ek-sample.txt', profile: 'ek' },
  { file: 'rp-sample.txt', profile: 'rp' },
  { file: 'mazzerin-rp-sample.txt', profile: 'rp' }
];

for (const item of cases) {
  const text = fs.readFileSync(path.join(fixtureDir, item.file), 'utf8');
  const data = sandbox.parseServerLog(text, item.profile === 'rp', item.profile);
  assert.equal(data.error, undefined, `${item.file} should parse`);
  assert.ok(data.eventCount > 0, `${item.file} should have events`);
  assert.ok(data.hitsPerTurn.length > 0, `${item.file} should have turn hit samples`);
  assert.ok(data.xphReal >= 0, `${item.file} should calculate XP/h`);
}

console.log(`OK: ${cases.length} validator smoke fixtures passed`);
