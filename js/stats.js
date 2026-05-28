function mean(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}
function median(arr) {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}
function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const idx = Math.floor((s.length - 1) * p);
  return s[idx];
}

function modeValue(arr) {
  if (!arr || arr.length === 0) return 0;
  const counts = {};
  let best = arr[0], bestCount = 0;
  for (const v of arr) {
    counts[v] = (counts[v] || 0) + 1;
    if (counts[v] > bestCount || (counts[v] === bestCount && v < best)) {
      best = v;
      bestCount = counts[v];
    }
  }
  return best;
}

function denseP90(arr, strictP90) {
  if (arr.length === 0) return strictP90;
  const counts = {};
  for (const v of arr) counts[v] = (counts[v] || 0) + 1;
  const keys = Object.keys(counts).map(Number).sort((a, b) => a - b);
  const idx = keys.indexOf(strictP90);
  if (idx <= 0) return strictP90;
  const prev = keys[idx - 1];
  let prevCum = 0;
  for (const k of keys) {
    if (k >= strictP90) break;
    prevCum += counts[k];
  }
  const prevCumPct = prevCum / arr.length;
  const strictPct = counts[strictP90] / arr.length;
  return prevCumPct >= 0.87 && strictPct <= 0.06 ? prev : strictP90;
}

function estimateRawXpFromLog(xpEvents, mobAttackCounts, durationSeconds) {
  const recognized = Object.entries(mobAttackCounts || {})
    .filter(([name]) => MOBS_TABLE[name] && MOBS_TABLE[name][1] > 0)
    .map(([name, count]) => ({ name, count, raw: MOBS_TABLE[name][1] }))
    .sort((a, b) => b.count - a.count);
  const totalDeaths = (xpEvents || []).length;
  if (!totalDeaths || !recognized.length || !durationSeconds) {
    return {
      rawXph: 0,
      rawTotal: 0,
      ambiguityRate: 0,
      unresolvedRate: totalDeaths ? 1 : 0,
      matchRate: 0,
      totalDeaths,
      ambiguousDeaths: 0,
      unresolvedDeaths: totalDeaths,
      confident: false,
      lowConfidenceReason: 'no_data',
      globalSummary: '',
      preyShare: 0,
      animusSummary: ''
    };
  }
  // A linha de XP do server log ja indica quando houve active prey bonus.
  // Usamos todos os mobs reconhecidos como candidatos e deixamos a blindagem de
  // ambiguidade decidir quando isso ficou incerto demais para exibir sem aviso.
  const preyEligible = new Set(recognized.map(m => m.name));
  const globals = [1.00, 1.50, 2.25];
  const animusValues = [1.00, 1.02, 1.03, 1.04];
  const tolerance = 0.0075;
  const globalCounts = {};
  const animusCounts = {};
  let rawTotal = 0;
  let matched = 0;
  let ambiguousDeaths = 0;
  let unresolvedDeaths = 0;
  let preyDeaths = 0;

  for (const ev of xpEvents || []) {
    const gained = ev.xp || 0;
    const matches = [];
    for (const mob of recognized) {
      for (const global of globals) {
        const preyBonus = global === 1 ? 0.40 : 0.60;
        const preyOptions = ev.xpHasPrey && preyEligible.has(mob.name) ? [0, preyBonus] : [0];
        for (const prey of preyOptions) {
          for (const animus of animusValues) {
            const expected = mob.raw * (global + prey) * animus;
            const relErr = Math.abs(expected - gained) / Math.max(1, gained);
            if (relErr <= tolerance) {
              matches.push({ mob: mob.name, raw: mob.raw, global, prey, animus, relErr });
            }
          }
        }
      }
    }
    if (!matches.length) {
      unresolvedDeaths++;
      continue;
    }
    matches.sort((a, b) => a.relErr - b.relErr);
    const best = matches[0];
    const distinctMobs = new Set(matches.map(m => m.mob));
    if (distinctMobs.size > 1) ambiguousDeaths++;
    matched++;
    rawTotal += best.raw;
    globalCounts[best.global] = (globalCounts[best.global] || 0) + 1;
    animusCounts[best.animus] = (animusCounts[best.animus] || 0) + 1;
    if (best.prey > 0) preyDeaths++;
  }

  const hours = Math.max(1 / 3600, durationSeconds / 3600);
  const ambiguityRate = totalDeaths ? ambiguousDeaths / totalDeaths : 0;
  const unresolvedRate = totalDeaths ? unresolvedDeaths / totalDeaths : 0;
  const matchRate = totalDeaths ? matched / totalDeaths : 0;
  const dominant = obj => {
    const entries = Object.entries(obj || {}).sort((a, b) => b[1] - a[1]);
    return entries.length ? entries[0][0] : '';
  };
  const confident = ambiguityRate < 0.05 && unresolvedRate < 0.10 && matchRate >= 0.90;
  return {
    rawXph: rawTotal / hours,
    rawTotal,
    ambiguityRate,
    unresolvedRate,
    matchRate,
    totalDeaths,
    ambiguousDeaths,
    unresolvedDeaths,
    confident,
    lowConfidenceReason: !confident ? (ambiguityRate >= 0.05 ? 'ambiguous' : unresolvedRate >= 0.10 ? 'unresolved' : 'weak_match') : '',
    globalSummary: dominant(globalCounts),
    preyShare: matched ? preyDeaths / matched : 0,
    animusSummary: dominant(animusCounts)
  };
}
