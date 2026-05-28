function parseServerLog(logText, isPaladin, combatProfile = null) {
  const isMage = combatProfile === 'mage';
  const lines = logText.split(/\r?\n/);

  // Padrões — capturar o que importa
  // Aceita "A foo", "An foo", "The foo" + nomes com hífen/apóstrofo
  const tsPattern = /^(\d{2}):(\d{2}):(\d{2})\s+(.+)$/;
  const attackPattern = /(?:A|An|The)\s+([A-Za-z][A-Za-z\s'\-]+?)\s+loses\s+(\d+)\s+hitpoints\s+due to your\s+(critical attack|attack)\b\.?\s*(\([^)]*\))?/i;
  const xpPattern = /You gained\s+(\d+)\s+experience(?:\s+points?)?\s*(\([^)]*\))?/;
  const runeUsePattern = /Using one of \d+\s+(.+?)\s+runes?\b/i;

  // Crit-charms (Tibia Winter Update 2024): aumentam o dano de crítico em AOE.
  // Entram na média PONDERADA com crits puros pra calcular o multiplicador efetivo.
  // Não contam como charm individual — sempre vêm com "critical attack" no log.
  const CRIT_CHARM_RE = /low blow|savage blow/i;

  // Categorias de eventos
  const events = []; // {ts, type, mob?, dmg?, isCrit?, isPrey?, xp?}
  let totalLines = 0;
  let timestampedLines = 0;

  for (const line of lines) {
    totalLines++;
    const m = tsPattern.exec(line);
    if (!m) continue;
    timestampedLines++;
    const ts = +m[1] * 3600 + +m[2] * 60 + +m[3];
    const body = m[4];

    // Tentar match de ataque (cobre 100% dos hits, com ou sem suffix)
    const a = attackPattern.exec(body);
    if (!a) {
      const runeUse = runeUsePattern.exec(body);
      if (runeUse) {
        const rune = normalizeRuneName(runeUse[1]);
        events.push({ ts, type: 'rune', rune, element: getRuneElement(rune) });
        continue;
      }
      const x = xpPattern.exec(body);
      if (x) {
        const xpSuffix = x[2] || '';
        // Prey de XP: aparece como "(active prey bonus, ...)" no event de XP.
        // Diferente do prey de atk (suffix em hit). Afeta apenas XP recebido,
        // não dano causado. Marcamos pra mostrar status na UI sem mudar cálculo.
        const xpHasPrey = /active prey bonus/i.test(xpSuffix);
        events.push({ ts, type: 'xp', xp: +x[1], xpHasPrey });
      }
      continue;
    }

    const isCrit = /critical/i.test(a[3]);
    const suffix = a[4] || '';
    const isPrey = /prey/i.test(suffix);
    const isReflection = /damage reflection/i.test(suffix);
    const hasCharm = /charm/i.test(suffix);
    const hasCritCharm = CRIT_CHARM_RE.test(suffix);
    // Onslaught: runa especial que causa dano de "burst". Mecanicamente atua
    // como um crit (multiplicador de dano alto, frequência baixa). Vem como
    // suffix sem "critical attack" na linha. Tratamos como crit pra que entre
    // na média ponderada do crit multiplier.
    const hasOnslaught = /\bOnslaught\b/i.test(suffix);
    // Bounty Talisman: item externo (talisman) que dá bônus de dano em mobs
    // específicos. Igual ao prey de atk: bônus em UM mob da hunt, não no DPS
    // base. Tratamos como prey pra excluir do dmgCycle "limpo".
    const hasBountyTalisman = /Bounty Talisman/i.test(suffix);
    const mob = a[1].toLowerCase().trim();
    const dmg = +a[2];

    // Reflection puro (sem charm útil): hit passivo do escudo do jogador.
    // Ignorar completamente — não é ataque ativo. Mas se vem com parry charm,
    // o dano do parry conta como charm individual (cai no else abaixo).
    if (isReflection && !hasCharm) {
      events.push({ ts, type: 'reflect', mob, dmg });
      continue;
    }

    // Bounty Talisman conta como prey (modificador de dano em mobs específicos).
    // Marca isPrey=true seja qual for a classificação final do hit.
    const isPreyEffective = isPrey || hasBountyTalisman;

    // Crit-charms (low blow, savage blow) OU Onslaught: tratar como crit normal.
    // Crit-charms já são capturados pelo isCrit do regex; Onslaught entra aqui
    // mesmo quando a linha não diz "critical attack". Ambos entram na média
    // ponderada de crit.
    if (hasCritCharm || hasOnslaught) {
      events.push({ ts, type: 'crit', mob, dmg, isPrey: isPreyEffective });
      continue;
    }

    // Qualquer outro charm (overpower, overflux, parry, curse, poison, wound,
    // freeze, zap, enflame, divine wrath, carnage...): hit individual em 1 mob.
    // Conta pro charm rate e dano médio do charm. Marcamos isPassive=true pro
    // parry (vem com damage reflection) pra distinguir, embora ambos contem.
    if (hasCharm) {
      events.push({
        ts, type: 'charm', mob, dmg,
        isPassive: isReflection
      });
      continue;
    }

    // Ataque normal ou crit puro (sem charm)
    events.push({
      ts, type: isCrit ? 'crit' : 'normal',
      mob, dmg, isPrey: isPreyEffective
    });
  }
  events.forEach((e, idx) => { e.seq = idx; });

  const attackEventsAll = events.filter(e => e.type === 'normal' || e.type === 'crit');
  const charmEventsAll = events.filter(e => e.type === 'charm');
  const reflectEventsAll = events.filter(e => e.type === 'reflect');
  const xpEventsAll = events.filter(e => e.type === 'xp');
  const runeEventsAll = events.filter(e => e.type === 'rune');

  // Validação: precisa ter ataques E mortes pra simular
  if (attackEventsAll.length < 20 || xpEventsAll.length < 5) {
    return {
      error: 'log_too_short',
      eventCount: events.length,
      totalLines,
      timestampedLines,
      attackCount: attackEventsAll.length,
      charmCount: charmEventsAll.length,
      reflectCount: reflectEventsAll.length,
      xpCount: xpEventsAll.length
    };
  }

  // Stats
  const attackEvents = attackEventsAll;
  const charmEvents = charmEventsAll;
  const reflectEvents = reflectEventsAll;
  const xpEvents = xpEventsAll;
  const runeEvents = runeEventsAll;

  // Duração total
  const tsList = events.map(e => e.ts);
  let duration = Math.max(...tsList) - Math.min(...tsList);
  if (duration < 0) duration += 86400; // virada de meia-noite
  duration = Math.max(duration, 1);

  // XP total e por morte
  const totalXp = xpEvents.reduce((s, e) => s + e.xp, 0);
  const totalKills = xpEvents.length;
  const xphReal = totalXp / (duration / 3600);
  const avgXpPerKill = totalKills > 0 ? totalXp / totalKills : 0;

  // Dano total e médios
  const dmgTotal = attackEvents.reduce((s, e) => s + e.dmg, 0) +
                   charmEvents.reduce((s, e) => s + e.dmg, 0) +
                   reflectEvents.reduce((s, e) => s + e.dmg, 0);

  // Dano normal SEM prey, SEM charm, SEM crit — pra estimar dano base do ciclo
  const cleanNormals = attackEvents.filter(e => e.type === 'normal' && !e.isPrey).map(e => e.dmg);
  const cleanCrits = attackEvents.filter(e => e.type === 'crit' && !e.isPrey).map(e => e.dmg);
  const allCharms = charmEvents.map(e => e.dmg);

  // Hits COM prey (pra calcular o multiplicador efetivo)
  const preyNormals = attackEvents.filter(e => e.type === 'normal' && e.isPrey).map(e => e.dmg);

  const avgNormal = cleanNormals.length > 0 ? mean(cleanNormals) : 0;
  const avgCrit = cleanCrits.length > 0 ? mean(cleanCrits) : 0;
  const avgCharm = allCharms.length > 0 ? mean(allCharms) : 0;
  const reflectDmgObserved = reflectEvents.length > 0 ? Math.round(median(reflectEvents.map(e => e.dmg))) : 0;
  const avgPreyNormal = preyNormals.length > 0 ? mean(preyNormals) : 0;

  // Calcular multiplicador efetivo do prey:
  // - Em quantos % dos ataques normais o prey estava ativo?
  // - Qual o multiplicador médio quando ativo? (avgPreyNormal / avgNormal)
  // - Fator efetivo = 1 + preyRate × (preyMult - 1)
  const totalNormalLikeHits = cleanNormals.length + preyNormals.length;
  const preyRate = totalNormalLikeHits > 0 ? preyNormals.length / totalNormalLikeHits : 0;
  const preyMult = avgNormal > 0 && avgPreyNormal > 0 ? avgPreyNormal / avgNormal : 1;
  const preyEffectiveFactor = preyRate > 0 ? 1 + preyRate * (preyMult - 1) : 1;

  // Prey de XP: detectado em events de XP com "(active prey bonus)".
  // Diferente do prey de atk (suffix em hit ofensivo). Não muda cálculo de
  // dano — só sinaliza na UI que prey está ativa pra evitar confusão quando
  // preyRate=0% mas o jogador tem prey configurada.
  const xpEventsWithPrey = xpEvents.filter(e => e.xpHasPrey).length;
  const preyXpActive = xpEvents.length > 0 && xpEventsWithPrey / xpEvents.length > 0.5;

  // Crit rate observado
  const totalAttacks = attackEvents.length;
  const totalCrits = cleanCrits.length + attackEvents.filter(e => e.type === 'crit' && e.isPrey).length;
  const critRateObserved = totalAttacks > 0 ? totalCrits / totalAttacks : 0;
  const critMultObserved = avgNormal > 0 && avgCrit > 0 ? avgCrit / avgNormal : 0;

  // Charm rate observado
  const charmRateObserved = totalAttacks > 0 ? charmEvents.length / totalAttacks : 0;

  // ===== TURNOS =====
  // Agrupar ataques em turnos mecânicos do jogo. Regras:
  //  1. Hits no MESMO segundo = mesmo turno
  //  2. Hits em segundos CONSECUTIVOS (ex: s5 e s6) = mesmo turno
  //     (timestamp do log tem resolução de 1s, mas mecânica em ms — um turno
  //      mecânico que acontece próximo da fronteira de segundo pode espalhar
  //      seus hits em 2 segundos consecutivos no log)
  //  3. Mas o cooldown mecânico mínimo é 2s. Então 3+ segundos consecutivos
  //     com hits são MÚLTIPLOS turnos: agrupar de 2 em 2 contando do início.
  //     Ex: s10, s11, s12 → turno A (s10+s11), turno B (s12)
  //         s10, s11, s12, s13 → turno A (s10+s11), turno B (s12+s13)
  //  4. Gap ≥ 2s entre segundos com hits = quebra de bloco contínuo
  //
  // EXCLUSÕES:
  //  - Damage reflection puro: já filtrado antes (não vira event)
  //  - Parry charm (isPassive=true): hit reativo ao escudo receber dano,
  //    não é turno ativo do jogador. Excluído daqui mas conta pro charm rate.
  const TURN_DURATION_SEC = 2.0;
  // Para o histograma, queremos "mobs acertados pela rotação principal", não
  // linhas ofensivas brutas do server log. Charms continuam entrando nas métricas
  // de charm, mas não inflam box size/ponto de saída.
  const sortedAttacks = [...attackEvents].sort((a, b) => (a.ts - b.ts) || ((a.seq || 0) - (b.seq || 0)));
  let turns = [];
  const turnsMap = {};
  if (sortedAttacks.length > 0) {
    // Passo 1: agrupar hits em "blocos contínuos" (sequências de segundos
    // consecutivos com hits, separadas por gap ≥ 2s).
    const blocks = []; // cada block é array de hits ordenados por ts
    let curBlock = [sortedAttacks[0]];
    let prevTs = sortedAttacks[0].ts;
    for (let i = 1; i < sortedAttacks.length; i++) {
      const ev = sortedAttacks[i];
      if (ev.ts - prevTs < 2) {
        curBlock.push(ev);
      } else {
        blocks.push(curBlock);
        curBlock = [ev];
      }
      prevTs = ev.ts;
    }
    blocks.push(curBlock);

    // Passo 2: dentro de cada bloco contínuo, dividir em turnos mecânicos.
    // Um turno = pareando segundos do bloco (ts0 = primeiro segundo, depois
    // hits cujo ts está em [ts0, ts0+1] formam o turno; depois ts0+=2 e repete).
    for (const block of blocks) {
      const blockStartTs = block[0].ts;
      let turnStartTs = blockStartTs;
      let curTurn = [];
      for (const ev of block) {
        // Se o hit cabe no turno atual (dentro de 2s do início), adiciona
        if (ev.ts - turnStartTs < 2) {
          curTurn.push(ev);
        } else {
          // Hit pertence a um novo turno mecânico. Avança turnStartTs em 2s
          // até englobar o ev.ts (cobre casos de pular segundos).
          turns.push(curTurn);
          while (ev.ts - turnStartTs >= 2) turnStartTs += 2;
          curTurn = [ev];
        }
      }
      if (curTurn.length > 0) turns.push(curTurn);
    }

    // turnsMap por índice sequencial pro método de transição
    for (let i = 0; i < turns.length; i++) turnsMap[i] = turns[i];
  }

  // turns.length agora é o número de turnos efetivos (clustering por segundos
  // consecutivos é fiel ao turno mecânico real). Mantemos effectiveTurnsCount
  // como alias pra compatibilidade com o card de "turnos efetivos/h".
  const effectiveTurnsCount = turns.length;

  // Mobs acertados por turno:
  // • Paladino: 2 ataques em área por turno → ataques ÷ 2 = mobs
  // • Não-paladino: auto attack single target + spell AoE → remove 1 auto
  // Charms não entram aqui; eles são dano extra individual, não mob adicional
  // acertado pela rotação principal.
  const rawTurnHits = turns.map(t => t.filter(e => e.type === 'normal' || e.type === 'crit').length);
  const rpGrenadeMarks = new Array(rawTurnHits.length).fill(null);
  if (isPaladin && rawTurnHits.length >= 12) {
    const nonZero = rawTurnHits.filter(v => v > 0);
    const center = nonZero.length ? median(nonZero) : 0;
    let pairs = 0;
    for (let i = 0; i < rawTurnHits.length - 1; i++) {
      if (rpGrenadeMarks[i] || rpGrenadeMarks[i + 1]) continue;
      const low = rawTurnHits[i], high = rawTurnHits[i + 1];
      const looksLowHigh = center > 0 && low <= center * 0.75 && high >= center * 1.25 && high >= low * 1.8;
      if (looksLowHigh) {
        rpGrenadeMarks[i] = 'cast';
        rpGrenadeMarks[i + 1] = 'explode';
        pairs++;
        i++;
      }
    }
  }
  const rpGrenadePairCount = rpGrenadeMarks.filter(v => v === 'cast').length;
  const firstTurnTs = turns.length ? turns[0][0].ts : 0;
  const groupEventsByTurn = (srcEvents) => {
    const grouped = turns.map(() => []);
    let idx = 0;
    const sorted = srcEvents.slice().sort((a, b) => a.ts - b.ts);
    for (const ev of sorted) {
      while (idx < turns.length && ev.ts >= turns[idx][0].ts + 2) idx++;
      if (idx < turns.length && ev.ts >= turns[idx][0].ts && ev.ts < turns[idx][0].ts + 2) {
        grouped[idx].push(ev);
      }
    }
    return grouped;
  };
  const xpByTurn = groupEventsByTurn(xpEvents);
  const charmByTurn = groupEventsByTurn(charmEvents);
  const reflectByTurn = groupEventsByTurn(reflectEvents);
  const normalizeCombatDamage = e => {
    let dmg = e.dmg || 0;
    if (e.type === 'crit' && critMultObserved > 0) dmg /= critMultObserved;
    if (e.isPrey && preyMult > 1) dmg /= preyMult;
    return dmg;
  };
  const mageTurnMeta = turns.map(t => {
    const hits = t
      .filter(e => e.type === 'normal' || e.type === 'crit')
      .sort((a, b) => (a.ts - b.ts) || ((a.seq || 0) - (b.seq || 0)));
    if (!isMage || hits.length === 0) {
      return { autoEvents: [], spellEvents: hits, ueEvents: [], isUe: false, autoDmg: 0, spellHits: hits.length, ueHits: 0, spellDamage: 0, lockoutGap: 0 };
    }
    const vals = hits.map(e => ({ ev: e, normalized: normalizeCombatDamage(e) }));
    const positive = vals.map(v => v.normalized).filter(v => v > 0);
    const localMedian = median(positive);
    const localMax = positive.length ? Math.max(...positive) : 0;
    const first = vals[0];
    const firstLooksAuto = hits.length >= 2 && first.normalized > 0 && localMedian > 0 && first.normalized <= localMedian * 0.45;
    const autoEvents = firstLooksAuto ? [first.ev] : [];
    const afterAuto = firstLooksAuto ? vals.slice(1) : vals;
    const spellPool = afterAuto.map(v => v.normalized).filter(v => v > 0);
    const spellMedian = median(spellPool);
    const spellDamage = spellPool.reduce((s, v) => s + v, 0);
    const localOutlierScore = spellMedian > 0 && spellPool.length ? Math.max(...spellPool) / spellMedian : 0;
    return {
      autoEvents,
      spellEvents: afterAuto.map(v => v.ev),
      ueEvents: [],
      isUe: false,
      autoDmg: autoEvents.length ? normalizeCombatDamage(autoEvents[0]) : 0,
      spellHits: afterAuto.length,
      ueHits: 0,
      spellDamage,
      spellMedian,
      localMax,
      localOutlierScore,
      lockoutGap: 0
    };
  });
  if (isMage) {
    const mageSpellDamages = mageTurnMeta.map(m => m.spellDamage || 0).filter(v => v > 0);
    const mageSpellHits = mageTurnMeta.map(m => m.spellHits || 0).filter(v => v > 0);
    const baseSpellDamage = median(mageSpellDamages) || 1;
    const baseSpellHits = median(mageSpellHits) || 1;
    const highSpellHits = Math.max(4, Math.ceil(percentile(mageSpellHits, 0.75) || baseSpellHits));
    for (let idx = 0; idx < mageTurnMeta.length; idx++) {
      const meta = mageTurnMeta[idx];
      if (!meta || !meta.spellEvents || meta.spellEvents.length === 0) continue;
      const curTurn = turns[idx];
      const nextTurn = turns[idx + 1];
      const nextGap = curTurn && nextTurn ? nextTurn[0].ts - curTurn[0].ts : 0;
      const lockoutStrong = nextGap >= 3.5;
      const damageScore = (meta.spellDamage || 0) / baseSpellDamage;
      const areaScore = (meta.spellHits || 0) / baseSpellHits;
      const burstStrong = damageScore >= 1.6 || meta.localOutlierScore >= 2.0;
      const areaStrong = meta.spellHits >= highSpellHits && areaScore >= 1.05;
      const lowHpCompatible = meta.spellHits >= highSpellHits && damageScore >= 0.55;
      const isUe = lockoutStrong && (burstStrong || areaStrong || lowHpCompatible);
      meta.lockoutGap = nextGap;
      meta.damageScore = damageScore;
      meta.areaScore = areaScore;
      if (!isUe) continue;
      const vals = meta.spellEvents.map(e => ({ ev: e, normalized: normalizeCombatDamage(e) }));
      const spellMedian = median(vals.map(v => v.normalized).filter(v => v > 0));
      const ueEvents = meta.localOutlierScore >= 1.75 && spellMedian > 0
        ? vals.filter(v => v.normalized >= spellMedian * 1.5).map(v => v.ev)
        : vals.map(v => v.ev);
      const ueSet = new Set(ueEvents);
      meta.ueEvents = ueEvents;
      meta.spellEvents = meta.spellEvents.filter(e => !ueSet.has(e));
      meta.isUe = true;
      meta.spellHits = meta.spellEvents.length;
      meta.ueHits = meta.ueEvents.length;
    }
  }
  const rpPeakResidualDiag = isPaladin
    ? extractRpGrenadePeakResidual(rawTurnHits.map((raw, idx) => ({
        rawAttackHits: raw,
        rpGrenade: rpGrenadeMarks[idx]
      })))
    : null;
  const rpNormalRotationRaw = rpPeakResidualDiag
    ? Math.max(1, Math.round(rpPeakResidualDiag.normalP75Raw || rpPeakResidualDiag.normalMedianRaw || 0))
    : 0;
  const turnStats = turns.map((t, idx) => {
    const rawAttackHits = rawTurnHits[idx];
    let mobsHit;
    if (isPaladin) {
      mobsHit = Math.max(0, rawAttackHits);
    } else if (isMage) {
      mobsHit = Math.max(0, (mageTurnMeta[idx] && (mageTurnMeta[idx].spellHits + mageTurnMeta[idx].ueHits)) || rawAttackHits);
    } else {
      mobsHit = Math.max(0, rawAttackHits - 1);
    }
    const turnXpEvents = xpByTurn[idx] || [];
    const turnCharmEvents = charmByTurn[idx] || [];
    const turnReflectEvents = reflectByTurn[idx] || [];
    const damageTotal = t.reduce((s, e) => s + (e.dmg || 0), 0) +
      turnCharmEvents.reduce((s, e) => s + (e.dmg || 0), 0) +
      turnReflectEvents.reduce((s, e) => s + (e.dmg || 0), 0);
    let componentHits;
    if (isPaladin) {
      componentHits = {
        arrow: 0,
        spell: 0,
        rune: 0,
        grenade: rpGrenadeMarks[idx] === 'explode'
          ? Math.max(0, Math.round(rawAttackHits - rpNormalRotationRaw))
          : 0
      };
    } else if (isMage) {
      componentHits = {
          auto: mageTurnMeta[idx] && mageTurnMeta[idx].autoEvents.length ? 1 : 0,
          spell: mageTurnMeta[idx] ? mageTurnMeta[idx].spellHits : mobsHit,
          ue: mageTurnMeta[idx] ? mageTurnMeta[idx].ueHits : 0
      };
    } else {
      componentHits = {
        auto: rawAttackHits > 0 ? 1 : 0,
        spell: mobsHit,
        reflect: 0
      };
    }
    return {
      ts: t[0].ts,
      relTime: Math.max(0, t[0].ts - firstTurnTs),
      rawAttackHits,
      mobsHit,
      rpGrenade: rpGrenadeMarks[idx],
      special: isMage && mageTurnMeta[idx] && mageTurnMeta[idx].isUe ? 'ue' : null,
      xp: turnXpEvents.reduce((s, e) => s + e.xp, 0),
      kills: turnXpEvents.length,
      damage: damageTotal,
      normalHits: t.filter(e => e.type === 'normal').length,
      critHits: t.filter(e => e.type === 'crit').length,
      components: componentHits
    };
  });
  const rpElementalPreyMult = isPaladin && attackEvents.some(e => e.isPrey) ? 1.25 : preyMult;
  const rpElementalCorrection = isPaladin
    ? correctRpComponentsByElement(turns, turnStats, runeEvents, critMultObserved, rpElementalPreyMult)
    : { retagged: 0, ambiguous: 0, missingMod: 0, total: 0 };
  if (isPaladin) {
    for (const stat of turnStats) {
      const c = stat.components || {};
      const totalComponentHits = Math.max(0, Math.round(
        (c.arrow || 0) + (c.spell || 0) + (c.rune || 0) + (c.grenade || 0)
      ));
      stat.mobsHit = totalComponentHits;
      stat.totalHits = totalComponentHits;
    }
  }
  const rpGrenadeShare = turnStats.length ? turnStats.filter(t => t.rpGrenade).length / turnStats.length : 0;
  const rpGrenadeConfidence = rpGrenadePairCount >= 6 ? 'strong' : (rpGrenadePairCount >= 2 ? 'weak' : 'none');
  const rpGrenadeCastTs = turnStats.filter(t => t.rpGrenade === 'cast').map(t => t.ts);
  const rpGrenadeIntervals = [];
  for (let i = 1; i < rpGrenadeCastTs.length; i++) {
    const gap = rpGrenadeCastTs[i] - rpGrenadeCastTs[i - 1];
    if (gap >= 14) rpGrenadeIntervals.push(gap);
  }
  const rpGrenadeIntervalObserved = rpGrenadeIntervals.length ? Math.round(median(rpGrenadeIntervals)) : 24;
  const rpGrenadeIntervalSeconds = Math.max(14, rpGrenadeIntervalObserved || 24);
  let mageUeIntervalSeconds = 50;
  if (isMage) {
    const ueTs = mageTurnMeta.filter(m => m.isUe && m.ueEvents.length).map(m => m.ueEvents[0].ts);
    const ueGaps = [];
    for (let i = 1; i < ueTs.length; i++) {
      const gap = ueTs[i] - ueTs[i - 1];
      if (gap >= 36) ueGaps.push(gap);
    }
    if (ueGaps.length) mageUeIntervalSeconds = Math.max(36, Math.round(median(ueGaps)));
  }
  const autoAttackEvents = isPaladin ? [] : (isMage ? mageTurnMeta.flatMap(m => m.autoEvents) : turns.map(t => t[0]).filter(Boolean));
  const spellAttackEvents = isPaladin ? attackEvents : (isMage ? mageTurnMeta.flatMap(m => m.spellEvents) : turns.flatMap(t => t.slice(1)));
  const cleanSpellNormals = spellAttackEvents
    .filter(e => e.type === 'normal' && !e.isPrey)
    .map(e => e.dmg);
  const autoNormalSamples = autoAttackEvents
    .filter(e => e.type === 'normal' && !e.isPrey)
    .map(e => e.dmg);
  const autoCritSamples = autoAttackEvents
    .filter(e => e.type === 'crit' && !e.isPrey)
    .map(e => e.dmg);
  const autoDmgSamples = autoNormalSamples.length > 0
    ? autoNormalSamples
    : autoCritSamples.map(d => critMultObserved > 0 ? d / critMultObserved : d);
  const autoDmg = isPaladin || autoDmgSamples.length === 0 ? 0 : mean(autoDmgSamples);
  const mobsHitPerTurn = turnStats.map(t => t.mobsHit);
  const rpComponentSeries = isPaladin ? {
    arrowHitsPerTurn: turnStats.map(t => Math.max(0, Math.round((t.components && t.components.arrow) || 0))),
    spellHitsPerTurn: turnStats.filter(t => t.rpTurnKind !== 'rune').map(t => Math.max(0, Math.round((t.components && t.components.spell) || 0))),
    runeHitsPerTurn: turnStats.filter(t => t.rpTurnKind === 'rune').map(t => Math.max(0, Math.round((t.components && t.components.rune) || 0))),
    grenadeHitsPerShot: turnStats.filter(t => t.rpGrenade === 'explode').map(t => Math.max(0, Math.round((t.components && t.components.grenade) || 0))).filter(v => v > 0),
    grenadeEvents: turnStats
      .map((t, idx) => ({ turn: idx + 1, ts: t.ts, mark: t.rpGrenade, hits: Math.max(0, Math.round((t.components && t.components.grenade) || 0)), rawAttackHits: t.rawAttackHits }))
      .filter(e => e.mark)
  } : null;
  const classifyRpTurnLines = (turn, stat, mark) => {
    if (!isPaladin || !turn || !stat) return [];
    return stat.rpComponentLines || buildRpClassifiedLines(turn, stat, mark, critMultObserved, rpElementalPreyMult);
  };
  const rpComponentDebugExamples = isPaladin ? (() => {
    const wanted = [];
    const normalIdx = turnStats.findIndex(t => !t.rpGrenade && t.rawAttackHits > 0);
    const castIdx = turnStats.findIndex(t => t.rpGrenade === 'cast');
    const explodeIdx = turnStats.findIndex(t => t.rpGrenade === 'explode');
    const retagIdx = turnStats.findIndex(t => t.rpComponentLines && t.rpComponentLines.some(l => l.beforeComponent !== l.correctedComponent));
    [normalIdx, castIdx, explodeIdx, retagIdx].forEach(idx => { if (idx >= 0 && !wanted.includes(idx)) wanted.push(idx); });
    for (let i = 0; i < turnStats.length && wanted.length < 4; i++) {
      if (!wanted.includes(i) && turnStats[i].rawAttackHits > 0) wanted.push(i);
    }
    return wanted.slice(0, 4).map(idx => ({
      turn: idx + 1,
      ts: turnStats[idx].ts,
      mark: turnStats[idx].rpGrenade || 'normal',
      turnKind: turnStats[idx].rpTurnKind || 'spell',
      turnConflict: turnStats[idx].rpTurnConflict || '',
      rawAttackHits: turnStats[idx].rawAttackHits,
      components: turnStats[idx].components,
      lines: classifyRpTurnLines(turns[idx], turnStats[idx], turnStats[idx].rpGrenade)
    }));
  })() : [];
  const rpComponentMonotonic = isPaladin
    ? rpCollectMonotonicViolations(turnStats)
    : { count: 0, violations: [] };
  let xpAccumTimeline = 0;
  const temporalSeries = turnStats.map(t => {
    xpAccumTimeline += t.xp || 0;
    return { ...t, xpAccum: xpAccumTimeline };
  });
  const hitsPerTurn = mobsHitPerTurn; // campo legado usado pelo render do histograma

  // Box size = percentil 90 dos mobs acertados/turno
  // Ponto de saída = percentil 10 (mínimo confiável, nunca abaixo de 1)
  const boxSizeStrictP90 = percentile(mobsHitPerTurn, 0.90);
  const mobsHitMode = modeValue(mobsHitPerTurn);
  const mageNonUeHits = isMage ? turnStats.filter(t => t.special !== 'ue').map(t => t.mobsHit).filter(v => Number.isFinite(v) && v > 0) : [];
  const mageBoxTarget = isMage && mageNonUeHits.length
    ? Math.max(1, Math.round(Math.max(modeValue(mageNonUeHits), percentile(mageNonUeHits, 0.75))))
    : 0;
  const boxSizeP95 = isPaladin ? denseP90(mobsHitPerTurn, boxSizeStrictP90) : (isMage && mageBoxTarget ? mageBoxTarget : boxSizeStrictP90);
  const mobsHitMean = mobsHitPerTurn.length ? mean(mobsHitPerTurn) : 0;
  const mobsHitP50 = percentile(mobsHitPerTurn, 0.50);
  const p90Share = mobsHitPerTurn.length
    ? mobsHitPerTurn.filter(v => v === boxSizeP95).length / mobsHitPerTurn.length
    : 0;
  const p90IsMode = mobsHitMode === boxSizeP95;
  const boxVariance = Math.max(0, Math.min(3, Math.round((boxSizeStrictP90 - mobsHitP50) / 2)));
  const boxRangeMin = Math.max(1, Math.round(boxSizeP95 - boxVariance));
  const boxRangeMax = Math.round(boxSizeP95 + boxVariance);
  const exitP5 = Math.max(1, percentile(mobsHitPerTurn, 0.10));
  const aoeHitSamplesRaw = mobsHitPerTurn.filter(v => Number.isFinite(v));
  const aoeHitSamples = aoeHitSamplesRaw.length >= 30 ? aoeHitSamplesRaw : [];
  const avgMobsHit = aoeHitSamplesRaw.length ? mean(aoeHitSamplesRaw) : boxSizeP95;
  const aoeCoverageMean = boxSizeP95 > 0 ? Math.min(1, avgMobsHit / boxSizeP95) : 1;
  const upperCut = Math.max(exitP5 + 1, Math.floor(boxSizeP95 * 0.75));
  const upperSamples = aoeHitSamplesRaw.filter(v => v >= upperCut);
  const upperMean = upperSamples.length ? mean(upperSamples) : boxSizeP95;
  const boxSizeEffective = isPaladin
    ? boxSizeP95
    : Math.min(boxSizeP95, Math.max(boxSizeP95 - 0.4, upperMean));
  const midSamples = aoeHitSamplesRaw.filter(v => v > exitP5 && v < boxSizeP95);
  const midShare = aoeHitSamplesRaw.length ? midSamples.length / aoeHitSamplesRaw.length : 0;
  const spawnCurve = isPaladin ? 2.0 : Math.max(0.8, Math.min(2.0, 2.0 - 1.5 * midShare));

  // ===== HP ESTIMADO =====
  // Estratégia híbrida:
  // 1. Contar quantos hits cada mob recebeu no log (proxy pra frequência)
  // 2. Se TODOS os mobs detectados estão na tabela MOBS_TABLE: usar HP
  //    ponderado pela frequência (preciso, sem viés de dano perdido)
  // 3. Senão: fallback pra estimativa antiga (dano total ÷ mortes)
  //
  // A estimativa por dano÷mortes superestima HP quando há dano "perdido"
  // (mobs que escaparam pra próxima box, overkill). EK tinha esse viés
  // significativo (-24% vs tabela).
  const mobAttackCounts = {};
  for (const e of attackEvents) {
    if (e.mob) mobAttackCounts[e.mob] = (mobAttackCounts[e.mob] || 0) + 1;
  }
  for (const e of charmEvents) {
    if (e.mob) mobAttackCounts[e.mob] = (mobAttackCounts[e.mob] || 0) + 1;
  }
  const mobNames = Object.keys(mobAttackCounts);
  const totalMobAttacks = Object.values(mobAttackCounts).reduce((s, v) => s + v, 0);

  // Ver quais mobs estão na tabela
  const mobsRecognized = mobNames.filter(n => MOBS_TABLE[n]);
  const mobsUnrecognized = mobNames.filter(n => !MOBS_TABLE[n]);
  const allMobsRecognized = mobsUnrecognized.length === 0 && mobNames.length > 0;
  const rawXpDiag = estimateRawXpFromLog(xpEvents, mobAttackCounts, duration);

  let hpEstimated, hpSource, hpMobBreakdown;
  if (allMobsRecognized) {
    // HP ponderado pela frequência de ataques em cada mob
    let weightedHp = 0;
    hpMobBreakdown = [];
    for (const name of mobNames) {
      const count = mobAttackCounts[name];
      const weight = count / totalMobAttacks;
      const hp = MOBS_TABLE[name][0];
      weightedHp += hp * weight;
      hpMobBreakdown.push({ name, hp, weight: weight * 100 });
    }
    hpEstimated = Math.round(weightedHp);
    hpSource = 'table';
  } else {
    // Fallback: estimativa antiga
    hpEstimated = totalKills > 0 ? Math.round(dmgTotal / totalKills) : 0;
    hpSource = 'estimate';
    hpMobBreakdown = null;
  }

  // ===== CICLO DE DANO (3 ataques) =====
  // Tibia tem cooldown de spells diferentes — o ciclo é A1, A2, A3, A1, ...
  // Vou tentar identificar 3 picos no histograma dos hits limpos
  const mixedCycleRaw = estimateDamageCycle(cleanSpellNormals.length > 0 ? cleanSpellNormals : cleanNormals);
  const paladinOrderSplit = isPaladin
    ? splitPaladinDamageByTurnOrder(turns, critMultObserved, preyMult, turnStats)
    : { arrowDmg: 0, spellDmgs: null, confidence: 'none', method: 'none', arrowHitsMean: 0, spellHitsMean: 0 };
  const paladinClusterSplit = isPaladin
    ? splitPaladinDamage(cleanSpellNormals.length > 0 ? cleanSpellNormals : cleanNormals)
    : { arrowDmg: 0, spellDmgs: null, confidence: 'none', method: 'none' };
  if (paladinClusterSplit && !paladinClusterSplit.method) paladinClusterSplit.method = 'cluster';
  const cycleWithoutSpecialPreview = cycle => {
    const vals = (cycle || []).filter(v => Number.isFinite(v) && v > 0);
    if (vals.length < 3) return vals;
    const maxVal = Math.max(...vals);
    const rest = vals.filter(v => v !== maxVal);
    const replacement = rest.length ? Math.round(median(rest)) : Math.round(maxVal);
    return vals.map(v => v === maxVal ? replacement : v);
  };
  const cycleMedian = cycle => median((cycle || []).filter(v => Number.isFinite(v) && v > 0));
  const mixedCycleMedian = cycleMedian(mixedCycleRaw);
  const orderCycleMedian = cycleMedian(paladinOrderSplit.spellDmgs || []);
  const orderLooksTooLow = isPaladin && paladinOrderSplit.spellDmgs && mixedCycleMedian > 0 &&
    orderCycleMedian > 0 && orderCycleMedian < mixedCycleMedian * 0.80;
  const orderAfterSpecial = isPaladin && paladinOrderSplit.spellDmgs
    ? cycleWithoutSpecialPreview(paladinOrderSplit.spellDmgs)
    : null;
  const orderAfterSpecialLooksLow = isPaladin && orderAfterSpecial && mixedCycleMedian > 0 &&
    cycleMedian(orderAfterSpecial) < mixedCycleMedian * 0.80;
  let paladinSplit = isPaladin && paladinOrderSplit.spellDmgs && !orderLooksTooLow && !orderAfterSpecialLooksLow
    ? paladinOrderSplit
    : paladinClusterSplit;
  if (isPaladin && (!paladinSplit || !paladinSplit.spellDmgs || orderLooksTooLow || orderAfterSpecialLooksLow)) {
    paladinSplit = {
      arrowDmg: paladinOrderSplit.arrowDmg || paladinClusterSplit.arrowDmg || 0,
      spellDmgs: mixedCycleRaw,
      confidence: orderLooksTooLow || orderAfterSpecialLooksLow ? 'fallback' : 'weak',
      method: 'fallback',
      arrowHitsMean: paladinOrderSplit.arrowHitsMean || 0,
      spellHitsMean: paladinOrderSplit.spellHitsMean || 0,
      rejectedOrder: orderLooksTooLow || orderAfterSpecialLooksLow
    };
  }
  const dmgCycleRaw = isPaladin && paladinSplit.spellDmgs ? paladinSplit.spellDmgs : mixedCycleRaw;
  let arrowHitsMean = 0, spellHitsMean = 0, runeHitsMean = 0, spellHitsMeanWhenUsed = 0, paladinArrowCoverage = 1, paladinSpellCoverage = 1;
  let rpArrowCoverageObserved = 1, rpSpellCoverageObserved = 1;
  let rpArrowCoverageUsed = 1, rpSpellCoverageUsed = 1;
  const coverageFromHits = hits => boxSizeP95 > 0 ? Math.max(0, Math.min(1, hits / boxSizeP95)) : 1;
  if (isPaladin) {
    const componentArrowSamples = rpComponentSeries
      ? rpComponentSeries.arrowHitsPerTurn.filter(v => Number.isFinite(v))
      : [];
    const componentSpellSamples = rpComponentSeries
      ? rpComponentSeries.spellHitsPerTurn.filter(v => Number.isFinite(v))
      : [];
    const componentRuneSamples = rpComponentSeries
      ? rpComponentSeries.runeHitsPerTurn.filter(v => Number.isFinite(v))
      : [];
    if (componentArrowSamples.length || componentSpellSamples.length || componentRuneSamples.length) {
      arrowHitsMean = componentArrowSamples.length ? mean(componentArrowSamples) : 0;
      spellHitsMean = componentSpellSamples.length ? mean(componentSpellSamples) : 0;
      runeHitsMean = componentRuneSamples.length ? mean(componentRuneSamples) : 0;
      const usedSpellSamples = componentSpellSamples.filter(v => v > 0);
      spellHitsMeanWhenUsed = usedSpellSamples.length ? mean(usedSpellSamples) : spellHitsMean;
    } else {
      arrowHitsMean = paladinSplit.arrowHitsMean || 0;
      spellHitsMean = paladinSplit.spellHitsMean || 0;
      spellHitsMeanWhenUsed = spellHitsMean;
    }
    rpArrowCoverageObserved = coverageFromHits(arrowHitsMean);
    rpSpellCoverageObserved = coverageFromHits(spellHitsMean);
    rpArrowCoverageUsed = rpArrowCoverageObserved;
    rpSpellCoverageUsed = rpSpellCoverageObserved;
    paladinArrowCoverage = rpArrowCoverageUsed;
    paladinSpellCoverage = rpSpellCoverageUsed;
  }
  // Aplicar fator efetivo do prey (média ponderada do dano com prey)
  function cycleWithoutSpecial(cycle) {
    const vals = cycleWithoutSpecialPreview(cycle);
    return vals.length ? vals : cycle;
  }
  const mageUeRawSamples = isMage ? mageTurnMeta.flatMap(m => m.ueEvents).map(normalizeCombatDamage).filter(v => Number.isFinite(v) && v > 0) : [];
  const mageUeDetected = isMage && mageUeRawSamples.length > 0;
  const mageUeRaw = mageUeRawSamples.length ? median(mageUeRawSamples) : 0;
  const specialBaseRaw = isMage ? mageUeRaw : Math.max(...dmgCycleRaw);
  const dmgCycleRawForSimulation = ((isPaladin && rpGrenadeConfidence !== 'none') || mageUeDetected)
    ? cycleWithoutSpecial(dmgCycleRaw)
    : dmgCycleRaw;
  const dmgCycle = dmgCycleRawForSimulation.map(d => Math.round(d * preyEffectiveFactor));
  const dmgCycleMixed = mixedCycleRaw.map(d => Math.round(d * preyEffectiveFactor));
  const rpGrenadeDmg = isPaladin ? Math.round(specialBaseRaw * preyEffectiveFactor) : 0;
  const mageUeDmg = mageUeDetected ? Math.round(specialBaseRaw * preyEffectiveFactor) : 0;
  const paladinArrowDmg = isPaladin ? Math.round((paladinSplit.arrowDmg || 0) * preyEffectiveFactor) : 0;
  const paladinDamageMethod = isPaladin ? (paladinSplit.method || 'fallback') : 'none';
  const paladinDamageWarning = isPaladin && paladinSplit.rejectedOrder
    ? 'order_rejected_low_cycle'
    : '';

  // ===== DETECÇÃO DE INTELIGÊNCIA =====
  // Heurística: "intel ON" = jogador puxa novos mobs antes do anterior morrer,
  // então nunca para de atacar — não há gaps longos no log.
  // "Intel OFF" = jogador termina box atual e caminha — gaps de vários segundos
  // sem atacar entre blocos.
  //
  // Cálculo: somar duração total de "gaps grandes" (≥4s entre segundos com hits)
  // e dividir pela duração da hunt. Gaps ≥4s representam walking entre boxes.
  // Threshold 5% empírico:
  //   - paladino com intel: 0 gaps ≥4s = 0% tempo morto ✓
  //   - EK sem intel:        5 gaps ≥4s = 11.7% tempo morto ✓
  // Só inferimos com ≥30 turnos detectados.
  let intelDetected = null;
  let emptyTurnPct = 0;
  if (turns.length >= 30 && duration > 0) {
    // Coletar timestamps únicos de segundos com hits (primeiro hit de cada turno)
    const secsWithHits = [...new Set(sortedAttacks.map(a => a.ts))].sort((a, b) => a - b);
    let bigGapTotal = 0;
    for (let i = 1; i < secsWithHits.length; i++) {
      const gap = secsWithHits[i] - secsWithHits[i - 1];
      if (gap >= 4) bigGapTotal += gap;
    }
    emptyTurnPct = 100 * bigGapTotal / duration;
    intelDetected = emptyTurnPct < 5;
  }

  // ===== BOX CHANGE TIME =====
  // Estratégia depende da inteligência detectada:
  //
  // INTEL OFF (jogador faz box completa antes de andar): há pausas REAIS no log
  // entre o último hit da box anterior e o primeiro da próxima. Usar gaps
  // entre ataques de 3-15s (mediana = walking time).
  //
  // INTEL ON (jogador puxa novos mobs antes do anterior morrer): NÃO há pausas
  // visíveis — o ataque é contínuo. Mas há uma assinatura temporal: o jogador
  // sai de turnos com poucos hits (saída p5 = mobs sobrando) e chega em turnos
  // com muitos hits (box p95 = chegou na próxima box). O tempo dessa transição
  // é o walking time efetivo. Procuramos pares (turno baixo → próximo turno alto)
  // sem sobreposição (uma vez que casa, pula pra depois do high).
  //
  // Confiança: forte (≥10 amostras), fraca (3-9), nenhuma (<3 → fallback 6s).
  let boxChangeTime, boxChangeTimeConfidence;
  let bctSource = 'fallback'; // 'gap_method', 'transition_method', 'fallback'

  if (intelDetected === false) {
    // Intel OFF: usar gaps entre ataques (heurística clássica)
    const sortedAttackTs = sortedAttacks.map(a => a.ts);
    const attackGaps = [];
    for (let i = 1; i < sortedAttackTs.length; i++) {
      const g = sortedAttackTs[i] - sortedAttackTs[i - 1];
      if (g >= 3 && g <= 15) attackGaps.push(g);
    }
    if (attackGaps.length >= 10) {
      boxChangeTime = Math.round(median(attackGaps));
      boxChangeTimeConfidence = 'strong';
      bctSource = 'gap_method';
    } else if (attackGaps.length >= 3) {
      boxChangeTime = Math.round(median(attackGaps));
      boxChangeTimeConfidence = 'weak';
      bctSource = 'gap_method';
    } else {
      boxChangeTime = 6;
      boxChangeTimeConfidence = 'none';
    }
  } else {
    // Intel ON ou desconhecida: usar método de transições (p5 → próximo p95).
    // Algoritmo:
    //   1. Encontrar próximo turno com hits ≤ p5 (saída — poucos vivos)
    //   2. Procurar próximo turno depois desse com hits ≥ p95 (chegou na próxima box)
    //   3. Diferença de tempo = walking time (com cooldown de chegar em alcance)
    //   4. Pular pra depois do p95 e buscar próximo p5
    //   5. Filtrar transições >60s (AFK, banheiro, comer fora — não é walking real)
    const sortedBuckets = Object.keys(turnsMap).map(Number).sort((a, b) => a - b);
    const turnInfo = sortedBuckets.map(b => ({
      ts: turnStats[b].ts, // ts do primeiro hit do turno (clustering)
      hits: turnStats[b].mobsHit
    }));

    const transitions = [];
    let i = 0;
    while (i < turnInfo.length) {
      // 1. Encontrar próximo p5
      while (i < turnInfo.length && turnInfo[i].hits > exitP5) i++;
      if (i >= turnInfo.length) break;
      const p5Idx = i;
      i++;

      // 2. Encontrar próximo p95 depois desse p5 (sem afastamento mínimo —
      //    o algoritmo natural do "próximo da sequência" já garante ordem)
      while (i < turnInfo.length && turnInfo[i].hits < boxSizeP95) i++;
      if (i >= turnInfo.length) break;

      // 3. Calcular gap; filtrar AFK (>60s não é walking real)
      const gap = turnInfo[i].ts - turnInfo[p5Idx].ts;
      if (gap > 0 && gap <= 60) transitions.push(gap);

      // 4. Pular pra depois do p95
      i++;
    }

    if (transitions.length >= 10) {
      boxChangeTime = Math.round(median(transitions));
      boxChangeTimeConfidence = 'strong';
      bctSource = 'transition_method';
    } else if (transitions.length >= 3) {
      boxChangeTime = Math.round(median(transitions));
      boxChangeTimeConfidence = 'weak';
      bctSource = 'transition_method';
    } else {
      boxChangeTime = 6;
      boxChangeTimeConfidence = 'none';
    }
  }

  if (isPaladin && bctSource === 'transition_method' && boxChangeTime < 12) {
    boxChangeTime = 28;
    boxChangeTimeConfidence = 'weak';
    bctSource = 'guardrail';
  }
  // Manter campo legado pra compatibilidade
  const boxChangeTimeEstimated = boxChangeTimeConfidence !== 'none';

  return {
    duration, totalXp, totalKills, xphReal, avgXpPerKill,
    rawXpDiag,
    dmgTotal, avgNormal, avgCrit, avgCharm,
    critRateObserved, critMultObserved, charmRateObserved,
    hpEstimated, hpSource, mobsUnrecognized, hpMobBreakdown,
    boxSizeP95, boxSizeStrictP90, mageBoxTarget, mobsHitMode, mobsHitMean, mobsHitP50, p90Share, p90IsMode,
    boxVariance, boxRangeMin, boxRangeMax,
    exitP5, hitsPerTurn, mobsHitPerTurn, temporalSeries, autoDmg, reflectDmg: isPaladin || isMage ? 0 : reflectDmgObserved, reflectHitCount: reflectEvents.length, paladinArrowDmg,
    rpComponentSeries, rpComponentDebugExamples, rpComponentMonotonic, rpElementalCorrection,
    specialCastThreshold: Math.max(1, Math.round(boxSizeP95 || boxSizeEffective || 1)),
    aoeHitSamples, aoeCoverageMean, boxSizeEffective, spawnCurve,
    arrowHitsMean, spellHitsMean, runeHitsMean, spellHitsMeanWhenUsed, paladinArrowCoverage, paladinSpellCoverage,
    rpArrowCoverageObserved, rpSpellCoverageObserved, rpArrowCoverageUsed, rpSpellCoverageUsed,
    rpGrenadePairCount, rpGrenadeShare, rpGrenadeConfidence, rpGrenadeDetected: rpGrenadePairCount > 0,
    rpGrenadeDmg, rpGrenadeIntervalSeconds,
    rpGrenadePeakResidual: rpPeakResidualDiag,
    mageUeDmg, mageUeDetected, mageUeCooldown: 4, mageUeIntervalSeconds,
    dmgCycle, dmgCycleRaw, dmgCycleMixed, paladinSplitConfidence: paladinSplit.confidence, paladinSplitMethod: paladinSplit.method || 'none', paladinDamageMethod, paladinDamageWarning, boxChangeTime, boxChangeTimeEstimated, boxChangeTimeConfidence, bctSource,
    intelDetected, emptyTurnPct,
    preyRate, preyMult, preyEffectiveFactor, preyXpActive,
    isPaladin, isMage,
    eventCount: events.length,
    nTurns: turns.length,
    effectiveTurnsCount,
    nKills: totalKills
  };
}

