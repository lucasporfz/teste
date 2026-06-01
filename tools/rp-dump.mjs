#!/usr/bin/env node
// Área de testes do classificador RP (dev — não entra no HTML, não toca no código principal).
// Carrega o PARSER REAL (js/parser.js + helpers) num sandbox vm, em PROCESSO LIMPO,
// e roda parseServerLog para inspecionar a classificação por turno.
//
// Uso:
//   node tools/rp-dump.mjs "<log>" <turno1based>          -> dump hit-a-hit (com dano-base)
//   node tools/rp-dump.mjs "<log>" --counts               -> contagem arrow/spell/grenade por turno
//   node tools/rp-dump.mjs "<log>" --seqs                 -> sequência de componentes por turno (1 linha/turno)
//   node tools/rp-dump.mjs "<log>" --helpers <arquivo.js> -> usa esse helpers no lugar do working tree
//
// Para comparar HEAD x atual SEM vazamento de estado, rode em DOIS processos:
//   git show HEAD:js/parser-rp-helpers.js > tools/_head.js
//   node tools/rp-dump.mjs "<log>" --seqs --helpers tools/_head.js > tools/_a.txt
//   node tools/rp-dump.mjs "<log>" --seqs                          > tools/_b.txt
//   (e diffar _a.txt _b.txt)

import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(p, 'utf8');
const html = read(path.join(ROOT, 'index novo.html'));

function brace(src, from, open) {
  const cl = open === '{' ? '}' : ']';
  const oi = src.indexOf(open, from);
  let d = 0, st = null;
  for (let i = oi; i < src.length; i++) {
    const ch = src[i], pv = src[i - 1];
    if (st) { if (ch === st && pv !== '\\') st = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { st = ch; continue; }
    if (ch === open) d++; else if (ch === cl) { d--; if (d === 0) return src.slice(oi, i + 1); }
  }
  return null;
}
function extNamed(name) {
  let i = html.indexOf('function ' + name + '(');
  if (i >= 0) return html.slice(i, html.indexOf('{', i)) + brace(html, i, '{');
  for (const kw of ['const ', 'let ', 'var ']) {
    const j = html.indexOf(kw + name);
    if (j >= 0) {
      const eq = html.indexOf('=', j);
      const o = html.indexOf('{', eq), b = html.indexOf('[', eq);
      const open = (b >= 0 && (o < 0 || b < o)) ? '[' : '{';
      return kw + name + '=' + brace(html, eq, open) + ';';
    }
  }
  return null;
}

function buildContext(helpersPath) {
  const mi = html.indexOf('MOB_ELEMENT_MODS');
  const eq = html.indexOf('=', mi);
  const MODS = JSON.parse(brace(html, eq, '{'));
  const ctx = { MOB_ELEMENT_MODS: MODS, console, Math, JSON, Array, Object, Number, String, isFinite, isNaN, parseInt, parseFloat, Date };
  vm.createContext(ctx);
  vm.runInContext(read(path.join(ROOT, 'js/stats.js')), ctx);
  vm.runInContext(read(path.join(ROOT, 'js/paladin.js')), ctx);
  vm.runInContext(read(helpersPath || path.join(ROOT, 'js/parser-rp-helpers.js')), ctx);
  vm.runInContext(read(path.join(ROOT, 'js/parser.js')), ctx);
  for (const n of ['MOBS_TABLE', 'percentile', 'extractRpGrenadePeakResidual']) {
    if (typeof ctx[n] === 'undefined') { const s = extNamed(n); if (s) vm.runInContext(s, ctx); }
  }
  const orig = ctx.correctRpComponentsByElement;
  ctx.correctRpComponentsByElement = function (t, ts, ...r) { const x = orig.call(this, t, ts, ...r); ctx.__cap = ts; return x; };
  return ctx;
}

function classify(log, helpersPath) {
  const ctx = buildContext(helpersPath);
  ctx.parseServerLog(read(log), true);
  return ctx.__cap || [];
}

const C = { arrow: 'a', spell: 's', grenade: 'g', rune: 'r' };
function counts(L) { const c = { arrow: 0, spell: 0, grenade: 0, rune: 0 }; L.forEach(l => c[l.correctedComponent]++); return c; }

function main() {
  const args = process.argv.slice(2);
  const log = args[0];
  if (!log || !fs.existsSync(log)) { console.log('log não encontrado:', log); process.exit(1); }
  let helpers = null;
  const hi = args.indexOf('--helpers');
  if (hi >= 0) helpers = args[hi + 1];
  const turns = classify(log, helpers);

  if (args.includes('--counts')) {
    turns.forEach((t, i) => { const L = t.rpComponentLines || []; if (!L.length) return; const c = counts(L); console.log(`t${i + 1} mark=${t.rpGrenade || 'normal'} arrow=${c.arrow} spell=${c.spell} grenade=${c.grenade} rune=${c.rune}`); });
    return;
  }
  if (args.includes('--seqs')) {
    turns.forEach((t, i) => { const L = t.rpComponentLines || []; if (!L.length) return; console.log(`t${i + 1}\t` + L.map(l => C[l.correctedComponent] + (l.type === 'crit' ? '*' : '')).join('')); });
    return;
  }
  // dump de um turno
  const turnArg = args.find(a => /^\d+$/.test(a));
  const idx = turnArg ? parseInt(turnArg, 10) - 1 : 0;
  const t = turns[idx];
  if (!t) { console.log('turno fora do range'); return; }
  const L = t.rpComponentLines || [];
  const c = counts(L);
  console.log(`${log} — turno ${idx + 1} | mark=${t.rpGrenade || 'normal'} | arrow=${c.arrow} spell=${c.spell} grenade=${c.grenade} rune=${c.rune}`);
  console.log('idx comp     crit mob            dmg    physBase holyBase');
  L.forEach((l, i) => {
    console.log(
      String(i).padStart(3) + ' ' + l.correctedComponent.padEnd(8) +
      (l.type === 'crit' ? 'CRIT' : '    ') + ' ' + String(l.mob).slice(0, 14).padEnd(14) +
      ' ' + String(l.dmg).padStart(5) +
      '   ' + String(l.physicalOriginal ? Math.round(l.physicalOriginal) : '-').padStart(5) +
      '    ' + String(l.holyOriginal ? Math.round(l.holyOriginal) : '-').padStart(5)
    );
  });
}
main();
