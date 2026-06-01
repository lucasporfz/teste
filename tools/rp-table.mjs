#!/usr/bin/env node
// Tabela de evidências por hit (gabarito) — dev, 1 LOG POR PROCESSO.
// Mostra, na ordem do log: dano, holyBase, físBase, crit, overkill, dt(segundo),
// e a classificação ATUAL do parser. Serve pra o usuário ditar a classificação correta.
// Uso: node tools/rp-table.mjs "<log>" <turno1based> [<turno2> ...]
import fs from 'node:fs'; import vm from 'node:vm'; import path from 'node:path'; import process from 'node:process';
const ROOT = process.cwd(); const read = p => fs.readFileSync(p, 'utf8');
const html = read(path.join(ROOT, 'index novo.html'));
function brace(s, from, open) { const cl = open === '{' ? '}' : ']'; const oi = s.indexOf(open, from); let d = 0, st = null; for (let i = oi; i < s.length; i++) { const ch = s[i], pv = s[i - 1]; if (st) { if (ch === st && pv !== '\\') st = null; continue; } if (ch === '"' || ch === "'" || ch === '`') { st = ch; continue; } if (ch === open) d++; else if (ch === cl) { d--; if (d === 0) return s.slice(oi, i + 1); } } return null; }
function ext(name) { let i = html.indexOf('function ' + name + '('); if (i >= 0) return html.slice(i, html.indexOf('{', i)) + brace(html, i, '{'); for (const kw of ['const ', 'let ', 'var ']) { const j = html.indexOf(kw + name); if (j >= 0) { const eq = html.indexOf('=', j); const o = html.indexOf('{', eq), b = html.indexOf('[', eq); const open = (b >= 0 && (o < 0 || b < o)) ? '[' : '{'; return kw + name + '=' + brace(html, eq, open) + ';'; } } return null; }
const mi = html.indexOf('MOB_ELEMENT_MODS'), eq = html.indexOf('=', mi), MODS = JSON.parse(brace(html, eq, '{'));
const ctx = { MOB_ELEMENT_MODS: MODS, console, Math, JSON, Array, Object, Number, String, isFinite, isNaN, parseInt, parseFloat, Date };
vm.createContext(ctx);
for (const f of ['js/stats.js', 'js/paladin.js', 'js/parser-rp-helpers.js', 'js/parser.js']) vm.runInContext(read(path.join(ROOT, f)), ctx);
for (const n of ['MOBS_TABLE', 'percentile', 'extractRpGrenadePeakResidual']) if (typeof ctx[n] === 'undefined') { const s = ext(n); if (s) vm.runInContext(s, ctx); }
const orig = ctx.correctRpComponentsByElement; ctx.correctRpComponentsByElement = function (t, ts, ...r) { const x = orig.call(this, t, ts, ...r); ctx.__cap = ts; return x; };
const log = process.argv[2];
ctx.parseServerLog(read(log), true);
const T = ctx.__cap;
function fmt(ts) { let s = ts; if (s > 1e6) s = Math.floor(s / 1000); return [Math.floor(s / 3600) % 24, Math.floor(s / 60) % 60, s % 60].map(n => String(n).padStart(2, '0')).join(':'); }
for (const tn of process.argv.slice(3).map(Number)) {
  const st = T[tn - 1]; if (!st) { console.log('t' + tn + ' fora do range'); continue; }
  const L = st.rpComponentLines || [];
  const c = { a: 0, s: 0, g: 0, r: 0 }; L.forEach(l => c[l.correctedComponent[0]]++);
  const t0 = Math.min(...L.map(l => l.ts));
  console.log(`\n===== ${log} t${tn} | mark=${st.rpGrenade || 'normal'} | parser: ${c.a}/${c.s}/${c.g}${c.r ? '/r' + c.r : ''} =====`);
  console.log('idx hora     dt mob            dano  holyBase fisBase crit OK  parser');
  L.forEach((l, i) => console.log(
    String(i).padStart(2) + ' ' + fmt(l.ts) + ' ' + String(l.ts - t0).padStart(1) + ' ' +
    String(l.mob).slice(0, 13).padEnd(13) + ' ' + String(l.dmg).padStart(5) + '  ' +
    String(l.holyOriginal ? Math.round(l.holyOriginal) : '-').padStart(6) + '  ' +
    String(l.physicalOriginal ? Math.round(l.physicalOriginal) : '-').padStart(6) + '  ' +
    (l.type === 'crit' ? 'C ' : '. ') + ' ' + (l.overkill ? 'K' : '.') + '  ' + l.correctedComponent));
}
