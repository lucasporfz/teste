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

// args: <server log> <local chat> [--spell "<incant|label>"] [--hits N] (filtros opcionais
// imprimem os turnos alinhados que casam, hit a hit).
const argv = process.argv.slice(2);
const positional = [], flags = {};
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) { flags[argv[i].slice(2)] = (argv[i + 1] && !argv[i + 1].startsWith('--')) ? argv[++i] : true; }
  else positional.push(argv[i]);
}
const serverLogPath = positional[0] || 'logs/server log rp.txt';
const localChatPath = positional[1] || 'logs/localchat rp.txt';
const wantTrace = flags.spell != null || flags.hits != null;
const res = ctx.classifyWithLocalChat(read(serverLogPath), read(localChatPath), { trace: wantTrace });

console.log('=== ' + serverLogPath.replace(/^logs\//, '') + ' + ' + localChatPath.replace(/^logs\//, '') + ' ===');
if (res.error) { console.log('ERRO: ' + res.error); process.exit(1); }
console.log('jogador: ' + (res.player || '—') + '   | spell: ' + (res.damageSpells.join(', ') || '—') +
  '   | granada: ' + ((res.grenadeSpells || []).join(', ') || '—'));

console.log('\n--- ROTAÇÃO (tabela única) ---');
console.log('  turnos  hits méd  dano base  dano efet  componente/spell');
for (const r of res.rows) {
  console.log('  ' + String(r.turns).padStart(6) + '  ' + r.hitsMean.toFixed(2).padStart(8) +
    '  ' + String(r.dmgBase).padStart(9) + '  ' + String(r.dmgEff).padStart(9) + '  ' + r.label);
  if (r.tiers && r.tiers.length) {
    for (const tier of r.tiers) {
      const tlabel = tier.kind === 'tier_bonus'
        ? 'com bônus' + (r.bonusMult ? ' (×' + r.bonusMult.toFixed(2) + ')' : '')
        : 'sem bônus';
      console.log('  ' + ''.padStart(6) + '  ' + tier.hitsMean.toFixed(2).padStart(8) +
        '  ' + String(tier.dmgBase).padStart(9) + '  ' + String(tier.dmgEff).padStart(9) + '    └ ' + tlabel);
    }
  }
}
console.log('  (' + res.excludedTurns + '/' + res.totalTurns + ' turnos excluídos por não alinhar 100% os 2 logs)');

if (wantTrace) {
  const spellFilter = typeof flags.spell === 'string' ? flags.spell.toLowerCase() : null;
  const hitsFilter = flags.hits != null && flags.hits !== true ? Number(flags.hits) : null;
  const label = t => (typeof ctx.clsSpellLabel === 'function' ? ctx.clsSpellLabel(t) : t) || t;
  const matchSpell = sp => !spellFilter || (sp && (sp.toLowerCase() === spellFilter || label(sp).toLowerCase() === spellFilter));
  // hits do componente principal do turno (spell se houver cast, senão granada/runa).
  const compCount = tr => tr.spell ? tr.counts.spell : (tr.gren ? tr.counts.grenade : (tr.rune ? tr.counts.rune : tr.counts.arrow));
  const hits = (res.turnTrace || []).filter(tr => matchSpell(tr.spell) && (hitsFilter == null || compCount(tr) === hitsFilter));
  console.log('\n--- TURNOS' +
    (spellFilter ? ' · spell="' + flags.spell + '"' : '') +
    (hitsFilter != null ? ' · hits=' + hitsFilter : '') +
    ' (' + hits.length + ') ---');
  for (const tr of hits) {
    const sp = tr.spell ? (label(tr.spell) + ' [' + tr.spell + ']') : (tr.gren ? 'granada [' + tr.gren + ']' : (tr.rune ? 'runa [' + tr.rune + ']' : 'só AA'));
    console.log('  turno ' + tr.idx + '  ts=' + tr.ts + '  ' + sp +
      '  | comp: arrow=' + tr.counts.arrow + ' spell=' + tr.counts.spell + ' rune=' + tr.counts.rune + ' gren=' + tr.counts.grenade);
    const lns = tr.lines.slice().sort((a, b) => (a.ts - b.ts) || (a.seq - b.seq));
    lns.forEach((l, i) => console.log('      ' + String(i).padStart(2) + '  ts=' + l.ts + '.' + l.seq + '  ' + String(l.mob).padEnd(22) +
      ' dmg=' + String(l.dmg).padStart(5) + '  base=' + String(Math.round(l.base)).padStart(5) + '  ' + (l.comp || '—').padEnd(8) + (l.ok ? ' (overkill)' : '')));
  }
}

console.log('\n--- detecção das incantações (top 8) ---');
console.log('  covered  recall  overcast  total  classe   speaker: incantação');
for (const g of res.ranked.slice(0, 8)) {
  const cls = (g.speaker === res.player && g.kind !== '—') ? ('✔ ' + g.kind) : (g.kind === '—' ? '—' : g.kind);
  console.log('  ' + String(g.covered).padStart(7) + '  ' + (g.recall * 100).toFixed(0).padStart(4) + '%  ' +
    (isFinite(g.overcast) ? g.overcast.toFixed(2) : '  ∞').padStart(7) + '  ' + String(g.total).padStart(5) +
    '  ' + cls.padEnd(9) + '  ' + g.speaker + ': ' + g.text);
}
