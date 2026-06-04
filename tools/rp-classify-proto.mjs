#!/usr/bin/env node
// PROTÓTIPO/oráculo do "Classificador": cruza server log + local chat e produz a
// MESMA tabela única do app (arrow · runa pelo nome · spells de dano por incantação
// · granada), reusando o parser real via vm e capturando turnStats pelo wrapper de
// correctRpComponentsByElement. 1 par de logs por processo.
// Uso: node tools/rp-classify-proto.mjs "logs/server log rp.txt" "logs/localchat rp.txt"
import fs from 'node:fs'; import vm from 'node:vm'; import path from 'node:path'; import process from 'node:process';
const ROOT = process.cwd(); const read = p => fs.readFileSync(p, 'utf8');
const html = read(path.join(ROOT, 'index novo.html'));
function brace(s, from, open) { const cl = open === '{' ? '}' : ']'; const oi = s.indexOf(open, from); let d = 0, st = null; for (let i = oi; i < s.length; i++) { const ch = s[i], pv = s[i - 1]; if (st) { if (ch === st && pv !== '\\') st = null; continue; } if (ch === '"' || ch === "'" || ch === '`') { st = ch; continue; } if (ch === open) d++; else if (ch === cl) { d--; if (d === 0) return s.slice(oi, i + 1); } } return null; }
function ext(name) { let i = html.indexOf('function ' + name + '('); if (i >= 0) return html.slice(i, html.indexOf('{', i)) + brace(html, i, '{'); for (const kw of ['const ', 'let ', 'var ']) { const j = html.indexOf(kw + name); if (j >= 0) { const eq = html.indexOf('=', j); const o = html.indexOf('{', eq), b = html.indexOf('[', eq); const open = (b >= 0 && (o < 0 || b < o)) ? '[' : '{'; return kw + name + '=' + brace(html, eq, open) + ';'; } } return null; }
const mi = html.indexOf('MOB_ELEMENT_MODS'), eqi = html.indexOf('=', mi), MODS = JSON.parse(brace(html, eqi, '{'));
const ctx = { MOB_ELEMENT_MODS: MODS, console, Math, JSON, Array, Object, Number, String, Map, Set, isFinite, isNaN, parseInt, parseFloat, Date };
vm.createContext(ctx);
for (const f of ['js/stats.js', 'js/paladin.js', 'js/parser-rp-helpers.js', 'js/parser.js']) vm.runInContext(read(path.join(ROOT, f)), ctx);
for (const n of ['MOBS_TABLE', 'percentile', 'extractRpGrenadePeakResidual']) if (typeof ctx[n] === 'undefined') { const s = ext(n); if (s) vm.runInContext(s, ctx); }
// carrega o parser exclusivo + o classificador REAL no sandbox (mesma lógica do app)
vm.runInContext(read(path.join(ROOT, 'js/classifier-parser.js')), ctx);
vm.runInContext(read(path.join(ROOT, 'js/classifier.js')), ctx);

const serverLogPath = process.argv[2] || 'logs/server log rp.txt';
const localChatPath = process.argv[3] || 'logs/localchat rp.txt';
const res = ctx.classifyWithLocalChat(read(serverLogPath), read(localChatPath));

console.log('=== ' + serverLogPath.replace(/^logs\//, '') + ' + ' + localChatPath.replace(/^logs\//, '') + ' ===');
if (res.error) { console.log('ERRO: ' + res.error); process.exit(1); }
console.log('jogador: ' + (res.player || '—') + '   | spell: ' + (res.damageSpells.join(', ') || '—') +
  '   | granada: ' + ((res.grenadeSpells || []).join(', ') || '—'));

console.log('\n--- ROTAÇÃO (tabela única) ---');
console.log('  turnos  hits méd  dano méd  componente/spell');
for (const r of res.rows) {
  console.log('  ' + String(r.turns).padStart(6) + '  ' + r.hitsMean.toFixed(2).padStart(8) +
    '  ' + String(r.dmgMean).padStart(8) + '  ' + r.label);
}
console.log('  (' + res.excludedTurns + '/' + res.totalTurns + ' turnos excluídos por não alinhar 100% os 2 logs)');

console.log('\n--- detecção das incantações (top 8) ---');
console.log('  covered  recall  overcast  total  classe   speaker: incantação');
for (const g of res.ranked.slice(0, 8)) {
  const cls = (g.speaker === res.player && g.kind !== '—') ? ('✔ ' + g.kind) : (g.kind === '—' ? '—' : g.kind);
  console.log('  ' + String(g.covered).padStart(7) + '  ' + (g.recall * 100).toFixed(0).padStart(4) + '%  ' +
    (isFinite(g.overcast) ? g.overcast.toFixed(2) : '  ∞').padStart(7) + '  ' + String(g.total).padStart(5) +
    '  ' + cls.padEnd(9) + '  ' + g.speaker + ': ' + g.text);
}
