import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadSimulator } from '../scripts/harness.mjs';

const { sandbox } = loadSimulator();
const fixtureDir = 'tests/fixtures';

const expectedElementMods = {
  'boar man': [0.85, 1.10, 0.95],
  carnivostrich: [1.10, 1.20, 1.10],
  liodile: [1.10, 1.15, 1.05],
  'crape man': [0.75, 1.00, 1.05],
  rhindeer: [1.00, 1.05, 1.00],
  harpy: [1.05, 1.00, 1.10],
  'roaming dread': [1.00, 1.00, 1.09],
  cyclursus: [1.00, 1.03, 1.03],
  'crypt mage': [1.00, 1.00, 1.00]
};

for (const [mob, [physical, holy, ice]] of Object.entries(expectedElementMods)) {
  const mods = sandbox.getMobElementMods(mob);
  assert.ok(mods, `${mob} should have elemental mods`);
  assert.equal(mods.physicalDmgMod, physical, `${mob} physical mod`);
  assert.equal(mods.holyDmgMod, holy, `${mob} holy mod`);
  assert.equal(mods.iceDmgMod, ice, `${mob} ice mod`);
}

assert.equal(sandbox.getRuneElement('great fireball'), 'fire', 'great fireball rune element');
assert.equal(sandbox.getRuneElement('avalanche'), 'ice', 'avalanche rune element');
assert.equal(sandbox.getRuneElement('thunderstorm'), 'energy', 'thunderstorm rune element');
assert.equal(sandbox.getRuneElement('stoneshower'), 'earth', 'stoneshower rune element');

const mkHit = (dmg, type = 'normal', seq = 0) => ({
  ts: 100,
  seq,
  type,
  mob: 'boar man',
  dmg,
  isPrey: false
});
const mkMobHit = (mob, dmg, type = 'normal', seq = 0) => ({
  ts: 100,
  seq,
  type,
  mob,
  dmg,
  isPrey: false
});
const assertMonotonicComponents = (lines, label) => {
  const rank = { arrow: 0, spell: 1, rune: 1, grenade: 2 };
  let last = -1;
  for (let i = 0; i < lines.length; i++) {
    const comp = lines[i].correctedComponent;
    const value = rank[comp];
    assert.ok(value >= last, `${label} should be monotonic at ${i}: ${lines.map(l => l.correctedComponent).join(' -> ')}`);
    last = value;
  }
};
const assertNoIdenticalComponentSplit = (lines, label) => {
  const seen = new Map();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const key = [
      String(line.mob || '').toLowerCase(),
      Math.round(line.dmg || 0),
      line.type || 'normal'
    ].join('|');
    const prev = seen.get(key);
    if (prev && prev.component !== line.correctedComponent) {
      assert.fail(`${label} split identical hit ${key}: ${prev.component} at ${prev.index} vs ${line.correctedComponent} at ${i}`);
    }
    if (!prev) seen.set(key, { component: line.correctedComponent, index: i });
  }
};

{
  const turn = [
    ...Array.from({ length: 5 }, (_, i) => mkHit(500, 'normal', i)),
    ...Array.from({ length: 5 }, (_, i) => mkHit(1800, 'crit', i + 5))
  ];
  const stat = { components: { arrow: 0, spell: 0, grenade: 0 } };
  const lines = sandbox.buildRpClassifiedLines(turn, stat, null, 2, 1);
  assert.equal(lines.filter(l => l.correctedComponent === 'arrow').length, 5, 'spell crit after arrow should stay spell');
  assert.equal(lines.filter(l => l.correctedComponent === 'spell').length, 5, 'spell crit should not become arrow');
  assertMonotonicComponents(lines, 'spell crit after arrow');
}

{
  const turn = [
    ...Array.from({ length: 5 }, (_, i) => mkHit(1200, 'crit', i)),
    ...Array.from({ length: 5 }, (_, i) => mkHit(850, 'normal', i + 5))
  ];
  const stat = { components: { arrow: 0, spell: 0, grenade: 0 } };
  const lines = sandbox.buildRpClassifiedLines(turn, stat, null, 2, 1);
  assert.equal(lines.filter(l => l.correctedComponent === 'arrow').length, 5, 'arrow crit block should stay arrow by boundary');
  assert.equal(lines.filter(l => l.correctedComponent === 'spell').length, 5, 'spell after arrow crit should stay spell');
  assertMonotonicComponents(lines, 'arrow crit prefix');
}

{
  const turn = [
    { ...mkMobHit('cyclursus', 525, 'normal', 0), ts: 100 },
    { ...mkMobHit('cyclursus', 513, 'normal', 1), ts: 100 },
    { ...mkMobHit('cyclursus', 486, 'normal', 3), ts: 100 },
    { ...mkMobHit('cyclursus', 486, 'normal', 4), ts: 100 },
    { ...mkMobHit('crypt mage', 655, 'normal', 5), ts: 100 },
    { ...mkMobHit('roaming dread', 657, 'normal', 6), ts: 100 }
  ];
  const runeEvents = [{ ts: 100, seq: 2, type: 'rune', rune: 'great fireball', element: 'fire' }];
  const lines = sandbox.classifyRpTurnComponents(turn, { components: { arrow: 3, spell: 3, grenade: 0 } }, null, 1.82, 1, runeEvents).lines;
  assert.equal(lines[0].correctedComponent, 'arrow', 'server RP turn 2 pre-GFB cyclursus 525 should stay arrow');
  assert.equal(lines[1].correctedComponent, 'arrow', 'server RP turn 2 pre-GFB cyclursus 513 should stay arrow');
  assert.ok(lines.slice(2).every(l => l.correctedComponent === 'rune'), 'GFB turn second component should be rune, not spell');
  assert.equal(lines.filter(l => l.correctedComponent === 'spell').length, 0, 'rune turn should not contain holy spell');
  assert.equal(lines[0].runeElement, 'fire', 'great fireball anchor should carry fire element');
  assert.equal(lines[2].inferredElement, 'fire', 'GFB rune hits should carry fire element');
  assertMonotonicComponents(lines, 'server RP turn 2 rune anchor');
}

{
  const turn = [
    ...Array.from({ length: 4 }, (_, i) => mkMobHit('boar man', 500, 'normal', i)),
    ...Array.from({ length: 4 }, (_, i) => mkMobHit('boar man', 700, 'normal', i + 5))
  ];
  const runeEvents = [{ ts: 100, seq: 4, type: 'rune', rune: 'avalanche', element: 'ice' }];
  const classified = sandbox.classifyRpTurnComponents(turn, { components: { arrow: 4, spell: 0, grenade: 4 } }, 'explode', 1.82, 1, runeEvents);
  assert.equal(classified.diag.turnConflict, 'explode_with_rune', 'explode+rune should be reported as a conflict');
  assert.equal(classified.lines.filter(l => l.correctedComponent === 'grenade').length, 0, 'explode+rune conflict should not silently blend grenade into rune turn');
  assert.equal(classified.lines.filter(l => l.correctedComponent === 'rune').length, 4, 'conflicting turn should be classified as rune turn');
  assertMonotonicComponents(classified.lines, 'explode with rune conflict');
}

{
  const turn = [
    ['boar man', 1065, 'crit'], ['carnivostrich', 1289, 'crit'], ['liodile', 1546, 'crit'], ['liodile', 1585, 'crit'],
    ['liodile', 1546, 'crit'], ['carnivostrich', 1279, 'crit'], ['carnivostrich', 1259, 'crit'], ['boar man', 1063, 'crit'],
    ['liodile', 1600, 'crit'], ['liodile', 563, 'crit'], ['boar man', 695, 'normal'], ['liodile', 909, 'normal'],
    ['liodile', 909, 'normal'], ['boar man', 695, 'normal'], ['carnivostrich', 760, 'normal'], ['liodile', 909, 'normal'],
    ['carnivostrich', 760, 'normal'], ['liodile', 909, 'normal'], ['carnivostrich', 760, 'normal'], ['carnivostrich', 760, 'normal'],
    ['boar man', 695, 'normal'], ['rhindeer', 665, 'normal'], ['boar man', 812, 'normal'], ['carnivostrich', 888, 'normal'],
    ['liodile', 1063, 'normal'], ['liodile', 1063, 'normal'], ['liodile', 354, 'normal'], ['carnivostrich', 888, 'normal'],
    ['boar man', 812, 'normal'], ['liodile', 1063, 'normal'], ['rhindeer', 776, 'normal'], ['carnivostrich', 888, 'normal']
  ].map(([mob, dmg, type], i) => ({ ...mkMobHit(mob, dmg, type, i), isPrey: mob === 'liodile' }));
  const stat = { components: { arrow: 8, spell: 14, grenade: 10 } };
  const lines = sandbox.classifyRpTurnComponents(turn, stat, 'explode', 1.81, 1.25).lines;
  assert.equal(lines[8].correctedComponent, 'arrow', 'Mazzerin turn 2 liodile 1600 crit should be arrow');
  assert.equal(lines[9].correctedComponent, 'arrow', 'Mazzerin turn 2 liodile 563 crit should be arrow');
  assert.equal(lines[10].correctedComponent, 'spell', 'Mazzerin turn 2 boar 695 after crit block should be spell');
  assert.equal(lines[11].correctedComponent, 'spell', 'Mazzerin turn 2 liodile 909 should be spell');
  assert.equal(lines[24].correctedComponent, 'grenade', 'Mazzerin turn 2 liodile 1063 should be grenade');
  assert.ok(lines.slice(22).every(l => l.correctedComponent === 'grenade'), 'Mazzerin turn 2 positional grenade block should not move hits back to spell');
  assertMonotonicComponents(lines, 'Mazzerin turn 2');
  assertNoIdenticalComponentSplit(lines, 'Mazzerin turn 2');
}

{
  const turn = [
    ['cyclursus', 765, 'normal'], ['roaming dread', 596, 'normal'], ['roaming dread', 586, 'normal'], ['roaming dread', 625, 'normal'],
    ['crypt mage', 610, 'normal'], ['cyclursus', 794, 'normal'], ['crypt mage', 623, 'normal'], ['roaming dread', 613, 'normal'],
    ['crypt mage', 642, 'normal'], ['roaming dread', 627, 'normal'], ['cyclursus', 841, 'normal'], ['roaming dread', 657, 'normal'],
    ['crypt mage', 655, 'normal'], ['crypt mage', 655, 'normal'], ['roaming dread', 657, 'normal'], ['roaming dread', 657, 'normal'],
    ['roaming dread', 657, 'normal'], ['roaming dread', 657, 'normal'], ['cyclursus', 841, 'normal'], ['crypt mage', 655, 'normal'],
    ['crypt mage', 655, 'normal'], ['cyclursus', 1674, 'crit'], ['roaming dread', 1306, 'crit'], ['roaming dread', 1306, 'crit'],
    ['roaming dread', 1306, 'crit'], ['crypt mage', 1302, 'crit'], ['cyclursus', 1674, 'crit'], ['roaming dread', 1306, 'crit'],
    ['crypt mage', 1302, 'crit'], ['roaming dread', 1306, 'crit']
  ].map(([mob, dmg, type], i) => mkMobHit(mob, dmg, type, i));
  const lines = sandbox.classifyRpTurnComponents(turn, { components: { arrow: 6, spell: 12, grenade: 12 } }, 'explode', 1.82, 1).lines;
  assert.equal(lines[18].correctedComponent, 'spell', 'server RP turn 15 cyclursus 841 before grenade crit block should be spell');
  assert.equal(lines[19].correctedComponent, 'spell', 'server RP turn 15 crypt mage 655 before grenade crit block should be spell');
  assert.equal(lines[20].correctedComponent, 'spell', 'server RP turn 15 second crypt mage 655 before grenade crit block should be spell');
  assert.equal(lines[21].correctedComponent, 'grenade', 'server RP turn 15 first final crit should start grenade');
  assert.equal(lines[21].correctionReason, 'crit_suffix_grenade', 'server RP turn 15 grenade boundary should use crit suffix');
  assertMonotonicComponents(lines, 'server RP turn 15 spell/grenade boundary');
}

{
  const turn = [
    ['boar man', 700, 'normal'], ['liodile', 900, 'normal'], ['boar man', 700, 'normal'], ['carnivostrich', 760, 'normal'],
    ['boar man', 1086, 'normal'], ['liodile', 1234, 'normal'], ['rhindeer', 655, 'normal'], ['carnivostrich', 1187, 'normal'],
    ['boar man', 1086, 'normal'], ['crape man', 990, 'normal']
  ].map(([mob, dmg, type], i) => mkMobHit(mob, dmg, type, i));
  const stat = { components: { arrow: 2, spell: 2, grenade: 6 } };
  const lines = sandbox.classifyRpTurnComponents(turn, stat, 'explode', 1.81, 1).lines;
  assert.ok(lines.slice(4).every(l => l.correctedComponent === 'grenade'), 'overkill inside positional grenade block should stay grenade');
  assert.equal(lines[6].mob, 'rhindeer', 'synthetic overkill case should include rhindeer');
  assert.equal(lines[6].correctedComponent, 'grenade', 'rhindeer low damage inside grenade block should stay grenade');
  assertMonotonicComponents(lines, 'positional grenade overkill');
  assertNoIdenticalComponentSplit(lines, 'positional grenade overkill');
}

{
  const turn = [
    ['crape man', 461], ['carnivostrich', 595], ['boar man', 490], ['carnivostrich', 599],
    ['liodile', 792], ['carnivostrich', 694], ['liodile', 909], ['boar man', 695],
    ['carnivostrich', 760], ['liodile', 909], ['boar man', 695], ['carnivostrich', 760],
    ['liodile', 909], ['boar man', 695], ['carnivostrich', 760], ['liodile', 909],
    ['carnivostrich', 143], ['boar man', 1086], ['liodile', 1234], ['rhindeer', 655],
    ['carnivostrich', 1187], ['crape man', 990], ['boar man', 1086], ['carnivostrich', 1187],
    ['boar man', 1086]
  ].map(([mob, dmg], i) => mkMobHit(mob, dmg, 'normal', i));
  const stat = { components: { arrow: 8, spell: 9, grenade: 8 } };
  const lines = sandbox.classifyRpTurnComponents(turn, stat, 'explode', 1.81, 1).lines;
  assert.equal(lines[17].correctedComponent, 'grenade', 'turn 16 boar 1086 at first grenade block position should be grenade');
  assert.equal(lines[22].correctedComponent, 'grenade', 'turn 16 boar 1086 later in grenade block should be grenade');
  assert.equal(lines[17].correctionReason, 'grenade_count_anchor', 'turn 16 grenade boundary should use count anchor when crit does not discriminate');
  assertMonotonicComponents(lines, 'turn 16 identical grenade boundary');
  assertNoIdenticalComponentSplit(lines, 'turn 16 identical grenade boundary');
}

{
  const turn = [
    ['crape man', 461], ['carnivostrich', 595], ['boar man', 490],
    ['carnivostrich', 599], ['liodile', 792], ['carnivostrich', 694]
  ].map(([mob, dmg], i) => mkMobHit(mob, dmg, 'normal', i));
  const lines = sandbox.classifyRpTurnComponents(turn, { components: { arrow: 3, spell: 3, grenade: 0 } }, null, 1.81, 1).lines;
  assertMonotonicComponents(lines, 'Mazzerin turn 16 island regression');
  assert.notEqual(
    lines[1].correctedComponent + '>' + lines[2].correctedComponent,
    'spell>arrow',
    'turn 16 boundary cannot create spell island before arrow'
  );
}

{
  const turn = [786, 841, 816, 838, 803, 1363, 1363, 1363, 412, 1363]
    .map((dmg, i) => mkHit(dmg, 'crit', i));
  const lines = sandbox.classifyRpTurnComponents(turn, { components: { arrow: 5, spell: 5, grenade: 0 } }, null, 1.81, 1).lines;
  assert.equal(lines.filter(l => l.correctedComponent === 'arrow').length, 5, 'Mazzerin turn 123 should keep arrow around 5');
  assert.equal(lines.filter(l => l.correctedComponent === 'spell').length, 5, 'Mazzerin turn 123 should keep spell around 5');
  assertMonotonicComponents(lines, 'Mazzerin turn 123');
}

{
  const turn = [
    ['liodile', 1079], ['rhindeer', 1336], ['boar man', 1219], ['liodile', 1862],
    ['liodile', 1839], ['crape man', 1160], ['carnivostrich', 1477], ['boar man', 580],
    ['boar man', 1193], ['liodile', 1799], ['liodile', 1799], ['rhindeer', 1315],
    ['boar man', 471], ['carnivostrich', 1503], ['boar man', 1377], ['crape man', 1252]
  ].map(([mob, dmg], i) => mkMobHit(mob, dmg, 'crit', i));
  const lines = sandbox.classifyRpTurnComponents(turn, { components: { arrow: 8, spell: 8, grenade: 0 } }, null, 1.81, 1.25).lines;
  assert.ok(lines.some(l => l.correctedComponent === 'arrow'), 'Mazzerin turn 156 should retain arrow hits');
  assert.ok(lines.some(l => l.correctedComponent === 'spell'), 'Mazzerin turn 156 should retain spell hits');
  assertMonotonicComponents(lines, 'Mazzerin turn 156');
}

{
  const cfg = {
    baseDmgs: [600, 620, 640],
    charmDmg: 500,
    critMult: 1.8,
    paladinArrowDmg: 500,
    mobHp: 12000,
    mobXp: 10000,
    boxSize: 12,
    exitThreshold: 2,
    boxChangeTime: 18,
    flags: { paladin: true, mage: false, intel: true, charm: false, var: false, rpCycleMode: true, rpCycleTime: 24, rpCycleMobBudget: 24, rpCyclePeakBoxSize: 12, rpCycleFillTime: 4 },
    runSeed: 12345,
    coverageMode: 'rp_split',
    paladinArrowCoverage: 0.7,
    paladinSpellCoverage: 0.8,
    rpGrenadeMode: true,
    rpGrenadeDmg: 900,
    rpGrenadeIntervalSeconds: 14,
    rpRuneStartWithRune: true
  };
  const hist = sandbox.collectSimHitDistribution(cfg, 2);
  assert.ok(hist.components.rune, 'sim component histogram should expose rune');
  assert.ok(Object.values(hist.components.rune).reduce((a, b) => a + b, 0) > 0, 'sim rune histogram should not be empty');
  assert.ok(Object.values(hist.components.grenade).reduce((a, b) => a + b, 0) > 0, 'sim grenade histogram should not be empty when grenade is active');
  const log = sandbox.generateHuntLog(0, 80, 12345, cfg);
  const attacks = (log.events || []).filter(ev => ev.type === 'attack');
  assert.ok(attacks.some(ev => (ev.components || []).some(c => c.label === 'rune')), 'sim hunt log should include rune turns');
  assert.ok(attacks.some(ev => (ev.components || []).some(c => c.label === 'grenade' && c.hits > 0)), 'sim hunt log should include grenade hits');
}

{
  const cfg = {
    baseDmgs: [500, 600, 700],
    charmDmg: 500,
    critMult: 1.8,
    autoDmg: 0,
    reflectDmg: 0,
    paladinArrowDmg: 450,
    mobHp: 12000,
    mobXp: 10000,
    boxSize: 10,
    exitThreshold: 2,
    boxChangeTime: 12,
    flags: Object.freeze({ paladin: true, mage: false, intel: true, charm: true, crit: true, var: true }),
    runSeed: 98765,
    coverageMode: 'rp_split',
    paladinArrowCoverage: 0.7,
    paladinSpellCoverage: 0.8,
    rpGrenadeMode: true,
    rpGrenadeDmg: 900,
    rpGrenadeIntervalSeconds: 14,
    levels: [0],
    nSessions: 1,
    sessionSeconds: 60
  };
  const before = JSON.stringify(cfg.flags);
  assert.doesNotThrow(() => sandbox.collectSimHitDistribution(cfg, 1), 'collectSimHitDistribution should not mutate frozen flags');
  assert.doesNotThrow(() => sandbox.generateHuntLog(0, 20, 98765, cfg), 'generateHuntLog should not mutate frozen flags');
  assert.doesNotThrow(() => sandbox.runSimInline(cfg, () => {}), 'runSimInline should not mutate frozen flags');
  assert.equal(JSON.stringify(cfg.flags), before, 'simulation helpers should leave input flags unchanged');
}

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
  if (item.profile === 'rp') {
    assert.equal(data.rpComponentMonotonic?.count || 0, 0, `${item.file} should have no RP component islands`);
    for (const stat of data.turnStats || []) {
      if (stat.rpComponentLines && stat.rpComponentLines.length) {
        assertNoIdenticalComponentSplit(stat.rpComponentLines, `${item.file} turn ${stat.turn || stat.ts || '?'}`);
      }
    }
    for (const [idx, point] of (data.temporalSeries || []).entries()) {
      const c = point.components || {};
      const total = Math.max(0, Math.round((c.arrow || 0) + (c.spell || 0) + (c.rune || 0) + (c.grenade || 0)));
      assert.equal(point.mobsHit, total, `${item.file} turn ${idx + 1} aggregate hits should equal component sum`);
      assert.equal(data.hitsPerTurn[idx], total, `${item.file} turn ${idx + 1} histogram sample should equal component sum`);
    }
  }
}

console.log(`OK: ${cases.length} validator smoke fixtures passed`);
