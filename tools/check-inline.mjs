import fs from 'node:fs';
const html = fs.readFileSync('index novo.html', 'utf8');
const re = /<script(?![^>]*\bsrc=)(?![^>]*type="javascript\/worker")[^>]*>([\s\S]*?)<\/script>/gi;
const reWorker = /<script[^>]*type="javascript\/worker"[^>]*>([\s\S]*?)<\/script>/gi;
let n = 0, ok = 0;
for (const m of html.matchAll(reWorker)) { n++; try { new Function(m[1]); ok++; console.log('worker block OK (' + m[1].length + ' chars)'); } catch (e) { console.log('worker block FAIL: ' + e.message); } }
for (const m of html.matchAll(re)) {
  const body = m[1].trim();
  if (!body) continue;
  n++;
  try { new Function(body); ok++; console.log('inline block OK (' + body.length + ' chars)'); }
  catch (e) { console.log('inline block FAIL: ' + e.message); }
}
console.log('TOTAL: ' + ok + '/' + n + ' blocos parseiam');
