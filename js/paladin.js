function splitPaladinDamage(dmgs) {
  if (!dmgs || dmgs.length < 80) {
    return { arrowDmg: 0, spellDmgs: null, confidence: 'none' };
  }
  const s = [...dmgs].sort((a, b) => a - b);
  let lowCenter = s[Math.floor(s.length * 0.35)];
  let highCenter = s[Math.floor(s.length * 0.75)];
  for (let iter = 0; iter < 12; iter++) {
    const low = [], high = [];
    for (const d of dmgs) {
      if (Math.abs(d - lowCenter) <= Math.abs(d - highCenter)) low.push(d);
      else high.push(d);
    }
    if (low.length === 0 || high.length === 0) break;
    lowCenter = mean(low);
    highCenter = mean(high);
  }
  const threshold = (lowCenter + highCenter) / 2;
  const arrowHits = dmgs.filter(d => d <= threshold);
  const spellHits = dmgs.filter(d => d > threshold);
  const hasSplit = arrowHits.length >= 30 && spellHits.length >= 30 && highCenter / Math.max(1, lowCenter) >= 1.15;
  if (!hasSplit) return { arrowDmg: 0, spellDmgs: null, confidence: 'none' };
  return {
    arrowDmg: Math.round(mean(arrowHits)),
    spellDmgs: estimateDamageCycle(spellHits),
    confidence: spellHits.length >= 90 ? 'strong' : 'weak'
  };
}

function splitPaladinDamageByTurnOrder(turns, critMultObserved, preyMult, turnStats = []) {
  const arrowDmgs = [];
  const spellDmgs = [];
  const arrowCounts = [];
  const spellCounts = [];
  let splitTurns = 0;
  let ambiguousTurns = 0;
  const normalize = e => {
    let v = e.dmg;
    if (e.type === 'crit' && critMultObserved > 0) v /= critMultObserved;
    if (e.isPrey && preyMult > 1) v /= preyMult;
    return v;
  };

  for (let idx = 0; idx < turns.length; idx++) {
    const turn = turns[idx];
    const stat = turnStats[idx] || { components: { grenade: 0 }, rpGrenade: null };
    const lines = stat.rpComponentLines || classifyRpTurnComponents(turn, stat, stat.rpGrenade, critMultObserved, preyMult).lines;
    const rotation = lines.filter(l => l.correctedComponent === 'arrow' || l.correctedComponent === 'spell');
    const arrows = rotation.filter(l => l.correctedComponent === 'arrow');
    const spells = rotation.filter(l => l.correctedComponent === 'spell');
    if (arrows.length === 0 || spells.length === 0) {
      ambiguousTurns++;
      continue;
    }
    for (const line of arrows) arrowDmgs.push(Number.isFinite(line.revertedDmg) ? line.revertedDmg : normalize(line));
    for (const line of spells) spellDmgs.push(Number.isFinite(line.revertedDmg) ? line.revertedDmg : normalize(line));
    arrowCounts.push(arrows.length);
    spellCounts.push(spells.length);
    if (lines.some(l => l.correctionReason === 'ambiguous_keep_order')) ambiguousTurns++;
    splitTurns++;
  }

  const hasSplit = arrowDmgs.length >= 30 && spellDmgs.length >= 30 && splitTurns >= 10;
  if (!hasSplit) {
    return { arrowDmg: 0, spellDmgs: null, confidence: 'none', method: 'cluster', arrowHitsMean: 0, spellHitsMean: 0 };
  }
  return {
    arrowDmg: Math.round(mean(arrowDmgs)),
    spellDmgs: estimateDamageCycle(spellDmgs),
    confidence: splitTurns >= 30 && ambiguousTurns <= splitTurns ? 'strong' : 'weak',
    method: 'order',
    arrowHitsMean: mean(arrowCounts),
    spellHitsMean: mean(spellCounts)
  };
}

function estimateDamageCycle(dmgs) {
  // Tenta detectar 3 modas no histograma. Como cada ataque tem variação ±20%,
  // a moda do histograma de cada ataque está perto do dano base.
  if (dmgs.length < 30) {
    // Pouca data: usar quartis como aproximação
    const m = mean(dmgs);
    return [Math.round(m * 0.85), Math.round(m), Math.round(m * 1.15)];
  }
  // Bucket de 25 em 25
  const buckets = {};
  for (const d of dmgs) {
    const b = Math.floor(d / 25) * 25;
    buckets[b] = (buckets[b] || 0) + 1;
  }
  const sorted = Object.entries(buckets)
    .map(([k, v]) => [+k, v])
    .sort((a, b) => a[0] - b[0]);

  // Achar picos locais (com janela de 2 buckets pra cada lado)
  const peaks = [];
  for (let i = 2; i < sorted.length - 2; i++) {
    const v = sorted[i][1];
    if (v >= 15 && v >= sorted[i - 1][1] && v >= sorted[i + 1][1] &&
        v >= sorted[i - 2][1] && v >= sorted[i + 2][1]) {
      peaks.push({ bucket: sorted[i][0], count: v });
    }
  }
  // Pegar top 3 picos
  peaks.sort((a, b) => b.count - a.count);
  const topPeaks = peaks.slice(0, 3).map(p => p.bucket + 12).sort((a, b) => a - b);

  if (topPeaks.length === 3) return topPeaks;

  // Fallback: aproximar com média ± offsets
  const m = Math.round(mean(dmgs));
  return [Math.round(m * 0.85), m, Math.round(m * 1.15)];
}
