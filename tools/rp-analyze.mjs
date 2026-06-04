#!/usr/bin/env node
// Audita os turnos RP de um log procurando anomalias de classificação:
//  - falso explode (mark=explode mas 0 hits de granada)
//  - runa falsa (explode_with_rune)
//  - inconsistência de dano-base por componente (spell/granada deveriam ter holyBase
//    ~constante cross-mob; outliers = provável hit mal classificado)
//  - ambíguos / sem mod de elemento
// 1 log por processo. Uso: node tools/rp-analyze.mjs "logs/xxx.txt"
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
const turns = ctx.__cap || [];
const med = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// coleta lines por componente
const byComp = { arrow: [], spell: [], rune: [], grenade: [] };
let nCast = 0, nExplode = 0, nNormal = 0, nRuneTurns = 0, nConflict = 0, nAmbig = 0, nMissing = 0;
const falseExplode = [];
for (let i = 0; i < turns.length; i++) {
  const t = turns[i];
  const mark = t.rpGrenade || 'normal';
  if (mark === 'cast') nCast++; else if (mark === 'explode') nExplode++; else nNormal++;
  if (t.rpTurnKind === 'rune') nRuneTurns++;
  const lines = t.rpComponentLines || [];
  const gHits = lines.filter(l => l.correctedComponent === 'grenade').length;
  if (mark === 'explode' && gHits === 0) falseExplode.push(i + 1);
  for (const l of lines) {
    if (l.turnConflict === 'explode_with_rune') nConflict++;
    const hb = l.holyOriginal;
    if (l.correctedComponent && byComp[l.correctedComponent] && Number.isFinite(hb) && hb > 0 && !l.overkill) {
      byComp[l.correctedComponent].push({ turn: i + 1, mob: l.mob, hb, dmg: l.dmg, crit: l.type === 'crit', onslaught: !!l.onslaught });
    }
  }
}

const bandGrenadeTurns = [];
for (let i = 0; i < turns.length; i++) { const ls = turns[i].rpComponentLines || []; if (ls.some(l => l.boundaryReason === 'bands_arrow_spell_grenade_3band' || l.boundaryReason === 'crit_arrow_then_spell_grenade_bands')) bandGrenadeTurns.push(i + 1); }
console.log('=== ' + log.replace(/^logs\//, '') + ' ===');
if (bandGrenadeTurns.length) console.log('granada detectada por BANDA (3 bandas) nos turnos: ' + bandGrenadeTurns.join(','));
console.log('turnos=' + turns.length + '  normal=' + nNormal + ' cast=' + nCast + ' explode=' + nExplode + '  runaTurns=' + nRuneTurns + '  explode_with_rune=' + nConflict);
console.log('monotonic=' + (data.rpComponentMonotonic ? JSON.stringify(data.rpComponentMonotonic) : '-'));
if (falseExplode.length) console.log('⚠ FALSO EXPLODE (explode sem hits de granada): turnos ' + falseExplode.join(','));

for (const comp of ['arrow', 'spell', 'rune', 'grenade']) {
  const arr = byComp[comp];
  if (!arr.length) { console.log('  ' + comp + ': (vazio)'); continue; }
  const hbs = arr.map(x => x.hb);
  const m = med(hbs);
  // outliers: holyBase desvia >18% da mediana do componente (spell/granada/rune deveriam ser ~constantes)
  const tol = comp === 'arrow' ? 0.35 : 0.18;
  const out = arr.filter(x => Math.abs(x.hb - m) / m > tol);
  const lo = Math.min(...hbs), hi = Math.max(...hbs);
  console.log('  ' + comp + ': n=' + arr.length + ' medHolyBase=' + Math.round(m) + ' range=[' + Math.round(lo) + '..' + Math.round(hi) + '] outliers>' + (tol * 100) + '%=' + out.length);
  if (comp !== 'arrow') {
    for (const o of out.slice(0, 8)) console.log('      t' + o.turn + ' ' + o.mob + ' holyBase=' + Math.round(o.hb) + ' (dmg ' + o.dmg + (o.crit ? ' crit' : '') + (o.onslaught ? ' onsl' : '') + ')  desvio ' + ((o.hb - m) / m * 100).toFixed(0) + '%');
  }
}
