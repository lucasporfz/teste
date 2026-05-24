import fs from 'node:fs';
import path from 'node:path';
import { loadSimulator } from './harness.mjs';

const { sandbox } = loadSimulator();
const fixtureDir = 'tests/fixtures';
const fixtures = fs.readdirSync(fixtureDir).filter(file => file.endsWith('.txt'));

if (!fixtures.length) {
  console.error('No fixtures found.');
  process.exit(1);
}

let failed = false;
for (const fixture of fixtures) {
  const profile = fixture.includes('rp') ? 'rp' : fixture.includes('mage') ? 'mage' : 'ek';
  const text = fs.readFileSync(path.join(fixtureDir, fixture), 'utf8');
  const data = sandbox.parseServerLog(text, profile === 'rp', profile);
  const ok = !data.error && data.eventCount > 0 && data.hitsPerTurn && data.hitsPerTurn.length > 0;
  console.log(`${ok ? 'OK' : 'FAIL'} ${fixture}: events=${data.eventCount || 0}, turns=${data.hitsPerTurn?.length || 0}, xph=${Math.round(data.xphReal || 0)}`);
  if (!ok) failed = true;
}

if (failed) process.exit(1);
