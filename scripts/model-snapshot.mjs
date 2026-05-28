import fs from 'node:fs';
import path from 'node:path';
import { loadSimulator } from './harness.mjs';

const root = process.cwd();
const fixtureDir = path.join(root, 'tests', 'fixtures');
const snapshotPath = path.join(root, 'tests', 'snapshots', 'model-metrics.json');
const update = process.argv.includes('--update');
const localMode = process.argv.includes('--local');
const localLogDir = 'C:/Users/Lucas/Downloads/yt/simulador/logs';
const localLogs = [
  { file: 'rp ingol.txt', profile: 'rp' },
  { file: 'mazzerin rp.txt', profile: 'rp' },
  { file: 'server log rp.txt', profile: 'rp' },
  { file: 'server log ek.txt', profile: 'ek' },
  { file: 'Server Log mrowdy 2.txt', profile: 'mage', optional: true }
];
const localRpGuardrailKeys = ['rp_coverage', 'flow_no_time', 'rp_hit_target_coverage', 'rp_hit_target_cycle'];

const TOLERANCE = {
  xph: 0.005,
  histDist: 1.0,
  mean: 0.05,
  p50: 0.05,
  p90: 0.05,
  componentMean: 0.05
};

function profileFor(file) {
  if (/rp/i.test(file)) return 'rp';
  if (/mage|ms|ed|sorc|druid/i.test(file)) return 'mage';
  return 'ek';
}

function avg(values) {
  const xs = values.filter(Number.isFinite);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function percentile(values, p) {
  const xs = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!xs.length) return 0;
  return xs[Math.min(xs.length - 1, Math.max(0, Math.round((xs.length - 1) * p)))];
}

function componentMeans(data) {
  const series = data.rpComponentSeries || {};
  return {
    arrow: avg(series.arrowHitsPerTurn || []),
    spell: avg(series.spellHitsPerTurn || []),
    rune: avg(series.runeHitsPerTurn || []),
    grenade: avg(series.grenadeHitsPerShot || [])
  };
}

function stableCandidate(c) {
  return {
    key: c.key,
    label: c.label,
    xph: Math.round(c.sim?.xph || 0),
    err: +(c.err || 0).toFixed(4),
    histDist: +(c.histDist || 0).toFixed(4),
    passXp: !!c.passXp
  };
}

function stableConfig(cfg) {
  return {
    coverageMode: cfg.coverageMode || 'none',
    boxSize: +(cfg.boxSize || 0).toFixed(4),
    exitThreshold: +(cfg.exitThreshold || 0).toFixed(4),
    boxChangeTime: +(cfg.boxChangeTime || 0).toFixed(4),
    spawnCurve: +(cfg.spawnCurve || 0).toFixed(4),
    rpGrenadeMode: !!cfg.rpGrenadeMode,
    mageUeMode: !!cfg.mageUeMode,
    paladinArrowCoverage: +(cfg.paladinArrowCoverage || 0).toFixed(4),
    paladinSpellCoverage: +(cfg.paladinSpellCoverage || 0).toFixed(4),
    rpGrenadeIntervalSeconds: +(cfg.rpGrenadeIntervalSeconds || 0).toFixed(4),
    mageUeIntervalSeconds: +(cfg.mageUeIntervalSeconds || 0).toFixed(4),
    runSeed: cfg.runSeed || 0,
    flags: {
      paladin: !!cfg.flags?.paladin,
      mage: !!cfg.flags?.mage,
      intel: !!cfg.flags?.intel,
      rpCycleMode: !!cfg.flags?.rpCycleMode,
      ekFlowMode: !!cfg.flags?.ekFlowMode
    }
  };
}

async function collectSnapshot() {
  const { sandbox } = loadSimulator();
  const originalRandom = sandbox.Math.random;
  sandbox.Math.random = () => 0.123456789;
  sandbox.runSim = () => {};

  const files = localMode
    ? localLogs
        .map(item => ({ ...item, path: path.join(localLogDir, item.file) }))
        .filter(item => fs.existsSync(item.path) || !item.optional)
    : fs.readdirSync(fixtureDir)
        .filter(file => file.endsWith('.txt'))
        .sort((a, b) => a.localeCompare(b))
        .map(file => ({ file, path: path.join(fixtureDir, file), profile: profileFor(file) }));
  const logs = [];
  for (const item of files) {
    if (!fs.existsSync(item.path)) throw new Error(`Local log missing: ${item.path}`);
    const file = item.file;
    const profile = item.profile;
    const text = fs.readFileSync(item.path, 'utf8');
    const data = sandbox.parseServerLog(text, profile === 'rp', profile);
    if (data.error) throw new Error(`${file}: ${data.error}`);
    const comparison = await sandbox.runValidatorComparison(data);
    const hits = data.hitsPerTurn || [];
    logs.push({
      file,
      profile,
      real: {
        xph: Math.round(data.xphReal || 0),
        turns: hits.length,
        mean: +avg(hits).toFixed(4),
        p50: +percentile(hits, 0.5).toFixed(4),
        p90: +percentile(hits, 0.9).toFixed(4),
        components: Object.fromEntries(Object.entries(componentMeans(data)).map(([k, v]) => [k, +v.toFixed(4)]))
      },
      chosen: {
        key: comparison.chosen?.key || '',
        label: comparison.chosen?.label || '',
        xph: Math.round(comparison.sim?.xph || 0),
        histDist: +(comparison.chosen?.histDist || 0).toFixed(4),
        cfg: stableConfig(comparison.chosen?.cfg || {})
      },
      candidates: (comparison.candidates || []).map(stableCandidate).sort((a, b) => a.key.localeCompare(b.key))
    });
  }
  sandbox.Math.random = originalRandom;
  return {
    version: 1,
    generatedFrom: 'app/index.html',
    mode: localMode ? 'local' : 'fixture',
    tolerance: TOLERANCE,
    logs
  };
}

function signedPct(candidate, realXph) {
  return realXph ? (candidate.xph - realXph) / realXph * 100 : 0;
}

function runLocalGuardrails(snapshot) {
  const failures = [];
  for (const log of snapshot.logs.filter(item => item.profile === 'rp')) {
    const byKey = new Map(log.candidates.map(c => [c.key, c]));
    const trusted = byKey.get('rp_split') || byKey.get('rp_coverage');
    const trustedAbsErr = trusted ? Math.abs(signedPct(trusted, log.real.xph)) : Infinity;
    const rpCoverage = byKey.get('rp_coverage');
    if (rpCoverage) {
      const cfg = log.chosen && log.chosen.key === 'rp_coverage' ? log.chosen.cfg : null;
      const pct = signedPct(rpCoverage, log.real.xph);
      if (pct > 20) failures.push(`${log.file}: rp_coverage still inflated (${pct.toFixed(1)}%)`);
      if (cfg && cfg.coverageMode !== 'rp_split') failures.push(`${log.file}: rp_coverage chosen config is ${cfg.coverageMode}, expected rp_split`);
    }
    for (const key of localRpGuardrailKeys) {
      const c = byKey.get(key);
      if (!c) continue;
      const signed = signedPct(c, log.real.xph);
      const absErr = Math.abs(signed);
      if (c.passXp && absErr > trustedAbsErr + 2.01) {
        failures.push(`${log.file}: ${key} passed XP guardrail with ${signed.toFixed(1)}% vs trusted ${trustedAbsErr.toFixed(1)}%`);
      }
      if (key.startsWith('rp_hit_target') && signed > 50 && c.passXp) {
        failures.push(`${log.file}: ${key} is inflated (${signed.toFixed(1)}%) but passXp=true`);
      }
    }
  }
  return failures;
}

function compareNumber(pathLabel, actual, expected, tolerance, failures) {
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) {
    if (actual !== expected) failures.push(`${pathLabel}: expected ${expected}, got ${actual}`);
    return;
  }
  if (Math.abs(actual - expected) > tolerance) {
    failures.push(`${pathLabel}: expected ${expected}, got ${actual}, tol ${tolerance}`);
  }
}

function compareSnapshots(actual, expected) {
  const failures = [];
  const byFile = new Map(expected.logs.map(log => [log.file, log]));
  for (const log of actual.logs) {
    const exp = byFile.get(log.file);
    if (!exp) {
      failures.push(`${log.file}: missing from snapshot`);
      continue;
    }
    compareNumber(`${log.file}.real.xph`, log.real.xph, exp.real.xph, exp.real.xph * TOLERANCE.xph, failures);
    compareNumber(`${log.file}.real.mean`, log.real.mean, exp.real.mean, TOLERANCE.mean, failures);
    compareNumber(`${log.file}.real.p50`, log.real.p50, exp.real.p50, TOLERANCE.p50, failures);
    compareNumber(`${log.file}.real.p90`, log.real.p90, exp.real.p90, TOLERANCE.p90, failures);
    for (const key of ['arrow', 'spell', 'rune', 'grenade']) {
      compareNumber(`${log.file}.components.${key}`, log.real.components[key], exp.real.components[key], TOLERANCE.componentMean, failures);
    }
    if (log.chosen.key !== exp.chosen.key) failures.push(`${log.file}.chosen.key: expected ${exp.chosen.key}, got ${log.chosen.key}`);
    compareNumber(`${log.file}.chosen.xph`, log.chosen.xph, exp.chosen.xph, Math.max(1, exp.chosen.xph * TOLERANCE.xph), failures);
    compareNumber(`${log.file}.chosen.histDist`, log.chosen.histDist, exp.chosen.histDist, TOLERANCE.histDist, failures);
    const expCandidates = new Map(exp.candidates.map(c => [c.key, c]));
    for (const c of log.candidates) {
      const ec = expCandidates.get(c.key);
      if (!ec) {
        failures.push(`${log.file}.candidate.${c.key}: missing from snapshot`);
        continue;
      }
      compareNumber(`${log.file}.candidate.${c.key}.xph`, c.xph, ec.xph, Math.max(1, ec.xph * TOLERANCE.xph), failures);
      compareNumber(`${log.file}.candidate.${c.key}.histDist`, c.histDist, ec.histDist, TOLERANCE.histDist, failures);
    }
  }
  return failures;
}

const actual = await collectSnapshot();

if (localMode) {
  for (const log of actual.logs) {
    console.log(`\n${log.file} (${log.profile}) real=${log.real.xph}`);
    for (const c of log.candidates.filter(c => log.profile !== 'rp' || localRpGuardrailKeys.includes(c.key) || c.key === 'rp_split')) {
      const pct = signedPct(c, log.real.xph);
      console.log(`${c.key.padEnd(24)} ${String(c.xph).padStart(10)} ${(pct >= 0 ? '+' : '') + pct.toFixed(1)}% hist=${c.histDist.toFixed(1)} pass=${c.passXp}`);
    }
  }
  const failures = runLocalGuardrails(actual);
  if (failures.length) {
    console.error(`\nLocal snapshot guardrail failed (${failures.length}):`);
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log(`\nLocal snapshot OK: ${actual.logs.length} logs`);
} else if (update) {
  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  fs.writeFileSync(snapshotPath, JSON.stringify(actual, null, 2) + '\n');
  console.log(`Snapshot updated: ${path.relative(root, snapshotPath)} (${actual.logs.length} logs)`);
} else {
  if (!fs.existsSync(snapshotPath)) {
    console.error(`Snapshot missing. Run npm run snapshot:update first.`);
    process.exit(1);
  }
  const expected = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  const failures = compareSnapshots(actual, expected);
  if (failures.length) {
    console.error(`Snapshot mismatch (${failures.length}):`);
    for (const failure of failures.slice(0, 40)) console.error(`- ${failure}`);
    if (failures.length > 40) console.error(`... ${failures.length - 40} more`);
    process.exit(1);
  }
  console.log(`Snapshot OK: ${actual.logs.length} logs`);
}
