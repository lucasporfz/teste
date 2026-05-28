function getMobElementMods(name) {
  return MOB_ELEMENT_MODS[(name || '').toLowerCase().trim()] || null;
}

function normalizeRuneName(name) {
  return (name || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function getRuneElement(name) {
  const rune = normalizeRuneName(name).replace(/\s+rune$/, '');
  if (!rune) return 'unknown';
  if (/avalanche|icicle|great icicle/i.test(rune)) return 'ice';
  if (/great fireball|fireball|fire bomb|fire field|fire wall/i.test(rune)) return 'fire';
  if (/thunderstorm|energy bomb|energy field|energy wall/i.test(rune)) return 'energy';
  if (/stoneshower|earth bomb|earth field|earth wall/i.test(rune)) return 'earth';
  if (/sudden death/i.test(rune)) return 'death';
  if (/holy missile/i.test(rune)) return 'holy';
  return 'unknown';
}

function normalizeSeenDamageForElement(ev, elementKey, critMultObserved, preyMult) {
  const mods = getMobElementMods(ev.mob);
  if (!mods) return null;
  let dmg = ev.dmg || 0;
  if (ev.type === 'crit' && critMultObserved > 0) dmg /= critMultObserved;
  if (ev.isPrey && preyMult > 1) dmg /= preyMult;
  const mod = mods[elementKey] || 1;
  return mod > 0 ? dmg / mod : dmg;
}

function getOrderedRpOffensiveHits(turn) {
  return (turn || [])
    .filter(e => e.type === 'normal' || e.type === 'crit')
    .slice()
    .sort((a, b) => (a.ts - b.ts) || ((a.seq || 0) - (b.seq || 0)));
}

function findRpRuneAnchor(turn, runeEvents) {
  const hits = getOrderedRpOffensiveHits(turn);
  if (!hits.length || !runeEvents || !runeEvents.length) return null;
  const first = hits[0];
  const last = hits[hits.length - 1];
  const firstSeq = first.seq || 0;
  const lastSeq = last.seq || 0;
  const firstTs = first.ts;
  const lastTs = last.ts;
  const candidates = runeEvents
    .filter(e => e && (
      ((e.seq || 0) >= firstSeq && (e.seq || 0) <= lastSeq) ||
      (e.ts >= firstTs && e.ts <= lastTs)
    ))
    .sort((a, b) => ((a.seq || 0) - (b.seq || 0)) || ((a.ts || 0) - (b.ts || 0)));
  if (!candidates.length) return null;
  const rune = candidates[0];
  const runeSeq = rune.seq || 0;
  const firstPostRuneIndex = hits.findIndex(h => (h.seq || 0) > runeSeq);
  const protectedCount = firstPostRuneIndex < 0 ? hits.length : firstPostRuneIndex;
  return {
    seq: runeSeq,
    ts: rune.ts,
    rune: rune.rune || 'unknown',
    element: rune.element || getRuneElement(rune.rune),
    protectedCount
  };
}

function normalizeRpBoundaryDamage(ev, critMultObserved, preyMult) {
  let dmg = ev && ev.dmg ? ev.dmg : 0;
  if (ev && ev.type === 'crit' && critMultObserved > 0) dmg /= critMultObserved;
  if (ev && ev.isPrey && preyMult > 1) dmg /= preyMult;
  return dmg;
}

function resolveRpTurnBoundary(turn, mark, critMultObserved = 0, preyMult = 1, stat = null) {
  const ordered = getOrderedRpOffensiveHits(turn);
  const total = ordered.length;
  if (total === 0) {
    return { ordered, arrowEnd: 0, spellEnd: 0, reason: 'empty_turn', confidence: 'none', normalized: [] };
  }
  if (mark === 'cast') {
    return { ordered, arrowEnd: total, spellEnd: total, reason: 'grenade_cast_arrow_only', confidence: 'strong', normalized: ordered.map(e => normalizeRpBoundaryDamage(e, critMultObserved, preyMult)) };
  }

  const grenadeCount = mark === 'explode'
    ? Math.max(0, Math.min(total, Math.round((stat && stat.components && stat.components.grenade) || 0)))
    : 0;
  const spellEnd = Math.max(0, total - grenadeCount);
  const rotationHits = ordered.slice(0, spellEnd);
  const normalized = ordered.map(e => normalizeRpBoundaryDamage(e, critMultObserved, preyMult));
  const rotationVals = normalized.slice(0, spellEnd).filter(v => Number.isFinite(v) && v > 0);
  if (rotationHits.length < 2 || rotationVals.length < 2) {
    return { ordered, arrowEnd: spellEnd, spellEnd, reason: 'order_fallback', confidence: 'weak', normalized };
  }

  const minGroup = spellEnd >= 8 ? Math.max(2, Math.floor(spellEnd * 0.25)) : 1;
  let best = null;
  for (let b = minGroup; b <= spellEnd - minGroup; b++) {
    const left = normalized.slice(0, b).filter(v => Number.isFinite(v) && v > 0);
    const right = normalized.slice(b, spellEnd).filter(v => Number.isFinite(v) && v > 0);
    if (!left.length || !right.length) continue;
    const leftCenter = median(left) || 0;
    const rightCenter = median(right) || 0;
    const leftScale = Math.max(80, Math.abs(leftCenter) * 0.16);
    const rightScale = Math.max(80, Math.abs(rightCenter) * 0.16);
    const leftMad = mean(left.map(v => Math.abs(v - leftCenter))) / leftScale;
    const rightMad = mean(right.map(v => Math.abs(v - rightCenter))) / rightScale;
    const imbalance = Math.abs(b - (spellEnd / 2)) / Math.max(1, spellEnd);
    const score = leftMad + rightMad + imbalance * 0.55;
    if (!best || score < best.score) best = { b, score, leftCenter, rightCenter };
  }

  if (!best) {
    const fallback = Math.max(1, Math.min(spellEnd - 1, Math.round(spellEnd / 2)));
    return { ordered, arrowEnd: fallback, spellEnd, reason: 'order_fallback', confidence: 'weak', normalized };
  }

  const arrowEnd = best.b;
  const arrowCenter = best.leftCenter || 0;
  const spellCenter = best.rightCenter || 0;
  const centerDiff = Math.abs(spellCenter - arrowCenter);
  const clear = arrowCenter && spellCenter && centerDiff >= Math.max(70, Math.max(arrowCenter, spellCenter) * 0.10);
  return {
    ordered,
    arrowEnd,
    spellEnd,
    reason: clear ? 'order_damage_boundary' : 'ambiguous_keep_order',
    confidence: clear ? 'strong' : 'weak',
    normalized
  };
}

function rpSetLineComponent(line, component, reason, layer, inferredElement = null) {
  if (!line || !component) return false;
  const changed = line.correctedComponent !== component;
  line.correctedComponent = component;
  if (!line.beforeComponent) line.beforeComponent = component;
  if (reason) line.correctionReason = reason;
  if (layer) line.layer = layer;
  if (inferredElement) {
    line.inferredElement = inferredElement;
    const key = inferredElement + 'Original';
    line.inferredOriginal = Number.isFinite(line[key]) ? line[key] : null;
  }
  return changed;
}

function rpFindOrderBoundary(lines, rotationEnd) {
  if (rotationEnd < 2) return { arrowEnd: rotationEnd, reason: 'order_fallback', confidence: 'weak' };
  const vals = lines.slice(0, rotationEnd).map(l => l.revertedDmg).filter(v => Number.isFinite(v) && v > 0);
  if (vals.length < 2) return { arrowEnd: Math.max(1, Math.floor(rotationEnd / 2)), reason: 'order_fallback', confidence: 'weak' };
  const minGroup = rotationEnd >= 8 ? Math.max(2, Math.floor(rotationEnd * 0.25)) : 1;
  let best = null;
  for (let b = minGroup; b <= rotationEnd - minGroup; b++) {
    const left = lines.slice(0, b).map(l => l.revertedDmg).filter(v => Number.isFinite(v) && v > 0);
    const right = lines.slice(b, rotationEnd).map(l => l.revertedDmg).filter(v => Number.isFinite(v) && v > 0);
    if (!left.length || !right.length) continue;
    const leftCenter = median(left) || 0;
    const rightCenter = median(right) || 0;
    const leftScale = Math.max(80, Math.abs(leftCenter) * 0.16);
    const rightScale = Math.max(80, Math.abs(rightCenter) * 0.16);
    const leftMad = mean(left.map(v => Math.abs(v - leftCenter))) / leftScale;
    const rightMad = mean(right.map(v => Math.abs(v - rightCenter))) / rightScale;
    const imbalance = Math.abs(b - (rotationEnd / 2)) / Math.max(1, rotationEnd);
    const score = leftMad + rightMad + imbalance * 0.55;
    if (!best || score < best.score) best = { b, score, leftCenter, rightCenter };
  }
  if (!best) return { arrowEnd: Math.max(1, Math.min(rotationEnd - 1, Math.round(rotationEnd / 2))), reason: 'order_fallback', confidence: 'weak' };
  const diff = Math.abs((best.leftCenter || 0) - (best.rightCenter || 0));
  const clear = diff >= Math.max(70, Math.max(best.leftCenter || 0, best.rightCenter || 0) * 0.10);
  return { arrowEnd: best.b, reason: clear ? 'order_damage_boundary' : 'ambiguous_keep_order', confidence: clear ? 'strong' : 'weak' };
}

function rpDetectCritPattern(lines, rotationEnd) {
  const rotation = lines.slice(0, rotationEnd);
  if (rotation.length < 2) return null;
  const critFlags = rotation.map(l => l.type === 'crit');
  const critCount = critFlags.filter(Boolean).length;
  if (critCount === 0 || critCount === rotation.length) return null;
  const firstNonCrit = critFlags.findIndex(v => !v);
  const prefixCrit = firstNonCrit > 0 && critFlags.slice(0, firstNonCrit).every(Boolean) && critFlags.slice(firstNonCrit).every(v => !v);
  if (prefixCrit) return { kind: 'crit_prefix_arrow', arrowEnd: firstNonCrit };
  const firstCrit = critFlags.findIndex(Boolean);
  const suffixCrit = firstCrit > 0 && critFlags.slice(0, firstCrit).every(v => !v) && critFlags.slice(firstCrit).every(Boolean);
  if (suffixCrit) return { kind: 'crit_suffix_spell', arrowEnd: firstCrit };
  return null;
}

function rpFindSameMobSecondBoundary(lines, arrowEnd, rotationEnd, minArrowEnd = 0, secondComponent = 'spell', secondOriginalKey = 'holyOriginal') {
  const spellRefs = new Map();
  for (let i = arrowEnd; i < rotationEnd; i++) {
    const line = lines[i];
    if (!line || line.correctedComponent !== secondComponent || !Number.isFinite(line[secondOriginalKey])) continue;
    const key = line.mob || '';
    if (!spellRefs.has(key)) spellRefs.set(key, []);
    spellRefs.get(key).push(line[secondOriginalKey]);
  }
  const spellCenters = new Map([...spellRefs.entries()].map(([mob, vals]) => [mob, median(vals)]));
  let shiftedArrowEnd = arrowEnd;
  for (let i = Math.max(minArrowEnd, arrowEnd - 3); i < arrowEnd; i++) {
    const line = lines[i];
    if (!line || line.layer === 'crit_pattern') continue;
    const center = spellCenters.get(line.mob || '');
    if (!center || !Number.isFinite(line[secondOriginalKey])) continue;
    const spellDist = Math.abs(line[secondOriginalKey] - center);
    const closeToSpell = spellDist <= Math.max(55, center * 0.09);
    if (closeToSpell) {
      shiftedArrowEnd = Math.min(shiftedArrowEnd, i);
      break;
    }
  }
  if (shiftedArrowEnd !== arrowEnd) return { arrowEnd: shiftedArrowEnd, reason: 'same_mob_boundary_shift', shifted: true };
  return { arrowEnd, reason: '', shifted: false };
}

function rpApplyArrowSecondBlocks(lines, arrowEnd, rotationEnd, secondComponent, secondElement, reason, layer, confidence) {
  const safeArrowEnd = Math.max(0, Math.min(rotationEnd, arrowEnd));
  for (let i = 0; i < rotationEnd; i++) {
    const comp = i < safeArrowEnd ? 'arrow' : secondComponent;
    rpSetLineComponent(
      lines[i],
      comp,
      reason,
      layer,
      comp === 'arrow' ? 'physical' : (secondElement || 'holy')
    );
  }
  for (const line of lines) {
    line.boundaryReason = reason;
    line.boundaryConfidence = confidence || '';
    line.boundaryArrowEnd = safeArrowEnd;
    line.boundarySpellEnd = rotationEnd;
  }
}

function resolveRpSpellGrenadeBoundary(lines, arrowEnd, seedSpellEnd, mark) {
  const total = (lines || []).length;
  const seed = Math.max(0, Math.min(total, seedSpellEnd));
  if (mark !== 'explode' || total < 3) {
    return { spellEnd: total, reason: 'no_grenade', confidence: 'none', fallback: false };
  }
  const minSpellEnd = Math.max(arrowEnd + 1, 1);
  const minGrenadeHits = Math.min(3, Math.max(1, Math.floor(total * 0.12)));
  const critFlags = lines.map(l => l.type === 'crit');

  const firstCrit = critFlags.findIndex(Boolean);
  if (firstCrit >= minSpellEnd && firstCrit <= total - minGrenadeHits) {
    const suffixCrit = critFlags.slice(firstCrit).every(Boolean);
    const beforeHasNonCrit = critFlags.slice(Math.max(0, firstCrit - 5), firstCrit).some(v => !v);
    if (suffixCrit && beforeHasNonCrit) {
      return { spellEnd: firstCrit, reason: 'crit_suffix_grenade', confidence: 'strong', fallback: false };
    }
  }

  for (let b = minSpellEnd + 1; b <= total - minGrenadeHits; b++) {
    const suffixNonCrit = critFlags.slice(b).every(v => !v);
    const previousHasCrit = critFlags.slice(Math.max(arrowEnd, b - 5), b).some(Boolean);
    const earlierHasNonCrit = critFlags.slice(arrowEnd, b).some(v => !v);
    if (suffixNonCrit && previousHasCrit && earlierHasNonCrit) {
      return { spellEnd: b, reason: 'crit_suffix_grenade_inverse', confidence: 'strong', fallback: false };
    }
  }

  if (seed >= minSpellEnd && seed <= total - minGrenadeHits) {
    return { spellEnd: seed, reason: 'grenade_count_anchor', confidence: 'strong', fallback: false };
  }

  let best = null;
  for (let b = minSpellEnd + 1; b <= total - minGrenadeHits; b++) {
    const left = lines.slice(Math.max(arrowEnd, 0), b).map(l => l.holyOriginal).filter(v => Number.isFinite(v) && v > 0);
    const right = lines.slice(b).map(l => l.holyOriginal).filter(v => Number.isFinite(v) && v > 0);
    if (left.length < 2 || right.length < minGrenadeHits) continue;
    const leftCenter = median(left) || 0;
    const rightCenter = median(right) || 0;
    if (rightCenter <= leftCenter) continue;
    const leftSpread = mean(left.map(v => Math.abs(v - leftCenter))) / Math.max(80, leftCenter * 0.12);
    const rightSpread = mean(right.map(v => Math.abs(v - rightCenter))) / Math.max(80, rightCenter * 0.12);
    const seedBias = Math.abs(b - seed) / Math.max(1, total) * 0.20;
    const jump = (rightCenter - leftCenter) / Math.max(1, leftCenter);
    const score = leftSpread + rightSpread + seedBias - jump * 1.5;
    if (!best || score < best.score) best = { b, score, leftCenter, rightCenter, jump };
  }
  if (best) {
    const diff = best.rightCenter - best.leftCenter;
    const clear = best.jump >= 0.10 && diff >= Math.max(60, best.leftCenter * 0.08);
    if (clear) {
      return { spellEnd: best.b, reason: 'holy_damage_grenade_boundary', confidence: 'strong', fallback: false };
    }
  }

  return { spellEnd: seed, reason: 'grenade_boundary_fallback_count', confidence: 'weak', fallback: true };
}

function rpApplyGrenadePositionBlock(lines, rotationEnd, boundaryInfo = null) {
  const lastRotationTs = rotationEnd > 0 ? lines[rotationEnd - 1].ts : null;
  const firstGrenadeTs = lines[rotationEnd] ? lines[rotationEnd].ts : null;
  const hasDelaySpillover = Number.isFinite(lastRotationTs) && Number.isFinite(firstGrenadeTs) && firstGrenadeTs > lastRotationTs;
  const baseReason = boundaryInfo && boundaryInfo.reason ? boundaryInfo.reason : 'grenade_position_block';
  const reason = hasDelaySpillover && baseReason === 'grenade_position_block' ? 'grenade_delay_spillover' : baseReason;
  for (const line of lines) {
    line.boundarySpellEnd = rotationEnd;
    line.grenadeBoundaryReason = reason;
    line.grenadeBoundaryConfidence = boundaryInfo && boundaryInfo.confidence ? boundaryInfo.confidence : '';
  }
  for (let i = rotationEnd; i < lines.length; i++) {
    rpSetLineComponent(lines[i], 'grenade', reason, 'position_block', 'holy');
  }
  return { ambiguous: 0, delaySpillover: hasDelaySpillover };
}

function classifyRpTurnComponents(turn, stat, mark, critMultObserved = 0, preyMult = 1, runeEvents = []) {
  const ordered = getOrderedRpOffensiveHits(turn);
  const total = ordered.length;
  const runeAnchor = findRpRuneAnchor(turn, runeEvents);
  const turnKind = runeAnchor ? 'rune' : 'spell';
  const turnConflict = runeAnchor && mark === 'explode' ? 'explode_with_rune' : '';
  const canExplode = mark === 'explode' && !runeAnchor;
  const secondComponent = turnKind === 'rune' ? 'rune' : 'spell';
  const secondElement = turnKind === 'rune' ? (runeAnchor.element || 'unknown') : 'holy';
  const secondOriginalKey = secondElement && secondElement !== 'unknown' ? secondElement + 'Original' : 'holyOriginal';
  const grenadeCount = canExplode
    ? Math.max(0, Math.min(total, Math.round((stat && stat.components && stat.components.grenade) || 0)))
    : 0;
  const seedSpellEnd = canExplode ? Math.max(0, total - grenadeCount) : total;
  const diag = { ambiguous: 0, missingMod: 0, total, turnKind, turnConflict };
  const lines = ordered.map((e, idx) => {
    const ev = { mob: e.mob, dmg: e.dmg, type: e.type, isPrey: e.isPrey };
    const mods = getMobElementMods(e.mob);
    let revertedDmg = normalizeRpBoundaryDamage(e, critMultObserved, preyMult);
    const component = canExplode && idx >= seedSpellEnd ? 'grenade' : secondComponent;
    const line = {
      component,
      correctedComponent: component,
      beforeComponent: component,
      reason: mark === 'cast' ? 'cast' : (component === 'grenade' ? 'explode' : 'order'),
      correctionReason: 'unclassified',
      boundaryReason: '',
      boundaryConfidence: '',
      boundaryArrowEnd: 0,
      boundarySpellEnd: seedSpellEnd,
      boundaryNormalized: revertedDmg,
      layer: 'unclassified',
      ts: e.ts,
      seq: e.seq || 0,
      mob: e.mob,
      dmg: e.dmg,
      seenDmg: e.dmg,
      revertedDmg,
      type: e.type,
      isPrey: !!e.isPrey,
      physicalOriginal: mods ? normalizeSeenDamageForElement(ev, 'physicalDmgMod', critMultObserved, preyMult) : null,
      holyOriginal: mods ? normalizeSeenDamageForElement(ev, 'holyDmgMod', critMultObserved, preyMult) : null,
      fireOriginal: mods ? normalizeSeenDamageForElement(ev, 'fireDmgMod', critMultObserved, preyMult) : null,
      iceOriginal: mods ? normalizeSeenDamageForElement(ev, 'iceDmgMod', critMultObserved, preyMult) : null,
      energyOriginal: mods ? normalizeSeenDamageForElement(ev, 'energyDmgMod', critMultObserved, preyMult) : null,
      earthOriginal: mods ? normalizeSeenDamageForElement(ev, 'earthDmgMod', critMultObserved, preyMult) : null,
      deathOriginal: mods ? normalizeSeenDamageForElement(ev, 'deathDmgMod', critMultObserved, preyMult) : null,
      inferredElement: component === 'grenade' ? 'holy' : (component === 'arrow' ? 'physical' : secondElement),
      turnKind,
      secondComponent,
      secondElement,
      turnConflict
    };
    line.secondOriginal = Number.isFinite(line[secondOriginalKey]) ? line[secondOriginalKey] : null;
    if (runeAnchor) {
      line.rune = runeAnchor.rune;
      line.runeElement = runeAnchor.element;
      line.runeAnchorSeq = runeAnchor.seq;
    }
    if (!mods) {
      line.correctionReason = 'missing_mod';
      diag.missingMod++;
    }
    return line;
  });
  if (!lines.length) return { lines, diag };

  if (mark === 'cast') {
    for (const line of lines) rpSetLineComponent(line, 'arrow', 'grenade_cast_arrow_only', 'crit_pattern', 'physical');
    return { lines, diag };
  }

  let spellEnd = seedSpellEnd;
  const minArrowEnd = runeAnchor ? Math.min(spellEnd, runeAnchor.protectedCount || 0) : 0;
  const critPattern = rpDetectCritPattern(lines, spellEnd);
  let arrowEnd = 0;
  let boundaryReason = 'order_fallback';
  let boundaryConfidence = 'weak';
  let needsSameMobSpellMatch = false;
  if (runeAnchor) {
    arrowEnd = minArrowEnd;
    boundaryReason = 'rune_turn_boundary';
    boundaryConfidence = 'strong';
    rpApplyArrowSecondBlocks(lines, arrowEnd, spellEnd, secondComponent, secondElement, boundaryReason, 'rune_turn', boundaryConfidence);
  } else if (critPattern) {
    arrowEnd = Math.max(critPattern.arrowEnd, minArrowEnd);
    boundaryReason = critPattern.kind;
    boundaryConfidence = 'strong';
    rpApplyArrowSecondBlocks(lines, arrowEnd, spellEnd, secondComponent, secondElement, critPattern.kind, 'crit_pattern', boundaryConfidence);
  } else {
    const boundary = rpFindOrderBoundary(lines, spellEnd);
    arrowEnd = Math.max(boundary.arrowEnd, minArrowEnd);
    boundaryReason = boundary.reason === 'order_damage_boundary' ? 'crit_not_discriminating' : boundary.reason;
    boundaryConfidence = boundary.confidence;
    rpApplyArrowSecondBlocks(lines, arrowEnd, spellEnd, secondComponent, secondElement, boundaryReason, 'damage_local', boundaryConfidence);
    needsSameMobSpellMatch = true;
  }

  for (let i = spellEnd; i < total; i++) {
    rpSetLineComponent(lines[i], 'grenade', 'grenade_residual_order', 'damage_local', 'holy');
  }
  for (const line of lines) line.beforeComponent = line.correctedComponent;
  if (needsSameMobSpellMatch) {
    const adjusted = rpFindSameMobSecondBoundary(lines, arrowEnd, spellEnd, minArrowEnd, secondComponent, secondOriginalKey);
    if (adjusted.shifted) {
      arrowEnd = Math.max(adjusted.arrowEnd, minArrowEnd);
      boundaryReason = adjusted.reason;
      boundaryConfidence = 'strong';
      rpApplyArrowSecondBlocks(lines, arrowEnd, spellEnd, secondComponent, secondElement, boundaryReason, 'damage_local', boundaryConfidence);
    }
  }

  const grenadeBoundary = resolveRpSpellGrenadeBoundary(lines, arrowEnd, seedSpellEnd, canExplode ? mark : null);
  if (canExplode) {
    spellEnd = grenadeBoundary.spellEnd;
    rpApplyArrowSecondBlocks(lines, arrowEnd, spellEnd, secondComponent, secondElement, boundaryReason, boundaryConfidence === 'strong' && critPattern ? 'crit_pattern' : 'damage_local', boundaryConfidence);
  }

  if (canExplode) {
    const grenadeDiag = rpApplyGrenadePositionBlock(lines, spellEnd, grenadeBoundary);
    diag.ambiguous += grenadeDiag.ambiguous || 0;
  } else if (turnConflict) {
    for (const line of lines) {
      line.grenadeBoundaryReason = turnConflict;
      line.grenadeBoundaryConfidence = 'conflict';
    }
  }

  for (const line of lines) {
    if (line.correctionReason === 'ambiguous_keep_order' || line.correctionReason === 'ambiguous_centers' || line.correctionReason === 'ambiguous_distance') {
      diag.ambiguous++;
    }
  }
  return { lines, diag };
}

function buildRpClassifiedLines(turn, stat, mark, critMultObserved = 0, preyMult = 1) {
  return classifyRpTurnComponents(turn, stat, mark, critMultObserved, preyMult).lines;
}

function correctRpComponentsByElement(turns, turnStats, runeEvents, critMultObserved, preyMult) {
  const diag = {
    retagged: 0, ambiguous: 0, missingMod: 0, total: 0,
    grenadeBoundaryReasons: {}, runeElements: {},
    turnTypes: { spell: 0, rune: 0, explode: 0 },
    turnConflicts: { explode_with_rune: 0 }
  };
  const sortedRuneEvents = (runeEvents || []).slice().sort((a, b) => ((a.seq || 0) - (b.seq || 0)) || ((a.ts || 0) - (b.ts || 0)));
  for (const ev of sortedRuneEvents) {
    const key = (ev.rune || 'unknown') + ':' + (ev.element || 'unknown');
    diag.runeElements[key] = (diag.runeElements[key] || 0) + 1;
  }
  for (let idx = 0; idx < turnStats.length; idx++) {
    const stat = turnStats[idx];
    const classified = classifyRpTurnComponents(turns[idx], stat, stat.rpGrenade, critMultObserved, preyMult, sortedRuneEvents);
    const lines = classified.lines;
    stat.rpComponentLines = lines;
    stat.rpTurnKind = classified.diag.turnKind || 'spell';
    stat.rpTurnConflict = classified.diag.turnConflict || '';
    diag.ambiguous += classified.diag.ambiguous || 0;
    diag.missingMod += classified.diag.missingMod || 0;
    diag.total += classified.diag.total || 0;
    diag.turnTypes[stat.rpTurnKind] = (diag.turnTypes[stat.rpTurnKind] || 0) + 1;
    if (stat.rpGrenade === 'explode' && !stat.rpTurnConflict) diag.turnTypes.explode = (diag.turnTypes.explode || 0) + 1;
    if (stat.rpTurnConflict) diag.turnConflicts[stat.rpTurnConflict] = (diag.turnConflicts[stat.rpTurnConflict] || 0) + 1;
    const corrected = { arrow: 0, spell: 0, rune: 0, grenade: 0 };
    for (const line of lines) {
      if (line.correctedComponent === 'arrow') corrected.arrow++;
      else if (line.correctedComponent === 'grenade') corrected.grenade++;
      else if (line.correctedComponent === 'rune') corrected.rune++;
      else corrected.spell++;
      if (line.correctedComponent !== line.beforeComponent) diag.retagged++;
    }
    if (stat.rpGrenade === 'explode') {
      const grenadeLine = lines.find(l => l.correctedComponent === 'grenade');
      const reason = (grenadeLine && grenadeLine.correctionReason) || 'none';
      diag.grenadeBoundaryReasons[reason] = (diag.grenadeBoundaryReasons[reason] || 0) + 1;
    }
    stat.components = corrected;
  }
  return diag;
}

function rpCollectMonotonicViolations(turnStats) {
  const rank = { arrow: 0, spell: 1, rune: 1, grenade: 2 };
  const violations = [];
  for (let idx = 0; idx < (turnStats || []).length; idx++) {
    const lines = turnStats[idx] && turnStats[idx].rpComponentLines;
    if (!lines || !lines.length) continue;
    let last = -1;
    for (let i = 0; i < lines.length; i++) {
      const component = lines[i].correctedComponent || 'spell';
      const value = Object.prototype.hasOwnProperty.call(rank, component) ? rank[component] : 1;
      if (value < last) {
        violations.push({
          turn: idx + 1,
          index: i,
          prev: lines[i - 1] ? lines[i - 1].correctedComponent : '',
          current: component
        });
        break;
      }
      last = value;
    }
  }
  return {
    count: violations.length,
    violations
  };
}

