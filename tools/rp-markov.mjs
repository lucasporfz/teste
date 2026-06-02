#!/usr/bin/env node
// Mede as transições rune/spell (cadeia de Markov) que o parser exporta, p/ os 3 logs.
// 1 log por processo (estado do parser contamina entre logs). Uso: node tools/rp-markov.mjs
import fs from 'node:fs'; import vm from 'node:vm'; import path from 'node:path'; import process from 'node:process';
const ROOT = process.cwd(); const read = p => fs.readFileSync(p, 'utf8');
const html = read(path.join(ROOT, 'index novo.html'));
function brace(s, from, open) { const cl = open === '{' ? '}' : ']'; const oi = s.indexOf(open, from); let d = 0, st = null; for (let i = oi; i < s.length; i++) { const ch = s[i], pv = s[i - 1]; if (st) { if (ch === st && pv !== '\\') st = null; continue; } if (ch === '"' || ch === "'" || ch === '`') { st = ch; continue; } if (ch === open) d++; else if (ch === cl) { d--; if (d === 0) return s.slice(oi, i + 1); } } return null; }
function ext(name) { let i = html.indexOf('function ' + name + '('); if (i >= 0) return html.slice(i, html.indexOf('{', i)) + brace(html, i, '{'); for (const kw of ['const ', 'let ', 'var ']) { const j = html.indexOf(kw + name); if (j >= 0) { const eq = html.indexOf('=', j); const o = html.indexOf('{', eq), b = html.indexOf('[', eq); const open = (b >= 0 && (o < 0 || b < o)) ? '[' : '{'; return kw + name + '=' + brace(html, eq, open) + ';'; } } return null; }
const mi = html.indexOf('MOB_ELEMENT_MODS'), eq = html.indexOf('=', mi), MODS = JSON.parse(brace(html, eq, '{'));
const log = process.argv[2];
const ctx = { MOB_ELEMENT_MODS: MODS, console, Math, JSON, Array, Object, Number, String, isFinite, isNaN, parseInt, parseFloat, Date };
vm.createContext(ctx);
for (const f of ['js/stats.js', 'js/paladin.js', 'js/parser-rp-helpers.js', 'js/parser.js']) vm.runInContext(read(path.join(ROOT, f)), ctx);
for (const n of ['MOBS_TABLE', 'percentile', 'extractRpGrenadePeakResidual']) if (typeof ctx[n] === 'undefined') { const s = ext(n); if (s) vm.runInContext(s, ctx); }
const orig = ctx.correctRpComponentsByElement; ctx.correctRpComponentsByElement = function (t, ts, ...r) { const x = orig.call(this, t, ts, ...r); ctx.__cap = ts; return x; };
const data = ctx.parseServerLog(read(log), true);
// reconstrói a sequência p/ contar run-lengths (sanidade)
const seq = [];
for (const t of ctx.__cap) { if (t.rpTurnKind === 'rune') seq.push('R'); else if (((t.components && t.components.spell) || 0) > 0) seq.push('S'); }
let runs = 0, consR = 0, consS = 0;
for (let i = 1; i < seq.length; i++) { if (seq[i] === seq[i-1]) { runs++; if (seq[i] === 'R') consR++; else consS++; } }
const pct = v => (100 * v).toFixed(1) + '%';
console.log(log);
console.log('  seq len=' + seq.length + ' (R=' + seq.filter(x=>x==='R').length + ' S=' + seq.filter(x=>x==='S').length + ')');
console.log('  rpRuneShare      = ' + pct(data.rpRuneShare));
console.log('  rpRuneAfterRune  = ' + pct(data.rpRuneAfterRune) + '  (runa seguida de runa)');
console.log('  rpRuneAfterSpell = ' + pct(data.rpRuneAfterSpell) + '  (spell seguida de runa)');
console.log('  repetidos consecutivos: ' + runs + ' / ' + (seq.length-1) + ' transições  (RR=' + consR + ' SS=' + consS + ')');
