function runValidatorComparison(data) {
  renderValidatorModelHelp(data);
  lastSimHitsHist = null;
  lastSimTemporalSeries = null;
  // Aplica os parâmetros do log na calculadora (sem sobrescrever os campos visuais)
  // e roda a simulação com FLAGS forçadas pra refletir o que o log mostra.
  // Inteligência: usar o que foi detectado pelo log; se não foi possível inferir
  // (log curto), assumir ON como default.
  const intelOn = data.intelDetected !== null ? data.intelDetected : true;
  const flags = {
    charm: true,    // log tem charms
    crit: true,     // log tem crits
    intel: intelOn, // detectado a partir de % de turnos vazios no log
    var: true,      // dano variável é mecânica natural do jogo
    paladin: data.isPaladin, // 2x atk/turno se paladino
    mage: !!data.isMage,
    profile: data.isMage ? 'mage' : (data.isPaladin ? 'rp' : 'ek')
  };

  const critMult = CRIT_BASE; // usar base 1.72x (modelo teórico, conforme decisão)

  // ===== APLICAR PARÂMETROS NA CALCULADORA PRINCIPAL =====
  // Atualiza os inputs visíveis na UI principal pra que o usuário possa fechar
  // o validador e ver os gráficos/tabelas com os mesmos parâmetros do log.
  // Também marca os checkboxes correspondentes (charm/crit/int/var = ON).
  $('dmg1').value = data.dmgCycle[0];
  $('dmg2').value = data.dmgCycle[1];
  $('dmg3').value = data.dmgCycle[2];
  const baseSimState = createValidatorSimState({
    autoDmg: data.autoDmg || 0,
    reflectDmg: data.reflectDmg || 0,
    paladinArrowDmg: data.paladinArrowDmg || 0,
    aoeHitSamples: [],
    coverageMode: 'none',
    aoeBoxP90: data.boxSizeP95 || 0,
    aoeCoverage: 1,
    boxVariance: 0,
    paladinArrowCoverage: data.paladinArrowCoverage || 1,
    paladinSpellCoverage: data.paladinSpellCoverage || 1,
    paladinRuneCoverage: data.paladinRuneCoverage || 1,
    paladinGrenadeCoverage: data.paladinGrenadeCoverage || 1,
    spawnCurve: 2.0,
    rpGrenadeDmg: data.rpGrenadeDmg || 0,
    rpGrenadeIntervalSeconds: data.rpGrenadeIntervalSeconds || 24,
    rpRuneShare: data.rpRuneShare || 0,
    rpRuneAfterRune: data.rpRuneAfterRune || 0,
    rpRuneAfterSpell: data.rpRuneAfterSpell || 0,
    rpSpellDmgSim: data.rpSpellDmgSim || 0,
    rpRuneDmgSim: data.rpRuneDmgSim || 0,
    mageUeDmg: data.mageUeDmg || 0,
    mageUeIntervalSeconds: data.mageUeIntervalSeconds || 50,
    combatProfile: flags.profile
  });
  currentSimState = baseSimState;
  $('charmDmg').value = Math.round(data.avgCharm);
  $('mobHp').value = data.hpEstimated;
  $('mobXp').value = Math.round(data.avgXpPerKill);
  $('boxSize').value = data.boxSizeP95;
  $('exitThreshold').value = data.exitP5;
  $('boxTime').value = data.boxChangeTime;
  // Crit boost = (critMultObserved - 1.72) × 100, arredondado
  // Aplicado sempre, mesmo com valores estranhos (-20%, +99%, etc).
  // Em logs curtos pode ficar inflado por procs como Transcendence ou viés
  // de amostra pequena. Usuário pode ajustar manualmente se necessário.
  $('critBoost').value = Math.round((data.critMultObserved - CRIT_BASE) * 100);
  // Marca checkboxes
  cbCharm.checked = true;
  cbCrit.checked = true;
  cbInt.checked = intelOn; // detectado do log
  cbVar.checked = true;
  if (cbSpecial) cbSpecial.checked = data.isPaladin || (data.isMage && data.mageUeDetected);
  cbPaladin.checked = data.isPaladin;
  if (vocationMain) vocationMain.value = flags.profile;
  // Atualiza UI dos checkboxes
  updateUI();

  $('valStatus').textContent = t('val_applied_to_main');
  $('valCompareStatus').textContent = t('val_status_simulating');
  $('btnRunComparison').disabled = true;

  const t0 = performance.now();
  const runSeed = (Math.random() * 0xFFFFFFFF) >>> 0;
  const firstRpSecondTurn = data.isPaladin && data.temporalSeries
    ? data.temporalSeries.find(p => p && p.components && ((p.components.rune || 0) > 0 || (p.components.spell || 0) > 0))
    : null;

  // Roda simulação SÓ pra comparação (nível 0, single run rápido)
  // Usa o caminho serial inline (mais simples — não precisa criar workers só pra isso)
  const simConfig = {
    baseDmgs: data.dmgCycle,
    charmDmg: Math.round(data.avgCharm),
    autoDmg: data.autoDmg || 0,
    reflectDmg: data.reflectDmg || 0,
    paladinArrowDmg: data.paladinArrowDmg || 0,
    critMult,
    mobHp: data.hpEstimated,
    mobXp: data.avgXpPerKill,
    boxSize: data.boxSizeEffective || data.boxSizeP95,
    exitThreshold: data.exitP5,
    boxChangeTime: data.boxChangeTime,
    aoeHitSamples: data.aoeHitSamples || [],
    coverageMode: 'hybrid',
    aoeBoxP90: data.boxSizeP95,
    aoeCoverage: 1,
    boxVariance: data.boxVariance || 0,
    paladinArrowCoverage: data.paladinArrowCoverage || 1,
    paladinSpellCoverage: data.paladinSpellCoverage || 1,
    paladinRuneCoverage: data.paladinRuneCoverage || 1,
    paladinGrenadeCoverage: data.paladinGrenadeCoverage || 1,
    rpGrenadeMode: data.isPaladin,
    mageUeMode: data.isMage && data.mageUeDetected,
    rpGrenadeDmg: data.rpGrenadeDmg || Math.max(...data.dmgCycle),
    rpRuneShare: data.rpRuneShare || 0,
    rpRuneAfterRune: data.rpRuneAfterRune || 0,
    rpRuneAfterSpell: data.rpRuneAfterSpell || 0,
    rpSpellDmgSim: data.rpSpellDmgSim || 0,
    rpRuneDmgSim: data.rpRuneDmgSim || 0,
    rpRuneStartWithRune: firstRpSecondTurn ? ((firstRpSecondTurn.components && firstRpSecondTurn.components.rune || 0) > 0) : true,
    rpGrenadeDelaySeconds: 3,
    rpGrenadeIntervalSeconds: data.rpGrenadeIntervalSeconds || 24,
    mageUeDmg: data.mageUeDetected ? data.mageUeDmg : 0,
    mageUeIntervalSeconds: data.mageUeIntervalSeconds || 50,
    mageUeLockoutSeconds: 4,
    startMode: 'warm',
    intelSpawnModel: 'timed',
    spawnCurve: data.spawnCurve || 2.0,
    flags,
    runSeed,
    levels: [0],
    nSessions: VALIDATOR_COMPARE_SESSIONS,
    sessionSeconds: VALIDATOR_COMPARE_SECONDS
  };

  const baselineConfig = {
    ...simConfig,
    boxSize: data.boxSizeEffective || data.boxSizeP95,
    aoeHitSamples: [],
    coverageMode: 'none',
    spawnCurve: 2.0
  };
  const visualConfig = {
    ...simConfig,
    boxSize: data.boxSizeEffective || data.boxSizeP95,
    coverageMode: 'none',
    spawnCurve: data.spawnCurve || 2.0
  };
  const hybridConfig = {
    ...simConfig,
    boxSize: data.boxSizeEffective || data.boxSizeP95,
    coverageMode: 'hybrid',
    spawnCurve: 2.0
  };
  const flowConfig = {
    ...simConfig,
    boxSize: data.boxSizeEffective || data.boxSizeP95,
    exitThreshold: data.exitP5,
    boxChangeTime: data.boxChangeTime,
    aoeHitSamples: data.aoeHitSamples || [],
    coverageMode: 'hybrid',
    aoeBoxP90: data.boxSizeP95,
    aoeCoverage: 1,
    boxVariance: data.boxVariance || 0,
    intelSpawnModel: intelOn ? 'flow_no_time' : 'timed',
    spawnCurve: data.spawnCurve || 2.0
  };
  const targetHitBox = data.boxSizeEffective || data.boxSizeP95;
  const targetHitExit = data.exitP5;
  const screenCoverages = [0.65, 0.70, 0.75, 0.80];
  const screenConfigs = screenCoverages.map(cov => ({
    ...simConfig,
    boxSize: Math.max(0.1, targetHitBox / cov),
    exitThreshold: Math.max(1, targetHitExit / cov),
    boxChangeTime: 40,
    aoeHitSamples: [],
    coverageMode: 'screen_ratio',
    aoeCoverage: cov,
    spawnCurve: 1.0
  }));
  const rpCoverageCenter = Math.max(0.65, Math.min(0.85, data.aoeCoverageMean || 1));
  const rpDistributionCoverages = [...new Set([
    Math.max(0.65, Math.min(0.85, rpCoverageCenter - 0.05)),
    rpCoverageCenter,
    Math.max(0.65, Math.min(0.85, rpCoverageCenter + 0.05))
  ].map(v => +v.toFixed(2)))];
  const rpDistributionConfigs = rpDistributionCoverages.map(cov => ({
    ...simConfig,
    boxSize: data.boxSizeEffective || data.boxSizeP95,
    exitThreshold: data.exitP5,
    boxChangeTime: data.boxChangeTime,
    aoeHitSamples: [],
    coverageMode: 'screen_ratio',
    aoeCoverage: cov,
    spawnCurve: data.spawnCurve || 2.0
  }));
  const rpSplitConfig = {
    ...simConfig,
    boxSize: data.boxSizeEffective || data.boxSizeP95,
    exitThreshold: data.exitP5,
    boxChangeTime: data.boxChangeTime,
    aoeHitSamples: [],
    coverageMode: 'rp_split',
    aoeCoverage: 1,
    paladinArrowCoverage: data.paladinArrowCoverage || rpCoverageCenter,
    paladinSpellCoverage: data.paladinSpellCoverage || rpCoverageCenter,
    spawnCurve: data.spawnCurve || 2.0
  };
  const buildCycleBudget = (interval, minPeak) => {
    const killsPerHour = data.totalKills && data.duration ? data.totalKills / (data.duration / 3600) : 0;
    const peak = Math.max(1, minPeak || data.boxSizeEffective || data.boxSizeP95 || 1);
    return Math.max(peak, killsPerHour && interval ? killsPerHour * interval / 3600 : peak);
  };
  const buildRpCadenceProfile = () => {
    const cycleTime = Math.max(14, data.rpGrenadeIntervalSeconds || data.boxChangeTime || 14);
    const peakBoxSize = Math.max(1, data.boxSizeEffective || data.boxSizeP95 || 1);
    const cycleMobBudget = buildCycleBudget(cycleTime, peakBoxSize);
    const cadence = extractRpCadenceDiagnostics(data.temporalSeries || [], data);
    const subpeaks = Math.max(2, Math.min(6, Math.round(cadence.cadenceSubpeaks || 3)));
    const pulseGap = Math.max(2.25, Math.min(cycleTime / 2, cadence.cadencePulseGap || cycleTime / subpeaks));
    const entryShare = Math.max(0.15, Math.min(0.70, cadence.cadenceEntryShare || 0.35));
    const entryRun = Math.max(1, Math.min(4, cadence.cadenceEntryRun || 2));
    const overload = cycleMobBudget / Math.max(1, peakBoxSize);
    const visibleBudgetShare = Math.max(0.58, Math.min(0.92, overload > 2.3 ? 0.68 : 0.82));
    return { cycleTime, cycleMobBudget, peakBoxSize, subpeaks, pulseGap, entryShare, entryRun, visibleBudgetShare };
  };
  const withRpCycleFlags = (cfg, opts = {}) => {
    const cycleTime = Math.max(14, +(opts.cycleTime || cfg.rpGrenadeIntervalSeconds || cfg.boxChangeTime || data.boxChangeTime || 14));
    const peak = Math.max(1, +(opts.peakBoxSize || data.boxSizeEffective || data.boxSizeP95 || cfg.boxSize || 1));
    const fillTime = Math.max(2.25, +(opts.fillTime || data.boxChangeTime || cfg.boxChangeTime || 2.25));
    const budget = Math.max(peak, +(opts.mobBudget || buildCycleBudget(cycleTime, peak)));
    return {
      ...cfg,
      boxChangeTime: cycleTime,
      rpGrenadeIntervalSeconds: cycleTime,
      intelSpawnModel: 'timed',
      flags: {
        ...cfg.flags,
        rpCycleMode: true,
        rpCycleTime: cycleTime,
        rpCycleMobBudget: budget,
        rpCyclePeakBoxSize: peak,
        rpCycleFillTime: fillTime,
        rpCycleTwoPhase: !!opts.twoPhase,
        rpCyclePulseMode: !!opts.pulseMode,
        rpCyclePulseCount: opts.pulseCount || 0,
        rpCyclePulseGap: opts.pulseGap || 0,
        rpCycleUseLogCadence: !!opts.useLogCadence,
        rpLatentBudgetMode: !!opts.latentBudget,
        rpVisibleBudgetShare: opts.visibleBudgetShare || 0
      },
      rpCycleTime: cycleTime,
      rpCycleMobBudget: budget,
      rpCyclePeakBoxSize: peak,
      rpCycleFillTime: fillTime,
      diagnosticBoxAnchor: opts.anchor || 'grenade_cycle'
    };
  };
  const withWarmCarryover = (cfg, intensity = 0.65) => ({
    ...cfg,
    startMode: 'warm',
    flags: { ...cfg.flags, warmCarryoverIntensity: intensity }
  });
  const rpGrenadeCycleBase = (data.paladinArrowDmg || 0) > 0 ? rpSplitConfig : hybridConfig;
  const rpCycleTime = Math.max(14, data.rpGrenadeIntervalSeconds || rpGrenadeCycleBase.rpGrenadeIntervalSeconds || rpGrenadeCycleBase.boxChangeTime);
  const rpCycleMobBudget = buildCycleBudget(rpCycleTime, data.boxSizeEffective || data.boxSizeP95 || 1);
  const rpCycleFillDiag = extractObservedBoxTransitions(data.temporalSeries || [], data.exitP5, data.boxSizeP95);
  const rpCycleFillTime = rpCycleFillDiag.observedBoxTime || data.boxChangeTime;
  const rpCadenceProfile = buildRpCadenceProfile();
  const rpGrenadeCycleHybridConfig = withRpCycleFlags(rpSplitConfig, { cycleTime: rpCycleTime, mobBudget: rpCycleMobBudget, fillTime: rpCycleFillTime, anchor: 'grenade_cycle_hybrid' });
  const rpTwoPhaseCycleConfig = withRpCycleFlags(rpSplitConfig, { cycleTime: rpCycleTime, mobBudget: rpCycleMobBudget, fillTime: Math.min(rpCycleFillTime, Math.max(2.25, rpCycleTime * 0.35)), twoPhase: true, anchor: 'grenade_cycle_two_phase' });
  const rpMultiPulseCycleConfig = withRpCycleFlags(rpSplitConfig, {
    cycleTime: rpCadenceProfile.cycleTime,
    mobBudget: rpCadenceProfile.cycleMobBudget,
    peakBoxSize: rpCadenceProfile.peakBoxSize,
    fillTime: rpCycleFillTime,
    pulseMode: true,
    pulseCount: rpCadenceProfile.subpeaks,
    pulseGap: rpCadenceProfile.pulseGap,
    anchor: 'grenade_cycle_multi_pulse'
  });
  const rpVisibleLatentBudgetConfig = withRpCycleFlags(rpSplitConfig, {
    cycleTime: rpCadenceProfile.cycleTime,
    mobBudget: rpCadenceProfile.cycleMobBudget,
    peakBoxSize: rpCadenceProfile.peakBoxSize,
    fillTime: rpCycleFillTime,
    twoPhase: true,
    latentBudget: true,
    visibleBudgetShare: rpCadenceProfile.visibleBudgetShare,
    anchor: 'grenade_cycle_visible_latent'
  });
  const rpCadenceFromLogConfig = withRpCycleFlags(rpSplitConfig, {
    cycleTime: rpCadenceProfile.cycleTime,
    mobBudget: rpCadenceProfile.cycleMobBudget,
    peakBoxSize: rpCadenceProfile.peakBoxSize,
    fillTime: rpCycleFillTime,
    pulseMode: true,
    useLogCadence: true,
    pulseCount: rpCadenceProfile.subpeaks,
    pulseGap: rpCadenceProfile.pulseGap,
    anchor: 'grenade_cycle_log_cadence'
  });
  const rpGrenadePeakResidualDiag = extractRpGrenadePeakResidual(data);
  const rpGrenadeResidualHits = Math.max(1, Math.round(
    rpGrenadePeakResidualDiag.grenadeResidualP75 ||
    rpGrenadePeakResidualDiag.grenadeResidualMedian ||
    0
  ));
  const rpGrenadePeakResidualConfig = {
    ...rpSplitConfig,
    flags: {
      ...rpSplitConfig.flags,
      rpGrenadePeakResidualMode: true,
      rpGrenadeResidualHits,
      rpGrenadePeakRaw: rpGrenadePeakResidualDiag.grenadePeakRawMedian || 0
    },
    rpGrenadePeakResidual: rpGrenadePeakResidualDiag,
    diagnosticBoxAnchor: 'grenade_peak_residual'
  };
  const rpHitTarget = Math.max(1, Math.round(data.boxSizeP95 || data.boxSizeEffective || rpSplitConfig.boxSize || 1));
  const rpHitTargetSpellCoverage = Math.max(0.55, Math.min(1, data.paladinSpellCoverage || rpCoverageCenter || 1));
  const rpHitTargetArrowCoverage = Math.max(0.35, Math.min(rpHitTargetSpellCoverage, data.paladinArrowCoverage || rpCoverageCenter || rpHitTargetSpellCoverage));
  const rpHitTargetRotationCoverage = Math.max(0.55, Math.min(1, (rpHitTargetArrowCoverage + rpHitTargetSpellCoverage) / 2));
  const rpHitTargetVisualBox = Math.max(rpHitTarget, Math.ceil(rpHitTarget / rpHitTargetRotationCoverage));
  const rpHitTargetVisualExit = Math.max(1, Math.min(rpHitTargetVisualBox, Math.ceil((data.exitP5 || 1) / rpHitTargetRotationCoverage)));
  const rpHitTargetCoverageConfig = {
    ...rpGrenadePeakResidualConfig,
    boxSize: rpHitTargetVisualBox,
    exitThreshold: rpHitTargetVisualExit,
    coverageMode: 'rp_split',
    paladinSpellCoverage: rpHitTargetSpellCoverage,
    paladinArrowCoverage: rpHitTargetArrowCoverage,
    diagnosticBoxAnchor: 'hit_target_coverage',
    hitTarget: rpHitTarget,
    visualBoxSize: rpHitTargetVisualBox
  };
  const rpHitTargetCycleConfig = withRpCycleFlags(rpHitTargetCoverageConfig, {
    cycleTime: rpCadenceProfile.cycleTime,
    mobBudget: rpCadenceProfile.cycleMobBudget,
    peakBoxSize: rpHitTargetVisualBox,
    fillTime: rpCycleFillTime,
    pulseMode: true,
    useLogCadence: true,
    pulseCount: rpCadenceProfile.subpeaks,
    pulseGap: rpCadenceProfile.pulseGap,
    anchor: 'hit_target_cycle'
  });
  const mageCycleTime = Math.max(36, data.mageUeIntervalSeconds || simConfig.mageUeIntervalSeconds || 50);
  const mageCyclePeak = Math.max(1, data.mageBoxTarget || data.boxSizeEffective || data.boxSizeP95 || 1);
  const mageUeCycleConfig = withRpCycleFlags({
    ...baselineConfig,
    coverageMode: 'none',
    aoeHitSamples: [],
    boxSize: mageCyclePeak,
    exitThreshold: data.exitP5,
    boxChangeTime: mageCycleTime,
    mageUeMode: data.isMage && data.mageUeDetected,
    mageUeDmg: data.mageUeDetected ? data.mageUeDmg : 0,
    mageUeIntervalSeconds: mageCycleTime
  }, { cycleTime: mageCycleTime, mobBudget: buildCycleBudget(mageCycleTime, mageCyclePeak), peakBoxSize: mageCyclePeak, fillTime: data.boxChangeTime, twoPhase: true, anchor: 'mage_ue_cycle' });
  const ekReflectPressureConfig = withWarmCarryover({
    ...hybridConfig,
    reflectDmg: data.reflectDmg || hybridConfig.reflectDmg || 0,
    flags: { ...hybridConfig.flags, reflectPressureMode: true }
  }, 0.85);
  const ekGapProfile = extractEkBoxGapProfile(data.temporalSeries || [], data);
  const ekFlowConfig = {
    ...visualConfig,
    intelSpawnModel: 'flow_no_time',
    reflectDmg: data.reflectDmg || visualConfig.reflectDmg || 0,
    flags: {
      ...visualConfig.flags,
      intel: false,
      ekFlowMode: true,
      ekFlowRefillThreshold: Math.max(data.exitP5 || 1, Math.min(Math.round(visualConfig.boxSize || data.boxSizeP95 || 1), Math.ceil(((visualConfig.boxSize || data.boxSizeP95 || 1) + (data.exitP5 || 1)) / 2))),
      ekFlowEarlyRefillChance: 0.45
    },
    diagnosticBoxAnchor: 'ek_flow'
  };
  const ekProbabilisticBoxTimeConfig = {
    ...visualConfig,
    reflectDmg: data.reflectDmg || visualConfig.reflectDmg || 0,
    flags: {
      ...visualConfig.flags,
      ekProbabilisticBoxTime: true,
      ekLongGapRate: Math.max(0, Math.min(0.35, ekGapProfile.longGapRate || 0)),
      ekShortGapRate: Math.max(0, Math.min(0.5, ekGapProfile.shortGapRate || 0)),
      ekPostGapTarget: Math.max(1, Math.min(visualConfig.boxSize || data.boxSizeP95 || 1, Math.round(ekGapProfile.postLongGapHitsMedian || data.exitP5 || 1))),
      ekEntryMaxArrivalsPerTurn: 2,
      ekEntryThrottleNearFull: true,
      ekEntrySkipChanceNearFull: 0.25,
      ekPartialReturnWaves: true
    },
    ekGapProfile,
    diagnosticBoxAnchor: 'ek_probabilistic_box_time'
  };
  const warmCarryoverConfig = withWarmCarryover(hybridConfig, data.isMage ? 0.75 : 0.65);
  const simJobEntries = [];
  if (data.isPaladin) {
    simJobEntries.push(
      { key: 'baseline', cfg: baselineConfig },
      { key: 'hybrid', cfg: hybridConfig },
      ...(intelOn ? [{ key: 'flow_no_time', cfg: flowConfig }] : []),
      { key: 'rp_split', cfg: rpSplitConfig },
      { key: 'rp_grenade_cycle_hybrid', cfg: rpGrenadeCycleHybridConfig },
      { key: 'rp_two_phase_cycle', cfg: rpTwoPhaseCycleConfig },
      { key: 'rp_multi_pulse_cycle', cfg: rpMultiPulseCycleConfig },
      { key: 'rp_visible_latent_budget', cfg: rpVisibleLatentBudgetConfig },
      { key: 'rp_cadence_from_log', cfg: rpCadenceFromLogConfig },
      { key: 'rp_grenade_peak_residual', cfg: rpGrenadePeakResidualConfig },
      { key: 'rp_hit_target_coverage', cfg: rpHitTargetCoverageConfig },
      { key: 'rp_hit_target_cycle', cfg: rpHitTargetCycleConfig }
    );
  } else if (data.isMage) {
    simJobEntries.push(
      { key: 'baseline', cfg: baselineConfig },
      ...(intelOn ? [{ key: 'flow_no_time', cfg: flowConfig }] : []),
      ...(data.mageUeDetected ? [{ key: 'mage_ue_cycle', cfg: mageUeCycleConfig }] : []),
      { key: 'warm_carryover', cfg: warmCarryoverConfig }
    );
  } else {
    simJobEntries.push(
      { key: 'baseline', cfg: baselineConfig },
      { key: 'visual', cfg: visualConfig },
      { key: 'hybrid', cfg: hybridConfig },
      { key: 'full', cfg: simConfig },
      ...(intelOn ? [{ key: 'flow_no_time', cfg: flowConfig }] : []),
      { key: 'ek_flow', cfg: ekFlowConfig },
      { key: 'ek_probabilistic_box_time', cfg: ekProbabilisticBoxTimeConfig },
      ...(data.reflectDmg ? [{ key: 'ek_reflect_pressure', cfg: ekReflectPressureConfig }] : []),
      { key: 'warm_carryover', cfg: warmCarryoverConfig }
    );
    if (data.aoeHitSamples && data.aoeHitSamples.length) {
      screenConfigs.forEach(cfg => simJobEntries.push({ key: 'screen_' + Math.round(cfg.aoeCoverage * 100), cfg }));
    }
  }

  const modelLabelForJob = key => ({
    baseline: t('val_model_baseline'),
    visual: t('val_coverage_visual'),
    hybrid: t('val_coverage_hybrid'),
    full: t('val_coverage_full'),
    flow_no_time: t('val_model_flow_no_time'),
    rp_split: t('val_model_rp_split'),
    rp_grenade_cycle_hybrid: t('val_model_rp_grenade_cycle_hybrid'),
    rp_two_phase_cycle: t('val_model_rp_two_phase_cycle'),
    rp_multi_pulse_cycle: t('val_model_rp_multi_pulse_cycle'),
    rp_visible_latent_budget: t('val_model_rp_visible_latent_budget'),
    rp_cadence_from_log: t('val_model_rp_cadence_from_log'),
    rp_grenade_peak_residual: t('val_model_rp_grenade_peak_residual'),
    rp_hit_target_coverage: t('val_model_rp_hit_target_coverage'),
    rp_hit_target_cycle: t('val_model_rp_hit_target_cycle'),
    mage_ue_cycle: t('val_model_mage_ue_cycle'),
    ek_flow: t('val_model_ek_flow'),
    ek_reflect_pressure: t('val_model_ek_reflect_pressure'),
    ek_probabilistic_box_time: t('val_model_ek_probabilistic_box_time'),
    warm_carryover: t('val_model_warm_carryover')
  }[key] || key);
  const runValidatorJobs = async () => {
    const out = [];
    for (let i = 0; i < simJobEntries.length; i++) {
      const job = simJobEntries[i];
      $('valCompareStatus').textContent = (i + 1) + '/' + simJobEntries.length + ' - ' + modelLabelForJob(job.key);
      await new Promise(resolve => setTimeout(resolve, 0));
      out.push(await runSimInline(job.cfg, () => {}));
    }
    return out;
  };

  return runValidatorJobs().then(results => {
    const resultByKey = {};
    simJobEntries.forEach((job, idx) => { resultByKey[job.key] = results[idx]; });
    const baselineResult = resultByKey.baseline || [{ xph: 0, levels: {} }];
    const getResult = key => resultByKey[key] || [{ xph: baselineResult[0] ? baselineResult[0].xph : 0, levels: {} }];
    const visualResult = getResult('visual');
    const hybridResult = getResult('hybrid');
    const result = getResult('full');
    const flowResult = getResult('flow_no_time');
    const screenResults = screenConfigs.map(cfg => getResult('screen_' + Math.round(cfg.aoeCoverage * 100)));
    const rpSplitResult = getResult('rp_split');
    const rpGrenadeCycleHybridResult = getResult('rp_grenade_cycle_hybrid');
    const rpTwoPhaseCycleResult = getResult('rp_two_phase_cycle');
    const rpMultiPulseCycleResult = getResult('rp_multi_pulse_cycle');
    const rpVisibleLatentBudgetResult = getResult('rp_visible_latent_budget');
    const rpCadenceFromLogResult = getResult('rp_cadence_from_log');
    const rpGrenadePeakResidualResult = getResult('rp_grenade_peak_residual');
    const rpHitTargetCoverageResult = getResult('rp_hit_target_coverage');
    const rpHitTargetCycleResult = getResult('rp_hit_target_cycle');
    const mageUeCycleResult = getResult('mage_ue_cycle');
    const ekFlowResult = getResult('ek_flow');
    const ekReflectPressureResult = getResult('ek_reflect_pressure');
    const ekProbabilisticBoxTimeResult = getResult('ek_probabilistic_box_time');
    const warmCarryoverResult = getResult('warm_carryover');
    const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
    $('valCompareStatus').textContent = elapsed + 's';

    let candidates = [
      { key: 'none', label: t('val_coverage_none'), cfg: baselineConfig, sim: baselineResult[0], pref: 0, strength: 0 },
      { key: 'visual', label: t('val_coverage_visual'), cfg: visualConfig, sim: visualResult[0], pref: 1, strength: 0 },
      { key: 'hybrid', label: t('val_coverage_hybrid'), cfg: hybridConfig, sim: hybridResult[0], pref: 2, strength: 100 },
      { key: 'full', label: t('val_coverage_full'), cfg: simConfig, sim: result[0], pref: 3, strength: 100 }
    ];
    if (intelOn) {
      candidates.push({ key: 'flow_no_time', label: t('val_model_flow_no_time'), cfg: flowConfig, sim: flowResult[0], pref: 4, strength: 100 });
    }
    screenConfigs.forEach((cfg, idx) => {
      const pct = Math.round(cfg.aoeCoverage * 100);
      candidates.push({
        key: 'screen_' + pct,
        label: t('val_coverage_screen').replace('{p}', pct),
        cfg,
        sim: screenResults[idx][0],
        pref: 5 + idx,
        strength: pct
      });
    });
    if (data.isPaladin) {
      candidates = [
        ...(intelOn ? [{ key: 'flow_no_time', label: t('val_model_flow_no_time'), cfg: flowConfig, sim: flowResult[0], pref: 2, strength: 100 }] : []),
        { key: 'rp_split', label: t('val_model_rp_split'), cfg: rpSplitConfig, sim: rpSplitResult[0], pref: 6, strength: Math.round((rpSplitConfig.paladinArrowCoverage + rpSplitConfig.paladinSpellCoverage) * 50) },
        { key: 'rp_grenade_cycle_hybrid', label: t('val_model_rp_grenade_cycle_hybrid'), cfg: rpGrenadeCycleHybridConfig, sim: rpGrenadeCycleHybridResult[0], pref: 6.6, strength: Math.round((rpGrenadeCycleHybridConfig.paladinArrowCoverage + rpGrenadeCycleHybridConfig.paladinSpellCoverage) * 50) || 100 },
        { key: 'rp_two_phase_cycle', label: t('val_model_rp_two_phase_cycle'), cfg: rpTwoPhaseCycleConfig, sim: rpTwoPhaseCycleResult[0], pref: 6.7, strength: Math.round((rpTwoPhaseCycleConfig.paladinArrowCoverage + rpTwoPhaseCycleConfig.paladinSpellCoverage) * 50) || 100 },
        { key: 'rp_multi_pulse_cycle', label: t('val_model_rp_multi_pulse_cycle'), cfg: rpMultiPulseCycleConfig, sim: rpMultiPulseCycleResult[0], pref: 6.8, strength: Math.round((rpMultiPulseCycleConfig.paladinArrowCoverage + rpMultiPulseCycleConfig.paladinSpellCoverage) * 50) || 100 },
        { key: 'rp_visible_latent_budget', label: t('val_model_rp_visible_latent_budget'), cfg: rpVisibleLatentBudgetConfig, sim: rpVisibleLatentBudgetResult[0], pref: 6.9, strength: Math.round((rpVisibleLatentBudgetConfig.paladinArrowCoverage + rpVisibleLatentBudgetConfig.paladinSpellCoverage) * 50) || 100 },
        { key: 'rp_cadence_from_log', label: t('val_model_rp_cadence_from_log'), cfg: rpCadenceFromLogConfig, sim: rpCadenceFromLogResult[0], pref: 7.0, strength: Math.round((rpCadenceFromLogConfig.paladinArrowCoverage + rpCadenceFromLogConfig.paladinSpellCoverage) * 50) || 100 },
        { key: 'rp_grenade_peak_residual', label: t('val_model_rp_grenade_peak_residual'), cfg: rpGrenadePeakResidualConfig, sim: rpGrenadePeakResidualResult[0], pref: 7.1, strength: Math.round(rpGrenadeResidualHits) },
        { key: 'rp_hit_target_coverage', label: t('val_model_rp_hit_target_coverage'), cfg: rpHitTargetCoverageConfig, sim: rpHitTargetCoverageResult[0], pref: 7.2, strength: rpHitTarget },
        { key: 'rp_hit_target_cycle', label: t('val_model_rp_hit_target_cycle'), cfg: rpHitTargetCycleConfig, sim: rpHitTargetCycleResult[0], pref: 7.3, strength: rpHitTarget }
      ];
    } else if (data.isMage) {
      candidates = [
        { key: 'mage_base', label: t('val_model_baseline'), cfg: baselineConfig, sim: baselineResult[0], pref: 0, strength: 100 }
      ];
      if (intelOn) {
        candidates.push({ key: 'flow_no_time', label: t('val_model_flow_no_time'), cfg: flowConfig, sim: flowResult[0], pref: 1, strength: 100 });
      }
      if (data.mageUeDetected) {
        candidates.push({ key: 'mage_ue_cycle', label: t('val_model_mage_ue_cycle'), cfg: mageUeCycleConfig, sim: mageUeCycleResult[0], pref: 1.5, strength: 100 });
      }
      candidates.push({ key: 'warm_carryover', label: t('val_model_warm_carryover'), cfg: warmCarryoverConfig, sim: warmCarryoverResult[0], pref: 2, strength: 100 });
    } else if (!(data.aoeHitSamples && data.aoeHitSamples.length)) {
      candidates = candidates.filter(c => c === candidates[0] || c.key === 'flow_no_time');
    }
    if (!data.isPaladin && !data.isMage) {
      candidates.push({ key: 'ek_flow', label: t('val_model_ek_flow'), cfg: ekFlowConfig, sim: ekFlowResult[0], pref: 2.2, strength: 100 });
      candidates.push({ key: 'ek_probabilistic_box_time', label: t('val_model_ek_probabilistic_box_time'), cfg: ekProbabilisticBoxTimeConfig, sim: ekProbabilisticBoxTimeResult[0], pref: 2.5, strength: Math.round((ekGapProfile.longGapRate || 0) * 100) });
      if (data.reflectDmg) candidates.push({ key: 'ek_reflect_pressure', label: t('val_model_ek_reflect_pressure'), cfg: ekReflectPressureConfig, sim: ekReflectPressureResult[0], pref: 4.5, strength: 100 });
      candidates.push({ key: 'warm_carryover', label: t('val_model_warm_carryover'), cfg: warmCarryoverConfig, sim: warmCarryoverResult[0], pref: 5, strength: 100 });
    }
    const baselineErr = Math.abs((baselineResult[0].xph - data.xphReal) / data.xphReal * 100);
    const trustedXpErr = data.isPaladin
      ? Math.abs((rpSplitResult[0].xph - data.xphReal) / data.xphReal * 100)
      : baselineErr;
    const cycleModelKeys = ['rp_grenade_cycle_hybrid', 'rp_two_phase_cycle', 'rp_multi_pulse_cycle', 'rp_visible_latent_budget', 'rp_cadence_from_log', 'rp_grenade_peak_residual', 'rp_hit_target_coverage', 'rp_hit_target_cycle', 'mage_ue_cycle'];
    for (const c of candidates) {
      c.err = Math.abs((c.sim.xph - data.xphReal) / data.xphReal * 100);
      c.quickHist = collectSimHitDistribution(c.cfg, cycleModelKeys.includes(c.key) ? 6 : 12);
      c.histDist = histogramDistance(data.hitsPerTurn, c.quickHist);
      c.passXp = c.err <= trustedXpErr + 2;
      c.score = c.histDist - c.pref * 0.1;
    }
    const diagnostics = buildModelDiagnostics(data, candidates);
    for (const c of candidates) {
      if (Number.isFinite(c.diagnosticScore)) c.score = c.diagnosticScore - c.pref * 0.05;
    }
    // Modelos de artifício (forçam o número por construção: box inflado p/ alvo de hits,
    // replay da granada, orçamento latente por heurística) ficam fora do 'auto' — continuam
    // selecionáveis na mão e na tabela de diagnóstico, mas não vencem a escolha automática.
    const DIAGNOSTIC_ONLY = new Set(['rp_hit_target_coverage', 'rp_hit_target_cycle', 'rp_grenade_peak_residual', 'rp_visible_latent_budget']);
    candidates.forEach(c => { c.diagnosticOnly = DIAGNOSTIC_ONLY.has(c.key); });
    const passable = candidates.filter(c => c.passXp && !c.diagnosticOnly);
    passable.sort((a, b) => a.score - b.score);
    const selectedModel = ($('valModelSelect') && $('valModelSelect').value) || 'auto';
    const findCandidate = key => candidates.find(c => c.key === key) || null;
    const bestBy = pred => candidates.filter(pred).sort((a, b) => a.histDist - b.histDist)[0] || null;
    const manualChosen =
      selectedModel === 'baseline' ? candidates[0] :
      selectedModel === 'spawn' ? bestBy(c => c.key === 'visual') :
      selectedModel === 'distribution' ? bestBy(c => c.key === 'full' || c.key === 'hybrid' || c.key === 'rp_coverage') :
      selectedModel === 'screen' ? bestBy(c => c.key.indexOf('screen_') === 0) :
      selectedModel === 'flow_no_time' ? findCandidate('flow_no_time') :
      selectedModel === 'rp_avg' ? bestBy(c => c.key.indexOf('rp_distribution_') === 0) :
      selectedModel === 'rp_split' ? findCandidate('rp_split') :
      selectedModel === 'rp_grenade_cycle_hybrid' ? findCandidate('rp_grenade_cycle_hybrid') :
      selectedModel === 'rp_two_phase_cycle' ? findCandidate('rp_two_phase_cycle') :
      selectedModel === 'rp_multi_pulse_cycle' ? findCandidate('rp_multi_pulse_cycle') :
      selectedModel === 'rp_visible_latent_budget' ? findCandidate('rp_visible_latent_budget') :
      selectedModel === 'rp_cadence_from_log' ? findCandidate('rp_cadence_from_log') :
      selectedModel === 'rp_grenade_peak_residual' ? findCandidate('rp_grenade_peak_residual') :
      selectedModel === 'rp_hit_target_coverage' ? findCandidate('rp_hit_target_coverage') :
      selectedModel === 'rp_hit_target_cycle' ? findCandidate('rp_hit_target_cycle') :
      selectedModel === 'mage_ue_cycle' ? findCandidate('mage_ue_cycle') :
      selectedModel === 'ek_flow' ? findCandidate('ek_flow') :
      selectedModel === 'ek_reflect_pressure' ? findCandidate('ek_reflect_pressure') :
      selectedModel === 'ek_probabilistic_box_time' ? findCandidate('ek_probabilistic_box_time') :
      selectedModel === 'warm_carryover' ? findCandidate('warm_carryover') :
      selectedModel === 'ek_post_walk' ? { ...candidates[0], label: t('val_model_ek_post_walk') } :
      null;
    const chosen = manualChosen || passable[0] || candidates[0];
    const manualMode = selectedModel !== 'auto' && !!manualChosen;
    const bestCurveRejected = candidates
      .filter(c => c !== chosen && !c.passXp)
      .sort((a, b) => a.histDist - b.histDist)[0] || null;

    const chosenSimState = createValidatorSimState({
      aoeHitSamples: chosen.cfg.aoeHitSamples || [],
      reflectDmg: chosen.cfg.reflectDmg || 0,
      paladinArrowDmg: chosen.cfg.paladinArrowDmg || 0,
      coverageMode: chosen.cfg.coverageMode || 'none',
      aoeBoxP90: data.boxSizeP95 || 0,
      aoeCoverage: chosen.cfg.aoeCoverage || 1,
      boxVariance: chosen.cfg.boxVariance || 0,
      paladinArrowCoverage: chosen.cfg.paladinArrowCoverage || 1,
      paladinSpellCoverage: chosen.cfg.paladinSpellCoverage || 1,
      paladinRuneCoverage: chosen.cfg.paladinRuneCoverage || 1,
      paladinGrenadeCoverage: chosen.cfg.paladinGrenadeCoverage || 1,
      rpGrenadeMode: !!chosen.cfg.rpGrenadeMode,
      mageUeMode: !!chosen.cfg.mageUeMode,
      rpGrenadeDmg: chosen.cfg.rpGrenadeDmg || 0,
      rpGrenadeIntervalSeconds: chosen.cfg.rpGrenadeIntervalSeconds || 24,
      mageUeDmg: chosen.cfg.mageUeDmg || 0,
      mageUeIntervalSeconds: chosen.cfg.mageUeIntervalSeconds || 50,
      combatProfile: flags.profile,
      spawnCurve: chosen.cfg.spawnCurve || 2.0
    });
    currentSimState = chosenSimState;
    lastValidatorChosenConfig = {
      ...chosen.cfg,
      flags: { ...chosen.cfg.flags },
      baseDmgs: [...chosen.cfg.baseDmgs],
      aoeHitSamples: [...(chosen.cfg.aoeHitSamples || [])]
    };
    $('boxSize').value = chosen.cfg.boxSize;
    $('exitThreshold').value = chosen.cfg.exitThreshold;
    $('boxTime').value = chosen.cfg.boxChangeTime;
    data.selectedCoverageModeLabel = chosen.label;
    data.selectedCoverageStrength = chosen.strength;
    data.selectedScreenBoxSize = chosen.cfg.coverageMode === 'screen_ratio' ? chosen.cfg.boxSize : null;
    data.selectedAoeCoverage = chosen.cfg.coverageMode === 'screen_ratio' ? chosen.cfg.aoeCoverage : null;
    data.selectedBoxChangeTime = chosen.cfg.boxChangeTime;
    updateUI();
    renderValidatorExtracted(data);
    renderValidatorFunnel(data);
    runSim(chosenSimState);

    // Coleta distribuição de mobs acertados/turno da simulação escolhida (50 sessões de 1h = ~35k turnos).
    // Falha nessa sobreposição não pode impedir a tabela principal de comparação.
    try {
      lastSimHitsHist = collectSimHitDistribution(chosen.cfg, cycleModelKeys.includes(chosen.key) ? 16 : 50);
      renderValidatorHistogram(data, lastSimHitsHist);
    } catch (err) {
      console.error('[validator] simulated histogram failed', err);
      lastSimHitsHist = null;
    }

    // Pegamos resultado do nível +0 (parâmetros do log já são o "estado real")
    const sim = chosen.sim;
    sim.baselineXph = baselineResult[0].xph;
    sim.coverageXph = data.isPaladin ? null : visualResult[0].xph;
    sim.hybridXph = data.isPaladin ? null : hybridResult[0].xph;
    sim.screenCoverageXphs = screenResults.map((r, idx) => ({ coverage: screenConfigs[idx].aoeCoverage, xph: r[0].xph }));
    sim.usedAoeCalibration = (['hybrid', 'full', 'rp_coverage', 'rp_split', 'rp_grenade_cycle_hybrid', 'rp_two_phase_cycle', 'rp_multi_pulse_cycle', 'rp_visible_latent_budget', 'rp_cadence_from_log', 'rp_grenade_peak_residual', 'rp_hit_target_coverage', 'rp_hit_target_cycle'].includes(chosen.key) && !!(data.aoeHitSamples && data.aoeHitSamples.length)) || chosen.cfg.coverageMode === 'screen_ratio';
    sim.coverageModeLabel = chosen.label;
    sim.coverageDamageStrength = chosen.strength;
    sim.manualModel = manualMode;
    sim.histDist = chosen.histDist;
    if (data.isPaladin && data.rpComponentSeries && lastSimHitsHist && lastSimHitsHist.components) {
      sim.rpComponentDists = {
        arrow: histogramDistance(data.rpComponentSeries.arrowHitsPerTurn, lastSimHitsHist.components.arrow),
        spell: histogramDistance(data.rpComponentSeries.spellHitsPerTurn, lastSimHitsHist.components.spell),
        rune: histogramDistance(data.rpComponentSeries.runeHitsPerTurn, lastSimHitsHist.components.rune),
        grenade: histogramDistance(data.rpComponentSeries.grenadeHitsPerShot, lastSimHitsHist.components.grenade)
      };
    } else {
      sim.rpComponentDists = null;
    }
    sim.chosenKey = chosen.key;
    sim.diagnosticScore = chosen.diagnosticScore || 0;
    sim.modelDiagnostics = diagnostics;
    sim.critRateUsed = flags.crit ? 0.1 : 0;
    sim.critMultUsed = chosen.cfg.critMult || critMult;
    sim.charmRateUsed = flags.charm ? 0.1 : 0;
    sim.charmDmgUsed = chosen.cfg.charmDmg || 0;
    sim.reflectDmgUsed = chosen.cfg.reflectDmg || 0;
    sim.spawnCurveUsed = chosen.cfg.spawnCurve || 2.0;
    sim.runSeedUsed = chosen.cfg.runSeed || runSeed;
    sim.aoeCoverageUsed = chosen.cfg.aoeCoverage || 1;
    sim.boxVarianceUsed = chosen.cfg.boxVariance || 0;
    sim.paladinArrowCoverageUsed = chosen.cfg.paladinArrowCoverage || 1;
    sim.paladinSpellCoverageUsed = chosen.cfg.paladinSpellCoverage || 1;
    sim.rpGrenadeModeUsed = !!chosen.cfg.rpGrenadeMode;
    sim.mageUeModeUsed = !!chosen.cfg.mageUeMode;
    sim.specialTimingUsed = (sim.rpGrenadeModeUsed || sim.mageUeModeUsed) ? 'box cheia' : '—';
    sim.specialCastThresholdUsed = Math.max(1, Math.round(chosen.cfg.aoeBoxP90 || chosen.cfg.boxSize || data.boxSizeP95 || 1));
    sim.combatProfileUsed = flags.profile;
    sim.screenBoxSizeUsed = chosen.cfg.coverageMode === 'screen_ratio' ? chosen.cfg.boxSize : null;
    sim.boxChangeTimeUsed = chosen.cfg.boxChangeTime || data.boxChangeTime;
    sim.calibrationWorsenedXp = sim.usedAoeCalibration && chosen.err > baselineErr + 2;
    sim.manualModelWorsenedXp = manualMode && chosen.err > baselineErr + 2;
    sim.coverageWeakenedForXp = ['none', 'visual', 'rp_old', 'rp_spawn'].includes(chosen.key) && candidates.some(c => c !== candidates[0] && c.err > baselineErr + 2);
    sim.bestRejectedCoverageLabel = bestCurveRejected ? bestCurveRejected.label : '';
    try {
      renderValidatorFunnel(data, sim);
    } catch (err) {
      console.error('[validator] funnel failed', err);
    }
    renderValidatorComparison(data, sim);
    try {
      lastSimTemporalSeries = collectSimTemporalSeries(chosen.cfg, Math.min(260, Math.max(80, (data.temporalSeries || []).length)));
      renderValidatorTemporal(data, lastSimTemporalSeries);
    } catch (err) {
      console.error('[validator] simulated temporal failed', err);
      lastSimTemporalSeries = null;
      const el = $('valTemporalSummary');
      if (el) {
        el.style.display = 'block';
        el.innerHTML = '<strong>' + t('val_temporal_render_error') + ':</strong> ' + (err && err.message ? err.message : err);
      }
    }
    return {
      real: data,
      sim,
      chosen,
      state: chosenSimState,
      cfg: chosen.cfg,
      candidates,
      diagnostics,
      baseline: baselineResult[0],
      quickHist: lastSimHitsHist
    };
  }).catch(err => {
    console.error('[validator] comparison failed', err);
    $('valCompareStatus').textContent = (err && err.message ? err.message : err);
    throw err;
  }).finally(() => {
    $('btnRunComparison').disabled = false;
  });
}

function renderValidatorComparison(real, sim) {
  const fmtN = n => n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' :
                    n >= 1e3 ? (n / 1e3).toFixed(0) + 'k' :
                    Math.round(n).toString();
  const fmtPct = n => (n * 100).toFixed(1) + '%';
  const fmtMult = n => n.toFixed(2) + 'x';
  const fmtSpawn = n => {
    const label = n >= 1.35 ? 'front loaded' : n >= 0.85 ? 'gradual' : 'late loaded';
    return n.toFixed(2) + ' (' + label + ')';
  };

  // Calcular erros %
  const calcErr = (r, s) => r === 0 ? 0 : (s - r) / r * 100;

  const rows = [
    { metric: t('val_metric_xph'), real: real.xphReal, sim: sim.xph, fmt: fmtN, suffix: ' XP/h' },
    ...(sim.baselineXph ? [{ metric: real.isPaladin ? t('val_metric_xph_old_rp') : t('val_metric_xph_before'), real: real.xphReal, sim: sim.baselineXph, fmt: fmtN, suffix: ' XP/h', contextOnly: true }] : []),
    ...(sim.coverageXph ? [{ metric: t('val_metric_xph_coverage'), real: real.xphReal, sim: sim.coverageXph, fmt: fmtN, suffix: ' XP/h', contextOnly: true }] : []),
    ...(sim.hybridXph ? [{ metric: t('val_metric_xph_hybrid'), real: real.xphReal, sim: sim.hybridXph, fmt: fmtN, suffix: ' XP/h', contextOnly: true }] : []),
    { metric: t('val_metric_crit_rate'), real: real.critRateObserved || 0, sim: sim.critRateUsed || 0, fmt: fmtPct, suffix: '', contextOnly: true },
    { metric: t('val_metric_crit_mult'), real: real.critMultObserved || 0, sim: sim.critMultUsed || CRIT_BASE, fmt: fmtMult, suffix: '', contextOnly: true },
    { metric: t('val_metric_charm_rate'), real: real.charmRateObserved || 0, sim: sim.charmRateUsed || 0, fmt: fmtPct, suffix: '', contextOnly: true },
    { metric: t('val_metric_charm_dmg'), real: real.avgCharm || 0, sim: sim.charmDmgUsed || 0, fmt: n => Math.round(n).toString(), suffix: '', contextOnly: true },
    ...(!real.isPaladin && !real.isMage && real.reflectDmg ? [{ metric: t('val_metric_reflect_dmg'), real: real.reflectDmg || 0, sim: sim.reflectDmgUsed || 0, fmt: n => Math.round(n).toString(), suffix: '', contextOnly: true }] : []),
    { metric: t('val_metric_spawn_curve'), real: real.spawnCurve || 2.0, sim: sim.spawnCurveUsed || 2.0, fmt: fmtSpawn, suffix: '', contextOnly: true },
    { metric: t('val_metric_box_time_used'), real: real.boxChangeTime || 0, sim: sim.boxChangeTimeUsed || 0, fmt: n => Math.round(n) + 's', suffix: '', contextOnly: true }
  ];

  let html = '<table class="val-compare-table"><thead><tr>' +
    '<th>' + t('val_compare_metric') + '</th>' +
    '<th>' + t('val_compare_real') + '</th>' +
    '<th>' + t('val_compare_sim') + '</th>' +
    '<th>' + t('val_compare_err') + '</th>' +
    '</tr></thead><tbody>';

  let maxAbsErr = 0;
  for (const r of rows) {
    const err = calcErr(r.real, r.sim);
    const absErr = Math.abs(err);
    if (!r.contextOnly) maxAbsErr = Math.max(maxAbsErr, absErr);
    const errCls = absErr <= 15 ? 'err-good' : absErr <= 25 ? 'err-warn' : 'err-bad';
    const errStr = (err >= 0 ? '+' : '') + err.toFixed(1) + '%';
    html += '<tr>' +
      '<td>' + r.metric + '</td>' +
      '<td class="real-col">' + r.fmt(r.real) + r.suffix + '</td>' +
      '<td class="sim-col">' + r.fmt(r.sim) + r.suffix + '</td>' +
      '<td class="' + errCls + '">' + errStr + '</td>' +
      '</tr>';
  }
  // Linha bonus: turnos médios por box (só simulado, real é difícil de medir confiável)
  const boxMeanUsed = sim.screenBoxSizeUsed || real.boxSizeP95;
  const boxVarianceUsed = sim.boxVarianceUsed || 0;
  const boxRangeUsed = Math.max(1, Math.round(boxMeanUsed - boxVarianceUsed)) + '&ndash;' + Math.round(boxMeanUsed + boxVarianceUsed);
  const coverageUsed = real.isPaladin && sim.coverageModeLabel && sim.coverageModeLabel.indexOf('arrow') >= 0
    ? ((sim.paladinArrowCoverageUsed || 1) * 100).toFixed(0) + '% / ' + ((sim.paladinSpellCoverageUsed || 1) * 100).toFixed(0) + '%'
    : ((sim.aoeCoverageUsed || 1) * 100).toFixed(0) + '%';
  const funnelDiag = buildBoxMeaningDiagnostics(real, sim);
  const diagRows = [
    { metric: t('val_card_vocation'), sim: real.isMage ? t('voc_mage') : (real.isPaladin ? t('voc_rp') : t('voc_ek')) },
    { metric: t('val_metric_model'), sim: sim.coverageModeLabel || 'auto' },
    { metric: t('val_metric_seed'), sim: String(sim.runSeedUsed || 'â€”') },
    { metric: t('val_metric_hist_dist'), sim: (sim.histDist || 0).toFixed(1) },
    { metric: t('val_metric_coverage_used'), sim: coverageUsed },
    { metric: t('val_metric_box_mean'), sim: boxMeanUsed.toFixed(2) },
    { metric: t('val_metric_box_range'), sim: boxRangeUsed },
    { metric: t('val_metric_population'), sim: funnelDiag.population.toFixed(2) },
    { metric: t('val_metric_reachable'), sim: funnelDiag.reachable.toFixed(2) },
    { metric: t('val_metric_expected_hits'), sim: funnelDiag.expectedHits.toFixed(2) },
    ...((real.isPaladin || real.isMage) ? [
      { metric: t('val_card_special_timing'), sim: sim.specialTimingUsed || '—' },
      { metric: t('val_card_special_threshold'), sim: String(sim.specialCastThresholdUsed || real.specialCastThreshold || real.boxSizeP95 || 1) }
    ] : []),
    ...(real.isPaladin ? [
      { metric: t('val_metric_arrow_spell_hits'), sim: funnelDiag.arrowHits.toFixed(2) + ' / ' + funnelDiag.spellHits.toFixed(2) },
      ...(sim.rpComponentDists ? [{ metric: t('val_metric_rp_component_dist'), sim: 'arrow ' + sim.rpComponentDists.arrow.toFixed(1) + ' · spell ' + sim.rpComponentDists.spell.toFixed(1) + ' · grenade ' + sim.rpComponentDists.grenade.toFixed(1) }] : []),
      { metric: t('val_card_rp_grenade'), sim: (sim.rpGrenadeModeUsed ? 'ON' : 'OFF') + ' · ' + (real.rpGrenadePairCount || 0) + ' pares · ~' + (real.rpGrenadeIntervalSeconds || 24) + 's' }
    ] : []),
    ...(real.isMage ? [
      { metric: t('val_card_mage_ue'), sim: (sim.mageUeModeUsed ? 'ON' : 'OFF') + ' · ' + Math.round(real.mageUeDmg || 0) + ' · ~' + (real.mageUeIntervalSeconds || 50) + 's' },
      { metric: t('val_card_ue_cooldown'), sim: '4s' }
    ] : []),
    ...(!real.isPaladin && !real.isMage ? [{ metric: t('val_card_post_walk_spawn'), sim: real.intelDetected === false ? '3 ondas · 30/65/100%' : '—' }] : [])
  ];
  for (const r of diagRows) {
    html += '<tr>' +
      '<td>' + r.metric + '</td>' +
      '<td class="real-col" style="opacity:0.5">&mdash;</td>' +
      '<td class="sim-col">' + r.sim + '</td>' +
      '<td style="opacity:0.5">&mdash;</td>' +
      '</tr>';
  }
  html += '<tr>' +
    '<td>' + t('val_metric_avg_turns') + '</td>' +
    '<td class="real-col" style="opacity:0.5">—</td>' +
    '<td class="sim-col">' + sim.avgTurns.toFixed(2) + '</td>' +
    '<td style="opacity:0.5">—</td>' +
    '</tr>';
  html += '</tbody></table>';
  html += renderModelDiagnosticsTable(sim.modelDiagnostics, sim.chosenKey);
  html += renderRpMethodologyTable(real, sim);

  if (sim.coverageModeLabel) {
    html += '<div class="val-note" style="margin-top:10px">' +
      '<strong>' + t('val_metric_seed') + ':</strong> ' + (sim.runSeedUsed || 'â€”') +
      ' Â· ' + t('val_seed_note') + '<br>' +
      '<strong>' + t('val_card_coverage_mode') + ':</strong> ' + sim.coverageModeLabel +
      ' · <strong>' + t('val_card_coverage_strength') + ':</strong> ' + (sim.coverageDamageStrength || 0) + '%' +
      '<br><strong>' + t('val_metric_hist_dist') + ':</strong> ' + (sim.histDist || 0).toFixed(1) +
      ' · <strong>' + t('val_metric_coverage_used') + ':</strong> ' + ((sim.aoeCoverageUsed || 1) * 100).toFixed(0) + '%' +
      ' · <strong>' + t('val_metric_box_mean') + ':</strong> ' + (sim.screenBoxSizeUsed || real.boxSizeP95).toFixed(2) +
      ' · <strong>' + t('val_metric_box_range') + ':</strong> ' + Math.max(1, Math.round((sim.screenBoxSizeUsed || real.boxSizeP95) - (sim.boxVarianceUsed || 0))) + '–' + Math.round((sim.screenBoxSizeUsed || real.boxSizeP95) + (sim.boxVarianceUsed || 0)) +
      (real.isPaladin ? '<br><strong>' + t('val_card_arrow_coverage') + ':</strong> ' + ((sim.paladinArrowCoverageUsed || 1) * 100).toFixed(0) + '%' + ' · <strong>' + t('val_card_spell_coverage') + ':</strong> ' + ((sim.paladinSpellCoverageUsed || 1) * 100).toFixed(0) + '%' : '') +
      (sim.manualModelWorsenedXp ? '<br>' + t('val_manual_model_warn') : '') +
      (sim.coverageWeakenedForXp ? '<br>' + t('val_coverage_preserved_xp') : '') +
      (sim.bestRejectedCoverageLabel ? '<br>' + t('val_coverage_best_rejected').replace('{m}', sim.bestRejectedCoverageLabel) : '') +
      '</div>';
  }

  html += '<div style="margin-top:10px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
    '<button id="btnValidatorHuntLog" style="background:var(--blue);color:#fff">' + t('val_open_hunt_log') + '</button>' +
    '</div>';

  // Veredito
  let verdictCls, verdictMsg;
  if (sim.calibrationWorsenedXp) {
    verdictCls = 'warn';
    verdictMsg = t('val_verdict_curve_worse_xp');
  } else if (maxAbsErr <= 15) {
    verdictCls = 'ok';
    verdictMsg = t('val_verdict_ok');
  } else if (maxAbsErr <= 25) {
    verdictCls = 'warn';
    verdictMsg = sim.usedAoeCalibration ? t('val_verdict_curve_xp_warn') : t('val_verdict_warn');
  } else {
    verdictCls = 'bad';
    verdictMsg = sim.usedAoeCalibration ? t('val_verdict_curve_xp_warn') : t('val_verdict_bad');
  }
  const icons = { ok: '✓', warn: '⚠', bad: '✗' };
  html += '<div class="val-verdict ' + verdictCls + '">' +
    '<span class="val-verdict-icon">' + icons[verdictCls] + '</span>' +
    '<span>' + verdictMsg + '</span>' +
    '</div>';

  $('valComparison').innerHTML = html;
  const logBtn = $('btnValidatorHuntLog');
  if (logBtn) {
    logBtn.addEventListener('click', () => {
      if (!lastValidatorChosenConfig) return;
      openLogModal(lastValidatorChosenConfig, { top: true });
    });
  }
}
