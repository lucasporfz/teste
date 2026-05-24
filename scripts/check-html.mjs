import fs from 'node:fs';
import vm from 'node:vm';

const entry = 'app/index.html';
const html = fs.readFileSync(entry, 'utf8');
const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);

let ok = true;
for (let i = 0; i < scripts.length; i += 1) {
  try {
    // Syntax check only. Runtime tests live in tests/.
    new vm.Script(scripts[i], { filename: `${entry}#script-${i + 1}` });
  } catch (err) {
    ok = false;
    console.error(`Script ${i + 1} failed to parse:`);
    console.error(err.stack || err.message || err);
  }
}

if (!scripts.length) {
  ok = false;
  console.error(`No inline scripts found in ${entry}`);
}

if (!ok) process.exit(1);
console.log(`OK: ${scripts.length} inline scripts parsed from ${entry}`);
