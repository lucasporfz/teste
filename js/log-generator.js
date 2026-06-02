// Esta função reimplementa a lógica da simulação, mas em vez de descartar os
// eventos turno-a-turno, registra cada um com detalhe completo. Permite que
// qualquer pessoa audite turno por turno o que está acontecendo na simulação.
//
// IMPORTANTE: usa a MESMA PRNG e a MESMA ordem de consumo de números aleatórios
// que a simulação principal — então os mesmos parâmetros + mesma seed produzem
// resultado idêntico. Isso é o que torna o log "reproduzível".

let lastLogData = null; // pra exportar como CSV

function buildLogInputFromConfig(config) {
  const cfg = config || {};
  const critMult = cfg.critMult || CRIT_BASE;
  return {
    baseDmgs: cfg.baseDmgs || [+$('dmg1').value || 500, +$('dmg2').value || 600, +$('dmg3').value || 1000],
    charmDmg: cfg.charmDmg || (+$('charmDmg').value || 500),
    autoDmg: cfg.autoDmg || 0,
    reflectDmg: cfg.reflectDmg || 0,
    paladinArrowDmg: cfg.paladinArrowDmg || 0,
    aoeHitSamples: cfg.aoeHitSamples || [],
    coverageMode: cfg.coverageMode || 'none',
    aoeBoxP90: cfg.aoeBoxP90 || 0,
    aoeCoverage: cfg.aoeCoverage || 1,
    boxVariance: cfg.boxVariance || 0,
    paladinArrowCoverage: cfg.paladinArrowCoverage || 1,
    paladinSpellCoverage: cfg.paladinSpellCoverage || 1,
    paladinRuneCoverage: cfg.paladinRuneCoverage || 1,
    rpGrenadeMode: !!cfg.rpGrenadeMode,
    mageUeMode: !!cfg.mageUeMode,
    rpGrenadeDmg: cfg.rpGrenadeDmg || 0,
    rpGrenadeDelaySeconds: cfg.rpGrenadeDelaySeconds || 3,
    rpGrenadeIntervalSeconds: cfg.rpGrenadeIntervalSeconds || 24,
    rpRuneStartWithRune: cfg.rpRuneStartWithRune !== false,
    rpRuneShare: cfg.rpRuneShare || 0,
    rpRuneAfterRune: cfg.rpRuneAfterRune || 0,
    rpRuneAfterSpell: cfg.rpRuneAfterSpell || 0,
    rpSpellDmgSim: cfg.rpSpellDmgSim || 0,
    rpRuneDmgSim: cfg.rpRuneDmgSim || 0,
    mageUeDmg: cfg.mageUeDmg || 0,
    mageUeIntervalSeconds: cfg.mageUeIntervalSeconds || 50,
    mageUeLockoutSeconds: cfg.mageUeLockoutSeconds || 4,
    spawnCurve: cfg.spawnCurve || 2.0,
    critBoost: Math.round((critMult - CRIT_BASE) * 100),
    mobHp: cfg.mobHp || (+$('mobHp').value || 8000),
    mobXp: cfg.mobXp || (+$('mobXp').value || 10000),
    boxSize: Math.max(0.1, parseFloat(cfg.boxSize != null ? cfg.boxSize : $('boxSize').value) || 8),
    exitThreshold: Math.max(1, +(cfg.exitThreshold != null ? cfg.exitThreshold : $('exitThreshold').value) || 3),
    boxChangeTime: Math.max(0, parseFloat(cfg.boxChangeTime != null ? cfg.boxChangeTime : $('boxTime').value) || 6)
  };
}

function generateHuntLog(level, maxTurns, seed, explicitConfig = null) {
  const inp = explicitConfig ? buildLogInputFromConfig(explicitConfig) : getInputs();
  const flags = explicitConfig
    ? { ...explicitConfig.flags, rpGrenadeMode: !!explicitConfig.rpGrenadeMode, mageUeMode: !!explicitConfig.mageUeMode }
    : getFlags();
  const critMult = explicitConfig ? (explicitConfig.critMult || CRIT_BASE) : (flags.crit ? CRIT_BASE + inp.critBoost / 100 : CRIT_BASE);
  const startMode = explicitConfig && explicitConfig.startMode ? explicitConfig.startMode : 'fresh';
  const intelSpawnModel = explicitConfig && explicitConfig.intelSpawnModel ? explicitConfig.intelSpawnModel : 'timed';

  const CHARM_RATE = 0.1, CRIT_RATE = 0.1, TURN_DURATION = 2.25;
  const POST_WALK_TURNS = 3, POST_WALK_CURVE = 2.2, UE_COOLDOWN_SECONDS = 4;
  const RP_GRENADE_DELAY_SECONDS = 3, RP_GRENADE_DEFAULT_INTERVAL_SECONDS = 24, MAGE_UE_DEFAULT_INTERVAL_SECONDS = 50;
  const POST_WALK_WAVE_PCTS = [0, 0.30, 0.65, 1.00];
  const dmgs = [
    inp.baseDmgs[0] + level,
    inp.baseDmgs[1] + level,
    inp.baseDmgs[2] + level
  ];

  // PRNG idêntica à do worker
  let s = (seed >>> 0) || 1;
  function rng() {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  }

  const boxFloor = Math.floor(inp.boxSize);
  const boxFrac = inp.boxSize - boxFloor;
  const boxVarianceInt = Math.max(0, Math.round(inp.boxVariance || 0));
  const rpCycleActive = (flags.paladin || flags.mage) && !!flags.rpCycleMode && (flags.rpCycleMobBudget || 0) > 0;
  const flowSpawnActive = intelSpawnModel === 'flow_no_time' && (flags.intel || flags.ekFlowMode);
  const flowRefillThreshold = flags.ekFlowMode ? Math.max(inp.exitThreshold, Math.min(Math.round(inp.boxSize), Math.round(+(flags.ekFlowRefillThreshold || inp.exitThreshold)))) : inp.exitThreshold;
  const rpCyclePeak = Math.max(1, Math.round(flags.rpCyclePeakBoxSize || inp.boxSize));
  function rollBoxSize() {
    if (boxFrac !== 0) return rng() < boxFrac ? boxFloor + 1 : boxFloor;
    if (boxVarianceInt <= 0) return boxFloor;
    const a = Math.floor(rng() * (boxVarianceInt + 1));
    const b = Math.floor(rng() * (boxVarianceInt + 1));
    return Math.max(1, boxFloor + a - b);
  }
  function rollCycleBudget() {
    const rawBudget = Math.max(rpCyclePeak, +(flags.rpCycleMobBudget || rpCyclePeak));
    const visibleShare = flags.rpLatentBudgetMode ? Math.max(0.45, Math.min(1, +(flags.rpVisibleBudgetShare || 0.72))) : 1;
    const budget = Math.max(rpCyclePeak, rpCyclePeak + (rawBudget - rpCyclePeak) * visibleShare);
    const floor = Math.floor(budget), frac = budget - floor;
    return Math.max(rpCyclePeak, floor + (rng() < frac ? 1 : 0));
  }

  function pPresent(elapsed, spawnDuration, curve = inp.spawnCurve || 2.0) {
    if (elapsed <= 0) return 0;
    if (elapsed >= spawnDuration) return 1;
    return 1 - Math.pow(1 - elapsed / spawnDuration, curve);
  }
  function pPostWalkWave(step) {
    return POST_WALK_WAVE_PCTS[Math.min(Math.max(0, step), POST_WALK_WAVE_PCTS.length - 1)];
  }

  function resolveLogAoeHits(aliveLen) {
    // Spell/runa (mistura): nº de hits = FRAÇÃO de cobertura observada do componente sobre os
    // mobs vivos (screen_ratio), em qualquer coverageMode — não mais replay da série do log.
    if (inp._useComponentCoverage) {
      const coverage = Math.max(0.05, Math.min(1, inp._currentComponentCoverage || 1));
      return Math.max(0, Math.min(aliveLen, Math.round(aliveLen * coverage + (rng() - 0.5))));
    }
    if (inp.coverageMode === 'rp_split') {
      const coverage = Math.max(0.05, Math.min(1, inp._currentComponentCoverage || 1));
      return Math.max(0, Math.min(aliveLen, Math.round(aliveLen * coverage + (rng() - 0.5))));
    }
    if (inp.coverageMode === 'screen_ratio') {
      const coverage = Math.max(0.05, Math.min(1, inp.aoeCoverage || 1));
      return Math.max(0, Math.min(aliveLen, Math.round(aliveLen * coverage + (rng() - 0.5))));
    }
    if (inp.coverageMode === 'none' || !inp.aoeHitSamples || inp.aoeHitSamples.length === 0) {
      return aliveLen;
    }
    const p90 = Math.max(1, Math.round(inp.aoeBoxP90 || 0));
    let hits = Math.max(0, Math.min(aliveLen, Math.round(inp.aoeHitSamples[Math.floor(rng() * inp.aoeHitSamples.length)] || 0)));
    if (p90 > 0 && aliveLen >= p90 && hits === p90 - 1 && rng() < 0.7) hits = Math.min(aliveLen, p90);
    if (inp.coverageMode === 'hybrid') {
      let minDamage = hits;
      if (p90 > 0 && aliveLen >= p90) minDamage = Math.ceil(aliveLen * 0.9);
      else if (aliveLen > inp.exitThreshold) minDamage = Math.ceil(aliveLen * 0.8);
      return Math.max(hits, Math.min(aliveLen, minDamage));
    }
    return hits;
  }

  function shuffleTargets(arr, hits) {
    if (hits <= 0 || hits >= arr.length) return;
    for (let i = 0; i < hits; i++) {
      const j = i + Math.floor(rng() * (arr.length - i));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
  }

  function compactDead() {
    let kills = 0;
    const next = [];
    for (const hp of mobHps) {
      if (hp <= 0) {
        kills++;
        totalKills++;
      } else {
        next.push(hp);
      }
    }
    mobHps = next;
    return kills;
  }

  function rollReflectDamage() {
    if (!inp.reflectDmg || mobHps.length === 0 || flags.paladin || flags.mage) {
      return null;
    }
    const hits = mobHps.length;
    for (let i = 0; i < mobHps.length; i++) {
      if (mobHps[i] > 0) mobHps[i] -= inp.reflectDmg;
    }
    const kills = compactDead();
    return { label: 'reflect', baseDmg: inp.reflectDmg, varMul: 1, isCrit: false, finalDmg: inp.reflectDmg, hits, kills };
  }

  function rollAttack(label, baseDmg, aoe, rolled = true) {
    if (mobHps.length === 0) {
      return { label, baseDmg, varMul: 1, isCrit: false, finalDmg: 0, hits: 0, kills: 0 };
    }
    let varMul = 1;
    if (rolled && flags.var) varMul = 0.8 + rng() * 0.4;
    const isCrit = rolled && rng() < CRIT_RATE;
    const critMul = isCrit ? critMult : 1;
    const finalDmg = baseDmg * varMul * critMul;
    const residualHits = label === 'grenade' ? resolveRpGrenadeResidualHits(mobHps.length, flags, rng) : null;
    const hits = residualHits != null ? residualHits : (aoe ? resolveLogAoeHits(mobHps.length) : 1);
    shuffleTargets(mobHps, hits);
    for (let i = 0; i < mobHps.length; i++) {
      if (mobHps[i] > 0 && i < hits) mobHps[i] -= finalDmg;
    }
    const kills = compactDead();
    return { label, baseDmg, varMul, isCrit, finalDmg, hits, kills };
  }

  function rollAutoAttack() {
    if (mobHps.length === 0) {
      return { component: { label: 'auto', baseDmg: inp.autoDmg, varMul: 1, isCrit: false, finalDmg: 0, hits: 0, kills: 0 }, charm: { hits: [], kills: 0 } };
    }
    const target = Math.floor(rng() * mobHps.length);
    const charm = { hits: [], kills: 0 };
    if (flags.charm && mobHps[target] > 0 && rng() < CHARM_RATE) {
      mobHps[target] -= inp.charmDmg;
      if (mobHps[target] < 0) mobHps[target] = 0;
      charm.hits.push({ idx: target, dmg: inp.charmDmg, source: 'auto' });
      if (mobHps[target] <= 0) {
        charm.kills = compactDead();
        return { component: { label: 'auto', baseDmg: inp.autoDmg, varMul: 1, isCrit: false, finalDmg: 0, hits: 1, kills: 0 }, charm };
      }
    }
    let varMul = 1;
    if (flags.var) varMul = 0.8 + rng() * 0.4;
    const isCrit = rng() < CRIT_RATE;
    const critMul = isCrit ? critMult : 1;
    const finalDmg = inp.autoDmg * varMul * critMul;
    if (mobHps[target] > 0) mobHps[target] -= finalDmg;
    const kills = compactDead();
    return { component: { label: 'auto', baseDmg: inp.autoDmg, varMul, isCrit, finalDmg, hits: 1, kills }, charm };
  }

  function rollCharm(label) {
    const hits = [];
    if (!flags.charm) return { hits, kills: 0 };
    for (let i = 0; i < mobHps.length; i++) {
      if (mobHps[i] > 0 && rng() < CHARM_RATE) {
        mobHps[i] -= inp.charmDmg;
        if (mobHps[i] < 0) mobHps[i] = 0;
        hits.push({ idx: i, dmg: inp.charmDmg, source: label });
      }
    }
    return { hits, kills: compactDead() };
  }

  // Estado mutável
  let mobHps = []; // mobs vivos atualmente atacáveis
  let spawning = []; // mobs em transição (chegando)
  let rpCyclePending = 0;
  let spawnTimer = 0;
  let timeElapsed = 0;
  let ac = 0;
  let totalKills = 0;
  let boxNum = 1;
  let turnsThisBox = 0;
  let boxesCompleted = 0;
  let cooldownRemaining = 0;
  let pendingGrenade = 0;
  let pendingGrenadeTurns = 0;
  let rpSecondTurnIndex = inp.rpRuneStartWithRune ? 0 : 1;
  let prevRpRuneTurn = null; // cadeia de Markov rune/spell: componente mágico do turno anterior
  const grenadeInterval = Math.max(14, inp.rpGrenadeIntervalSeconds || RP_GRENADE_DEFAULT_INTERVAL_SECONDS);
  const grenadeBaseDmg = inp.rpGrenadeDmg ? inp.rpGrenadeDmg + level : Math.max(...dmgs);
  const ueInterval = Math.max(36, inp.mageUeIntervalSeconds || MAGE_UE_DEFAULT_INTERVAL_SECONDS);
  const ueBaseDmg = inp.mageUeDmg ? inp.mageUeDmg + level : Math.max(...dmgs);
  const ueLockout = Math.max(0, inp.mageUeLockoutSeconds || UE_COOLDOWN_SECONDS);
  const rpSpecialEnabled = flags.paladin && !!flags.rpGrenadeMode && inp.paladinArrowDmg > 0;
  const mageSpecialEnabled = flags.mage && !!flags.mageUeMode;
  let nextGrenadeAt = rpSpecialEnabled ? rng() * grenadeInterval : Infinity;
  let grenadeReadySince = Infinity, grenadeHeldTurns = 0, recentReachablePeak = 0, lastGrenadeReachable = 0;
  let nextUeAt = mageSpecialEnabled ? rng() * ueInterval : Infinity;
  const specialCastThreshold = Math.max(1, Math.round(inp.aoeBoxP90 || inp.boxSize));

  const rpCycleTime = Math.max(TURN_DURATION, +(flags.rpCycleTime || grenadeInterval || inp.boxChangeTime));
  const firstBudget = rpCycleActive ? rollCycleBudget() : 0;
  const firstN = rpCycleActive ? Math.min(rpCyclePeak, firstBudget) : rollBoxSize();
  for (let i = 0; i < firstN; i++) mobHps.push(inp.mobHp);
  let rpCycleStartAt = 0;
  let rpCycleCurrentBudget = firstBudget;
  let rpCycleReleased = rpCycleActive ? firstN : 0;
  const rpCyclePendingCap = Math.max(rpCyclePeak, Math.ceil((flags.rpCycleMobBudget || rpCyclePeak) * 2.5 + rpCyclePeak));
  const rpCycleProgress = elapsed => {
    if (!rpCycleActive || elapsed <= 0) return 0;
    const rawBudget = Math.max(rpCyclePeak, +(flags.rpCycleMobBudget || rpCyclePeak));
    const visibleShare = flags.rpLatentBudgetMode ? Math.max(0.45, Math.min(1, +(flags.rpVisibleBudgetShare || 0.72))) : 1;
    const budget = Math.max(rpCyclePeak, rpCyclePeak + (rawBudget - rpCyclePeak) * visibleShare);
    if (flags.rpCyclePulseMode || flags.rpCycleUseLogCadence) {
      const pulseCount = Math.max(2, Math.min(8, Math.round(+(flags.rpCyclePulseCount || 3))));
      const pulseGap = Math.max(TURN_DURATION, +(flags.rpCyclePulseGap || (rpCycleTime / Math.max(1, pulseCount))));
      const fillTime = Math.max(TURN_DURATION, +(flags.rpCycleFillTime || inp.boxChangeTime || TURN_DURATION));
      const pulseStart = Math.max(TURN_DURATION, Math.min(fillTime, pulseGap));
      const firstShare = Math.min(0.55, Math.max(0.30, rpCyclePeak / Math.max(1, budget)));
      let released = elapsed >= fillTime ? firstShare : firstShare * (1 - Math.pow(1 - elapsed / fillTime, 2.4));
      const tailShare = Math.max(0, 1 - firstShare);
      let pulseWeight = 0;
      for (let i = 1; i < pulseCount; i++) {
        const start = Math.min(rpCycleTime - TURN_DURATION, pulseStart + (i - 1) * pulseGap);
        if (elapsed <= start) continue;
        const local = Math.min(1, (elapsed - start) / Math.max(TURN_DURATION, pulseGap * 0.65));
        pulseWeight += 1 - Math.pow(1 - local, flags.rpCycleUseLogCadence ? 1.8 : 1.25);
      }
      released += tailShare * Math.min(1, pulseWeight / Math.max(1, pulseCount - 1));
      return Math.max(0, Math.min(1, released));
    }
    const earlyShare = Math.min(flags.rpCycleTwoPhase ? 0.82 : 0.92, rpCyclePeak / budget);
    const earlyPow = flags.rpCycleTwoPhase ? 3.0 : 2.2;
    const tailPow = flags.rpCycleTwoPhase ? 0.70 : 1.25;
    const fillTime = Math.max(TURN_DURATION, +(flags.rpCycleFillTime || inp.boxChangeTime || TURN_DURATION));
    if (elapsed < fillTime) return earlyShare * (1 - Math.pow(1 - elapsed / fillTime, earlyPow));
    if (elapsed >= rpCycleTime) return 1;
    const t = (elapsed - fillTime) / Math.max(TURN_DURATION, rpCycleTime - fillTime);
    return earlyShare + (1 - earlyShare) * (1 - Math.pow(1 - t, tailPow));
  };
  const rpCycleAdmission = alive => !rpCycleActive || alive < rpCyclePeak ? 1 : Math.max(0.06, 0.28 - Math.max(0, alive - rpCyclePeak) * 0.07);
  const addRpCyclePending = count => {
    if (count <= 0) return;
    rpCyclePending = Math.min(rpCyclePendingCap, rpCyclePending + count);
  };
  const startRpCycle = (startAt, budget, immediatePeak) => {
    rpCycleStartAt = startAt;
    rpCycleCurrentBudget = Math.max(rpCyclePeak, budget || rpCyclePeak);
    rpCycleReleased = 0;
    if (immediatePeak) {
      const immediate = Math.min(rpCyclePeak, rpCycleCurrentBudget);
      for (let i = 0; i < immediate; i++) mobHps.push(inp.mobHp);
      rpCycleReleased = immediate;
    }
  };
  if (startMode === 'warm' && mobHps.length > 0) {
    const keep = Math.max(1, Math.min(mobHps.length, Math.round(inp.exitThreshold + rng() * Math.max(1, mobHps.length - inp.exitThreshold))));
    const warmIntensity = Math.max(0, Math.min(1, +(flags.warmCarryoverIntensity || 0)));
    const hpMin = Math.max(0.05, 0.18 - warmIntensity * 0.10);
    const hpMax = Math.max(hpMin + 0.08, 1 - warmIntensity * 0.45);
    mobHps = mobHps.slice(0, keep).map(() => Math.max(1, inp.mobHp * (hpMin + rng() * (hpMax - hpMin))));
  }

  // Eventos coletados (cada turno gera 1 entrada)
  const events = [];
  let rpCycleNextAt = rpCycleActive ? rpCycleTime : 0;
  const admitRpCycleArrivals = newlyArrived => {
    if (!rpCycleActive) return;
    const elapsed = Math.max(0, timeElapsed - rpCycleStartAt);
    const targetReleased = Math.min(rpCycleCurrentBudget, rpCycleCurrentBudget * rpCycleProgress(elapsed));
    const due = targetReleased - rpCycleReleased;
    if (due > 0) {
      let add = Math.floor(due);
      if (rng() < due - add) add++;
      if (add > 0) {
        addRpCyclePending(add);
        rpCycleReleased = Math.min(rpCycleCurrentBudget, rpCycleReleased + add);
      }
    }
    if (rpCyclePending <= 0) return;
    const pressure = rpCyclePending * rpCycleAdmission(mobHps.length);
    let arriving = Math.floor(pressure);
    if (rng() < pressure - arriving) arriving++;
    const maxArrivalsPerTurn = mobHps.length <= rpCyclePeak - 4 ? 3 : 2;
    arriving = Math.min(arriving, rpCyclePending, maxArrivalsPerTurn);
    for (let i = 0; i < arriving; i++) {
      mobHps.push(inp.mobHp);
      newlyArrived.push(inp.mobHp);
    }
    rpCyclePending -= arriving;
  };
  const ekProbBoxTime = !!(flags.ekProbabilisticBoxTime && !flags.intel && !flags.paladin && !flags.mage);
  const admitEkProbabilisticArrivals = newlyArrived => {
    if (!ekProbBoxTime || spawning.length <= 0) return false;
    spawnTimer += TURN_DURATION;
    const maxPerTurn = Math.max(1, Math.min(3, Math.round(+(flags.ekEntryMaxArrivalsPerTurn || 2))));
    const highMark = Math.max(inp.exitThreshold + 2, Math.round(inp.boxSize) - 2);
    const lowMark = Math.max(1, inp.exitThreshold + 1);
    const nearFull = !!flags.ekEntryThrottleNearFull && mobHps.length >= highMark;
    const skipChance = nearFull ? Math.max(0, Math.min(0.85, +(flags.ekEntrySkipChanceNearFull || 0.25))) : 0;
    if (nearFull && rng() < skipChance) return true;
    const pressure = mobHps.length <= lowMark ? 2.1 : nearFull ? 0.9 : 1.35;
    let arrivingCount = Math.floor(pressure);
    if (rng() < pressure - arrivingCount) arrivingCount++;
    arrivingCount = Math.max(0, Math.min(arrivingCount, maxPerTurn, spawning.length));
    const arriving = spawning.splice(0, arrivingCount);
    for (const hp of arriving) {
      mobHps.push(hp);
      if (newlyArrived) newlyArrived.push(hp);
    }
    return true;
  };
  const applyEkProbabilisticReturn = (nextN, newlyArrived) => {
    if (!ekProbBoxTime || rpCycleActive) return false;
    const longGapRate = Math.max(0, Math.min(1, +(flags.ekLongGapRate || 0)));
    if (rng() < longGapRate) timeElapsed += inp.boxChangeTime;
    const target = Math.max(1, Math.min(nextN, Math.round(+(flags.ekPostGapTarget || Math.max(1, inp.exitThreshold)))));
    const immediate = Math.max(1, Math.min(nextN, target + Math.floor(rng() * 3) - 1));
    for (let i = 0; i < immediate; i++) {
      mobHps.push(inp.mobHp);
      if (newlyArrived) newlyArrived.push(inp.mobHp);
    }
    spawning = new Array(Math.max(0, nextN - immediate)).fill(inp.mobHp);
    spawnTimer = 0;
    return true;
  };

  let turnNum = 0;
  while (turnNum < maxTurns) {
    let aliveTotal = mobHps.length + (rpCycleActive ? rpCyclePending : spawning.length);
    if (rpCycleActive && flags.intel && timeElapsed >= rpCycleNextAt) {
      let guard = 0;
      while (timeElapsed >= rpCycleNextAt && guard++ < 3) {
        const nextN = rollCycleBudget();
        startRpCycle(rpCycleNextAt, nextN, mobHps.length === 0);
        rpCycleNextAt += rpCycleTime;
      }
      aliveTotal = mobHps.length + rpCyclePending;
    }

    // Inteligência: arrasta pra próxima box quando atinge threshold
    const shouldFlowRefill = flowSpawnActive && aliveTotal <= flowRefillThreshold && spawning.length === 0 && (aliveTotal < inp.exitThreshold || rng() < Math.max(0, Math.min(1, +(flags.ekFlowEarlyRefillChance || 0.65))));
    if (!rpCycleActive && spawning.length === 0 && ((flags.intel && aliveTotal <= inp.exitThreshold) || shouldFlowRefill)) {
      const nextN = rpCycleActive ? rollCycleBudget() : rollBoxSize();
      const incoming = (rpCycleActive || flowSpawnActive) ? Math.max(1, nextN - mobHps.length) : nextN;
      spawning = new Array(incoming).fill(inp.mobHp);
      spawnTimer = 0;
      if (rpCycleActive) rpCycleNextAt = timeElapsed + rpCycleTime;
      events.push({
        turn: turnNum,
        box: boxNum,
        type: 'box_drag',
        note: (LANG === 'pt' ? 'arrastou pra próxima box (' + nextN + ' mobs entrando)' : 'dragged to next box (' + nextN + ' mobs incoming)'),
        hpBefore: [...mobHps, ...spawning.map(()=>inp.mobHp)],
        hpAfter: [...mobHps, ...spawning.map(()=>inp.mobHp)]
      });
      boxesCompleted++;
      boxNum++;
      turnsThisBox = 0;
      continue;
    }

    // Box vazia: aguarda walking time, spawn fresh
    if (aliveTotal === 0) {
      events.push({
        turn: turnNum,
        box: boxNum,
        type: 'box_walk',
        note: (LANG === 'pt' ? 'box vazia — caminhou ' + inp.boxChangeTime + 's pra próxima' : 'empty box — walked ' + inp.boxChangeTime + 's to next'),
        hpBefore: [],
        hpAfter: []
      });
      boxesCompleted++;
      boxNum++;
      turnsThisBox = 0;
      mobHps = [];
      const nextN = rpCycleActive ? rollCycleBudget() : rollBoxSize();
      if (rpCycleActive && timeElapsed < rpCycleNextAt) {
        timeElapsed = rpCycleNextAt;
        continue;
      }
      const handledEkReturn = applyEkProbabilisticReturn(nextN, null);
      if (!handledEkReturn && !rpCycleActive) timeElapsed += inp.boxChangeTime;
      if (handledEkReturn) {
        // retorno parcial jÃ¡ populou mobHps/spawning
      } else if (flowSpawnActive) {
        spawning = new Array(nextN).fill(inp.mobHp);
        spawnTimer = 0;
      } else if (!flags.intel) {
        spawning = new Array(nextN).fill(inp.mobHp);
        spawnTimer = 0;
      } else {
        if (rpCycleActive) {
          startRpCycle(timeElapsed, nextN, true);
        } else {
          for (let i = 0; i < nextN; i++) mobHps.push(inp.mobHp);
        }
        if (rpCycleActive) rpCycleNextAt = timeElapsed + rpCycleTime;
      }
      continue;
    }

    // Turno normal de combate
    turnNum++;
    turnsThisBox++;
    timeElapsed += TURN_DURATION;

    // Captura HP antes
    const hpBefore = [...mobHps];

    // Resolução de spawn (mobs em transição podem aparecer)
    const newlyArrived = [];
    if (rpCycleActive) {
      admitRpCycleArrivals(newlyArrived);
    } else if (admitEkProbabilisticArrivals(newlyArrived)) {
    } else if (spawning.length > 0) {
      spawnTimer += TURN_DURATION;
      if (flowSpawnActive) {
        const flow = Math.max(1, Math.ceil(Math.max(1, inp.boxSize - inp.exitThreshold) / 3));
        const arriving = spawning.splice(0, rpCycleActive ? Math.min(flow, Math.max(0, rpCyclePeak - mobHps.length)) : flow);
        for (const hp of arriving) {
          mobHps.push(hp);
          newlyArrived.push(hp);
        }
      } else {
      const spawnDuration = flags.intel ? (rpCycleActive ? (flags.rpCycleFillTime || inp.boxChangeTime) : inp.boxChangeTime) : POST_WALK_TURNS * TURN_DURATION;
      const spawnCurve = flags.intel ? (inp.spawnCurve || 2.0) : POST_WALK_CURVE;
      const waveStep = Math.ceil(spawnTimer / TURN_DURATION);
      const usePostWalkWaves = !flags.intel && !flags.paladin && !flags.mage;
      const pNow = usePostWalkWaves ? pPostWalkWave(waveStep) : pPresent(spawnTimer, spawnDuration, spawnCurve);
      const pPrev = usePostWalkWaves ? pPostWalkWave(waveStep - 1) : pPresent(spawnTimer - TURN_DURATION, spawnDuration, spawnCurve);
      const pCond = pPrev >= 1 ? 1 : (pNow - pPrev) / (1 - pPrev);
      const stillSpawning = [];
      for (const hp of spawning) {
        if (rng() < pCond && (!rpCycleActive || mobHps.length < rpCyclePeak)) {
          mobHps.push(hp);
          newlyArrived.push(hp);
        } else {
          stillSpawning.push(hp);
        }
      }
      spawning = stillSpawning;
      }
    }

    if (mobHps.length === 0) {
      events.push({
        turn: turnNum,
        box: boxNum,
        type: 'attack',
        ac: ac % 3 + 1,
        baseDmg: dmgs[ac % 3],
        varMul: 1,
        isCrit: false,
        finalDmg: 0,
        components: [],
        charmHits: [],
        charmKills: 0,
        mobsHitVisual: 0,
        newlyArrived: newlyArrived.length,
        hpBefore: hpBefore,
        hpAfter: [],
        kills: 0
      });
      continue;
    }

    if (mageSpecialEnabled && cooldownRemaining > 0) {
      const beforeCooldown = cooldownRemaining;
      cooldownRemaining = Math.max(0, cooldownRemaining - TURN_DURATION);
      events.push({
        turn: turnNum,
        box: boxNum,
        type: 'cooldown',
        ac: ac % 3 + 1,
        baseDmg: 0,
        varMul: 1,
        isCrit: false,
        finalDmg: 0,
        components: [{ label: 'UE cooldown', baseDmg: 0, varMul: 1, isCrit: false, finalDmg: 0, hits: 0, kills: 0, cooldown: beforeCooldown }],
        charmHits: [],
        charmKills: 0,
        mobsHitVisual: null,
        newlyArrived: newlyArrived.length,
        hpBefore: hpBefore,
        hpAfter: [...mobHps],
        kills: 0
      });
      continue;
    }
    const mageUeReady = mageSpecialEnabled && timeElapsed >= nextUeAt;
    const shouldUseSpecialNow = ready => ready && (
      mobHps.length >= specialCastThreshold ||
      spawning.length === 0 ||
      (intelSpawnModel === 'flow_no_time' && mobHps.length >= Math.max(inp.exitThreshold + 1, Math.ceil(specialCastThreshold * 0.75)))
    );
    const isMageUeTurn = shouldUseSpecialNow(mageUeReady);

    const charmHits = [];
    let charmKills = 0;
    const components = [];
    const reflect = rollReflectDamage();
    if (reflect) components.push(reflect);
    if (!flags.paladin && inp.autoDmg > 0 && mobHps.length > 0) {
      const auto = rollAutoAttack();
      charmHits.push(...auto.charm.hits);
      charmKills += auto.charm.kills;
      components.push(auto.component);
    }
    const splitPaladinDamage = flags.paladin && inp.paladinArrowDmg > 0;
    if (splitPaladinDamage && mobHps.length > 0) {
      const charm = rollCharm('arrow');
      charmHits.push(...charm.hits);
      charmKills += charm.kills;
      inp._currentComponentCoverage = inp.paladinArrowCoverage || 1;
      components.push(rollAttack('arrow', inp.paladinArrowDmg, true));
    }
    if (mobHps.length > 0) {
      const grenadeReady = rpSpecialEnabled && splitPaladinDamage && timeElapsed >= nextGrenadeAt && pendingGrenadeTurns <= 0 && pendingGrenade <= 0;
      let grenadeDecision = { cast: false, expectedHits: mobHps.length, score: 0, reason: 'not_ready' };
      if (grenadeReady) {
        if (!Number.isFinite(grenadeReadySince)) {
          grenadeReadySince = timeElapsed;
          grenadeHeldTurns = 0;
          recentReachablePeak = mobHps.length;
        } else {
          grenadeHeldTurns++;
          recentReachablePeak = Math.max(recentReachablePeak, mobHps.length);
        }
        grenadeDecision = shouldCastRpGrenade(mobHps.length, spawning.length, specialCastThreshold, grenadeHeldTurns, recentReachablePeak, lastGrenadeReachable, intelSpawnModel);
      } else {
        grenadeReadySince = Infinity;
        grenadeHeldTurns = 0;
        recentReachablePeak = 0;
      }
      lastGrenadeReachable = mobHps.length;
      const shouldCastGrenade = grenadeDecision.cast;
      if (shouldCastGrenade) {
        pendingGrenade = grenadeBaseDmg;
        pendingGrenadeTurns = 2;
        nextGrenadeAt = timeElapsed + grenadeInterval;
        grenadeReadySince = Infinity;
        grenadeHeldTurns = 0;
        recentReachablePeak = 0;
        components.push({ label: 'grenade cast', baseDmg: grenadeBaseDmg, varMul: 1, isCrit: false, finalDmg: 0, hits: 0, kills: 0, threshold: specialCastThreshold, reachable: mobHps.length, expectedHits: grenadeDecision.expectedHits, score: grenadeDecision.score, reason: grenadeDecision.reason });
      } else {
        if (grenadeReady) components.push({ label: 'grenade ready, aguardando pico', baseDmg: 0, varMul: 1, isCrit: false, finalDmg: 0, hits: 0, kills: 0, held: true, threshold: specialCastThreshold, reachable: mobHps.length, expectedHits: grenadeDecision.expectedHits, score: grenadeDecision.score, heldTurns: grenadeHeldTurns, reason: grenadeDecision.reason });
        if (mageUeReady && !isMageUeTurn) components.push({ label: 'UE ready, aguardando box', baseDmg: 0, varMul: 1, isCrit: false, finalDmg: 0, hits: 0, kills: 0, held: true, threshold: specialCastThreshold, reachable: mobHps.length });
        const forceSpellForGrenade = flags.paladin && pendingGrenade > 0 && pendingGrenadeTurns <= 0;
        // Mistura rune/spell observada (rpRuneShare>0): sorteia por turno, com dano (+level)
        // e cobertura (série de hits) próprios. Senão, alternância antiga + dmgCycle.
        const rpMixActive = flags.paladin && inp.rpRuneShare > 0 && inp.rpSpellDmgSim > 0;
        // Cadeia de Markov: prob. de runa depende do componente do turno anterior (alternância).
        const pRune = prevRpRuneTurn === null ? inp.rpRuneShare : (prevRpRuneTurn ? inp.rpRuneAfterRune : inp.rpRuneAfterSpell);
        const isRuneTurn = flags.paladin && !forceSpellForGrenade &&
          (rpMixActive ? (rng() < pRune) : (rpSecondTurnIndex % 2 === 0));
        if (flags.paladin && rpMixActive) prevRpRuneTurn = isRuneTurn; // turno mágico resolveu
        const label = isMageUeTurn ? 'UE' : (flags.paladin ? (isRuneTurn ? 'rune' : 'spell') : 'spell AoE');
        const charm = rollCharm(label);
        charmHits.push(...charm.hits);
        charmKills += charm.kills;
        // Spell/runa (mistura): cobertura = fração observada do componente sobre os mobs vivos.
        if (rpMixActive) {
          inp._currentComponentCoverage = isRuneTurn ? (inp.paladinRuneCoverage || 1) : (inp.paladinSpellCoverage || 1);
          inp._useComponentCoverage = true;
        } else {
          inp._currentComponentCoverage = flags.paladin ? (inp.paladinSpellCoverage || 1) : (inp.aoeCoverage || 1);
        }
        const spellDmgTurn = rpMixActive ? inp.rpSpellDmgSim + level : dmgs[ac % 3];
        const runeDmgTurn = rpMixActive ? inp.rpRuneDmgSim + level : dmgs[ac % 3];
        const secondDmg = isMageUeTurn ? ueBaseDmg : (flags.paladin && rpMixActive ? (isRuneTurn ? runeDmgTurn : spellDmgTurn) : dmgs[ac % 3]);
        components.push(rollAttack(label, secondDmg, true));
        inp._useComponentCoverage = false;
        if (flags.paladin) rpSecondTurnIndex++;
      }
    }
    if (pendingGrenadeTurns > 0) pendingGrenadeTurns--;
    if (pendingGrenade > 0 && mobHps.length > 0 && pendingGrenadeTurns <= 0) {
      const charm = rollCharm('grenade');
      charmHits.push(...charm.hits);
      charmKills += charm.kills;
      inp._currentComponentCoverage = inp.paladinSpellCoverage || 1;
      components.push(rollAttack('grenade', pendingGrenade, true));
      pendingGrenade = 0;
    }
    delete inp._currentComponentCoverage;
    inp._useComponentCoverage = false;
    const killsThisTurn = charmKills + components.reduce((sum, c) => sum + c.kills, 0);
    const mainComponent = components[components.length - 1] || { baseDmg: dmgs[ac % 3], varMul: 1, isCrit: false, finalDmg: 0 };
    const aoeComponents = flags.paladin
      ? components.filter(c => (c.label === 'arrow' || c.label === 'spell' || c.label === 'rune' || c.label === 'grenade') && c.hits > 0)
      : components.filter(c => (c.label === 'spell AoE' || c.label === 'UE') && c.hits > 0);
    const residualGrenadeTurn = flags.paladin && flags.rpGrenadePeakResidualMode && aoeComponents.some(c => c.label === 'grenade');
    const mobsHitVisual = flags.paladin
      ? aoeComponents.reduce((sum, c) => sum + c.hits, 0)
      : (aoeComponents[0] ? aoeComponents[0].hits : 0);

    events.push({
      turn: turnNum,
      box: boxNum,
      type: 'attack',
      ac: ac % 3 + 1,
      baseDmg: mainComponent.baseDmg,
      varMul: mainComponent.varMul,
      isCrit: components.some(c => c.isCrit),
      finalDmg: components.reduce((sum, c) => sum + c.finalDmg, 0),
      components: components,
      charmHits: charmHits,
      charmKills: charmKills,
      mobsHitVisual: mobsHitVisual,
      newlyArrived: newlyArrived.length,
      hpBefore: hpBefore,
      hpAfter: [...mobHps],
      kills: killsThisTurn
    });

    ac++;
    if (isMageUeTurn) {
      cooldownRemaining = Math.max(0, ueLockout - TURN_DURATION);
      nextUeAt = timeElapsed + ueInterval;
    }
  }

  return {
    events,
    seed,
    level,
    dmgs,
    flags,
    critMult,
    totalKills,
    boxesCompleted,
    finalTime: timeElapsed,
    inp
  };
}

function fmtHpArr(arr) {
  if (arr.length === 0) return '—';
  if (arr.length <= 8) return '[' + arr.map(h => Math.round(h)).join(', ') + ']';
  return '[' + arr.slice(0, 6).map(h => Math.round(h)).join(', ') + ', ...+' + (arr.length - 6) + ']';
}

function renderHuntLog(data) {
  const meta = $('logMeta');
  const dec = LANG === 'pt' ? ',' : '.';
  const attackEvents = data.events.filter(ev => ev.type === 'attack');
  const sessionHits = attackEvents.map(ev => ev.mobsHitVisual || 0);
  const sessionHitCounts = {};
  for (const h of sessionHits) sessionHitCounts[h] = (sessionHitCounts[h] || 0) + 1;
  const sessionMode = modeValue(sessionHits);
  const sessionMean = sessionHits.length ? mean(sessionHits) : 0;
  const sessionP90 = percentile(sessionHits, 0.90);
  const sessionDist = Object.keys(sessionHitCounts).map(Number).sort((a, b) => a - b)
    .map(k => k + ':' + (sessionHitCounts[k] / Math.max(1, sessionHits.length) * 100).toFixed(0).replace('.', dec) + '%')
    .join(' · ');
  const flagsStr = [
    data.flags.charm ? 'charm' : null,
    data.flags.crit ? 'crit+' + (data.inp.critBoost) + '%' : null,
    data.flags.intel ? 'intel' : null,
    data.flags.var ? 'var' : null
  ].filter(x => x).join(' + ') || 'baseline';

  meta.innerHTML =
    '<strong>' + t('log_meta_seed') + '</strong> ' + data.seed + ' &nbsp;·&nbsp; ' +
    '<strong>' + t('log_meta_cycle') + '</strong> [' + data.dmgs.join(', ') + '] (+' + data.level + ') &nbsp;·&nbsp; ' +
    '<strong>flags:</strong> ' + flagsStr + '<br>' +
    '<strong>' + t('log_meta_total') + '</strong> ' + data.events.length + ' turnos · ' +
    data.finalTime.toFixed(1) + 's · ' +
    '<strong>' + t('log_meta_kills') + '</strong> ' + data.totalKills + ' &nbsp;·&nbsp; ' +
    '<strong>' + t('log_meta_boxes') + '</strong> ' + data.boxesCompleted + '<br>' +
    '<strong>' + t('log_meta_hit_dist') + '</strong> ' +
    t('log_meta_hit_mode') + ' ' + sessionMode + ' · ' +
    t('log_meta_hit_mean') + ' ' + sessionMean.toFixed(2).replace('.', dec) + ' · ' +
    t('log_meta_hit_p90') + ' ' + sessionP90 +
    (sessionDist ? ' · [' + sessionDist + ']' : '');

  let html = '<table class="log-table"><thead><tr>' +
    '<th>' + t('log_col_turn') + '</th>' +
    '<th>' + t('log_col_box') + '</th>' +
    '<th>' + t('log_col_dmg_base') + '</th>' +
    '<th>' + t('log_col_components') + '</th>' +
    '<th>' + t('log_col_crit') + '</th>' +
    '<th>' + t('log_col_charm') + '</th>' +
    '<th>' + t('log_col_hp_before') + '</th>' +
    '<th>' + t('log_col_hp_after') + '</th>' +
    '<th>' + t('log_col_kills') + '</th>' +
    '<th>' + t('log_col_spawn') + '</th>' +
    '</tr></thead><tbody>';

  for (const ev of data.events) {
    if (ev.type === 'box_drag') {
      html += '<tr class="box-end"><td colspan="10" style="text-align:center;color:var(--amber);font-style:italic">' +
        '⟶ turno ' + ev.turn + ' · ' + ev.note + '</td></tr>';
      continue;
    }
    if (ev.type === 'box_walk') {
      html += '<tr class="box-end"><td colspan="10" style="text-align:center;color:var(--text-dim);font-style:italic">' +
        '⟶ turno ' + ev.turn + ' · ' + ev.note + '</td></tr>';
      continue;
    }

    const charmStr = ev.charmHits.length === 0
      ? '—'
      : ev.charmHits.map(c => 'mob ' + (c.idx + 1) + ' (-' + c.dmg + ')').join(', ') +
        (ev.charmKills ? ' · kills ' + ev.charmKills : '');
    const componentStr = ev.components && ev.components.length
      ? ev.components.map(c =>
          c.held
            ? c.label + ' · ' + (c.reachable || 0) + '/' + (c.threshold || 0) + ' mobs' +
              (c.score != null ? ' · score ' + c.score.toFixed(2).replace('.', dec) : '') +
              (c.heldTurns != null ? ' · espera ' + c.heldTurns : '')
            : c.label + ': ' + Math.round(c.baseDmg) +
          ' x' + c.varMul.toFixed(2).replace('.', dec) +
          (c.isCrit ? ' xcrit' : '') +
          ' = ' + Math.round(c.finalDmg) +
          ' · hits ' + c.hits +
          (c.threshold && !c.held ? ' · ' + (c.reachable || 0) + '/' + c.threshold + ' mobs' : '') +
          (c.score != null && !c.held ? ' · score ' + c.score.toFixed(2).replace('.', dec) : '') +
          (c.kills ? ' · kills ' + c.kills : '')
        ).join('<br>')
      : '—';
    const critStr = ev.components && ev.components.length
      ? (ev.components.filter(c => c.isCrit).map(c => c.label + ' ' + data.critMult.toFixed(2).replace('.', dec) + 'x').join('<br>') || '—')
      : (ev.isCrit ? '✦ ' + data.critMult.toFixed(2).replace('.', dec) + 'x' : '—');

    html += '<tr>' +
      '<td>' + ev.turn + '</td>' +
      '<td>' + ev.box + '</td>' +
      '<td>' + ev.baseDmg + ' <span style="color:var(--text-dim);font-size:9px">(at' + ev.ac + ')</span></td>' +
      '<td style="font-size:10px;line-height:1.45">' + componentStr + '</td>' +
      '<td class="' + (ev.isCrit ? 'col-crit' : '') + '">' + critStr + '</td>' +
      '<td class="col-charm">' + charmStr + '</td>' +
      '<td class="hp-cell">' + fmtHpArr(ev.hpBefore) + '</td>' +
      '<td class="hp-cell">' + fmtHpArr(ev.hpAfter) + '</td>' +
      '<td class="' + (ev.kills > 0 ? 'col-kills' : '') + '">' + (ev.kills > 0 ? '✗ ' + ev.kills : '—') + '</td>' +
      '<td class="' + (ev.newlyArrived > 0 ? 'col-spawn' : '') + '">' + (ev.newlyArrived > 0 ? '+' + ev.newlyArrived : '—') + '</td>' +
      '</tr>';
  }
  html += '</tbody></table>';
  $('logTableWrap').innerHTML = html;
}

function huntLogToCSV(data) {
  const rows = [];
  rows.push(['turn', 'box', 'type', 'attack_cycle', 'dmg_base', 'components', 'mobs_hit_visual', 'crit', 'charm_hits', 'hp_before', 'hp_after', 'kills', 'spawn'].join(','));
  for (const ev of data.events) {
    if (ev.type === 'attack') {
      const compCsv = ev.components && ev.components.length
        ? ev.components.map(c => c.label + ':' + Math.round(c.baseDmg) + ':var' + c.varMul.toFixed(4) + ':crit' + (c.isCrit ? '1' : '0') + ':final' + c.finalDmg.toFixed(2) + ':hits' + c.hits + ':kills' + c.kills).join(';')
        : '';
      rows.push([
        ev.turn, ev.box, 'attack', ev.ac, ev.baseDmg,
        '"' + compCsv + '"',
        ev.mobsHitVisual || 0,
        ev.isCrit ? '1' : '0',
        '"' + (ev.charmHits.length === 0 ? '' : ev.charmHits.map(c => 'mob' + (c.idx + 1) + ':-' + c.dmg).join(';')) + (ev.charmKills ? ';kills:' + ev.charmKills : '') + '"',
        '"' + ev.hpBefore.map(h => Math.round(h)).join(';') + '"',
        '"' + ev.hpAfter.map(h => Math.round(h)).join(';') + '"',
        ev.kills,
        ev.newlyArrived
      ].join(','));
    } else {
      rows.push([ev.turn, ev.box, ev.type, '', '', '', '', '', '', '', '', '', ''].join(','));
    }
  }
  return rows.join('\n');
}

function populateLogLevelSelect() {
  const sel = $('logLevel');
  sel.innerHTML = '';
  for (let i = 0; i < N_LEVELS; i++) {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = '+' + i;
    sel.appendChild(opt);
  }
  sel.value = $('sliderDmg').value;
}

function openLogModal(config = null, opts = {}) {
  activeLogConfig = config && config.baseDmgs ? config : null;
  populateLogLevelSelect();
  $('logModal').classList.toggle('modal-top', !!opts.top);
  $('logModal').classList.add('open');
  document.body.style.overflow = 'hidden';
  // Gera log inicial automaticamente
  generateAndRender();
}
function closeLogModal() {
  $('logModal').classList.remove('open');
  $('logModal').classList.remove('modal-top');
  document.body.style.overflow = $('validatorModal') && $('validatorModal').classList.contains('open') ? 'hidden' : '';
  activeLogConfig = null;
}
function generateAndRender() {
  const level = +$('logLevel').value;
  const maxTurns = +$('logMaxTurns').value;
  const seed = +$('logSeed').value || 42;
  lastLogData = generateHuntLog(level, maxTurns, seed, activeLogConfig);
  renderHuntLog(lastLogData);
}
