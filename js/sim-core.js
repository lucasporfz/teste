function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return function() {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function resolveAoeCoverage(aliveLen, flags, aoeHitSamples, rng, coverageMode, aoeBoxP90, exitThreshold, aoeCoverage) {
  if (coverageMode === 'screen_ratio') {
    const coverage = Math.max(0.05, Math.min(1, aoeCoverage || 1));
    const jitter = rng() - 0.5;
    return Math.max(0, Math.min(aliveLen, Math.round(aliveLen * coverage + jitter)));
  }
  if (coverageMode === 'none' || !aoeHitSamples || aoeHitSamples.length === 0) {
    return aliveLen;
  }

  const p90 = Math.max(1, Math.round(aoeBoxP90 || 0));
  let hits = Math.max(0, Math.min(aliveLen, Math.round(aoeHitSamples[Math.floor(rng() * aoeHitSamples.length)] || 0)));

  if (p90 > 0 && aliveLen >= p90 && hits === p90 - 1 && rng() < 0.7) {
    hits = Math.min(aliveLen, p90);
  }

  if (coverageMode === 'hybrid') {
    let minDamage = hits;
    if (p90 > 0 && aliveLen >= p90) minDamage = Math.ceil(aliveLen * 0.9);
    else if (aliveLen > exitThreshold) minDamage = Math.ceil(aliveLen * 0.8);
    return Math.max(hits, Math.min(aliveLen, minDamage));
  }

  return hits;
}

function shuffleAoeTargets(aliveHp, aliveLen, aoeHits, rng) {
  if (aoeHits <= 0 || aoeHits >= aliveLen) return;
  for (let i = 0; i < aoeHits; i++) {
    const j = i + Math.floor(rng() * (aliveLen - i));
    const tmp = aliveHp[i];
    aliveHp[i] = aliveHp[j];
    aliveHp[j] = tmp;
  }
}
