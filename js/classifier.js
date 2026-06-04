// ============================================================================
// Classificador (paralelo ao Validador) — cruza SERVER LOG + LOCAL CHAT
// para detalhar a rotação do jogador numa tabela única: arrow · runa (pelo nome
// da runa) · cada spell de dano (pela incantação) · granada.
//
// NÃO toca no parser/validador: reusa parseServerLog() em modo read-only e
// captura os turnStats por um wrapper temporário de correctRpComponentsByElement
// (mesma técnica dos tools dev). SEM simulação — só hits/dano observados.
//
// Dependências (globais já carregadas antes deste arquivo): parseServerLog,
// correctRpComponentsByElement, normalizeRuneName.
// ============================================================================

// Tabela interna de spells: nome de exibição (null = mostrar a incantação) + tipo.
// tipo 'attack' entra sempre na tabela; 'heal'/'support' nunca. Incantação
// desconhecida cai no heurístico data-driven (turn-locked).
// tipo: 'attack' (spell de dano, offset 0) · 'grenade' (granada: cast ~3s antes da
// explosão) · 'heal'/'support' (nunca entram). name null = mostrar a incantação.
const CLS_SPELLS = {
  // ataques de paladino (tibia.com/library) — holy
  'exori san':           { name: 'Divine Missile',        type: 'attack' },
  'exori con':           { name: 'Ethereal Spear',        type: 'attack' },
  'exori infir con':     { name: 'Lesser Ethereal Spear', type: 'attack' },
  'exori gran con':      { name: 'Strong Ethereal Spear', type: 'attack' },
  'utori san':           { name: 'Holy Flash',            type: 'attack' },
  'exevo mas san':       { name: 'Divine Caldera',        type: 'attack' },
  'exevo tempo mas san': { name: 'Divine Grenade',        type: 'grenade' },
  // suporte / cura (nunca entram como dano)
  'utito tempo san':     { name: 'Sharpshooter',          type: 'support' },
  'exana amp res':       { name: null,                    type: 'support' },
  'utevo grav san':      { name: null,                    type: 'support' },
  'utamo tempo san':     { name: null,                    type: 'support' },
  'utani hur':           { name: 'Haste',                 type: 'support' },
  'exura san':           { name: 'Divine Healing',        type: 'heal' },
  'exura gran san':      { name: 'Divine Healing',        type: 'heal' },
};
function clsSpellLabel(text) {
  const e = CLS_SPELLS[text];
  return e && e.name ? (e.name + ' (' + text + ')') : text;
}
function clsKnownType(text) { return CLS_SPELLS[text] ? CLS_SPELLS[text].type : null; }

const CLS_MAGIC_PREFIX = /^(exori|exevo|exura|exana|exeta|exiva|exomis|utevo|utamo|utani|utura|utito|utgran|adevo|adori|adana|adura|frigo|mort)\b/;
const CLS_CHAT_RE = /^(\d{2}):(\d{2}):(\d{2})\s+(.+?)(?:\s+\[(\d+)\])?:\s?(.*)$/;
const CLS_RUNE_USE_RE = /Using one of \d+\s+(.+?)\s+runes?\b/i;
const CLS_TS_RE = /^(\d{2}):(\d{2}):(\d{2})\b/;

function clsMean(a) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0; }
function clsAgg(label, kind, turnsList) {
  // turnsList: [{hits, dmgs:[]}] -> {label, kind, turns, hitsMean, dmgMean}
  const hits = turnsList.map(x => x.hits);
  const dmgs = [].concat(...turnsList.map(x => x.dmgs));
  return { label, kind, turns: turnsList.length, hitsMean: clsMean(hits), dmgMean: Math.round(clsMean(dmgs)) };
}

// Conta hits e soma revertedDmg por componente, por turno (lê l.correctedComponent).
function clsBuildTurnRecords(turns) {
  return turns.map((t, i) => {
    const counts = { arrow: 0, spell: 0, rune: 0, grenade: 0 };
    const dmgs = { arrow: [], spell: [], rune: [], grenade: [] };
    for (const l of (t.rpComponentLines || [])) {
      const c = l.correctedComponent; if (!(c in counts)) continue;
      counts[c]++;
      if (!l.overkill && Number.isFinite(l.revertedDmg) && l.revertedDmg > 0) dmgs[c].push(l.revertedDmg);
    }
    return { idx: i + 1, ts: t.ts, counts, dmgs };
  });
}

// Single-target (boss, 1 mob): o classificador de bandas precisa de ≥2 mobs, então
// aqui classificamos por ORDEM (regra do jogo: AA primeiro, depois spell/runa).
// Granada (Divine Grenade) explode EXATAMENTE 3s após o cast → só conta se houver um
// hit no segundo C+3 (senão a granada errou o alvo e deu 0 dano — não rouba o turno).
// Demais hits do turno: hit[0]=arrow (AA); seguintes=power (runa/spell pelo cast).
// 1 hit não-granada = power-only se houver cast/runa alinhado (AA pulado), senão AA.
function clsReclassifyByOrder(turns, runeUses, playerSpellCasts, playerGrenCasts) {
  // granada: marca 1 hit por cast, no exato C+3
  const allLines = [];
  for (const t of turns) for (const l of (t.rpComponentLines || [])) allLines.push(l);
  const grenSet = new Set();
  for (const c of playerGrenCasts) {
    const hit = allLines.find(l => l.ts === c.ts + 3 && !grenSet.has(l));
    if (hit) grenSet.add(hit);
  }
  const nearRune = T => runeUses.some(u => u.ts >= T - 1 && u.ts <= T + 2);
  const nearSpell = T => playerSpellCasts.some(c => c.ts >= T - 1 && c.ts <= T + 2);
  for (const t of turns) {
    const ordered = (t.rpComponentLines || []).slice().sort((a, b) => (a.ts - b.ts) || ((a.seq || 0) - (b.seq || 0)));
    const nonGren = [];
    for (const l of ordered) { if (grenSet.has(l)) l.correctedComponent = 'grenade'; else nonGren.push(l); }
    if (!nonGren.length) continue;
    const rune = nearRune(t.ts), spell = nearSpell(t.ts);
    const power = rune ? 'rune' : 'spell';
    nonGren.forEach((l, i) => {
      if (nonGren.length >= 2) l.correctedComponent = (i === 0) ? 'arrow' : power;
      else l.correctedComponent = (rune || spell) ? power : 'arrow';
    });
  }
}

// Parse do local chat -> [{ts, speaker, level, text}] (só falas com [nível]).
function parseLocalChat(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = CLS_CHAT_RE.exec(line);
    if (!m) continue;
    out.push({
      ts: +m[1] * 3600 + +m[2] * 60 + +m[3],
      speaker: m[4], level: m[5] ? +m[5] : null,
      text: (m[6] || '').trim().toLowerCase(),
    });
  }
  return out;
}

// Linhas "Using one of N <runa> runes" do server log -> [{ts, name}].
function parseRuneUses(serverLogText) {
  const out = [];
  for (const line of String(serverLogText || '').split(/\r?\n/)) {
    const tm = CLS_TS_RE.exec(line); if (!tm) continue;
    const rm = CLS_RUNE_USE_RE.exec(line); if (!rm) continue;
    out.push({ ts: +tm[1] * 3600 + +tm[2] * 60 + +tm[3], name: normalizeRuneName(rm[1]) });
  }
  return out;
}

// Usa o parser EXCLUSIVO do classificador (js/classifier-parser.js) — sem o guard
// de ≥5 kills e ciente de boss sem artigo. Não toca no parser do validador.
function clsCaptureTurns(serverLogText) {
  const data = parseLogForClassifier(serverLogText);
  return { data, turns: data.turnStats || [] };
}

// acha o item de menor |ts-T| em [T-1, T+2] dentro de `arr` (arr: [{ts,...}])
function clsNearest(arr, T) {
  let best = null, bestDt = 99;
  for (const c of arr) if (c.ts >= T - 1 && c.ts <= T + 2) { const dt = Math.abs(c.ts - T); if (dt < bestDt) { bestDt = dt; best = c; } }
  return best;
}

// Núcleo: cruza os dois logs e devolve a tabela única + diagnóstico de detecção.
function classifyWithLocalChat(serverLogText, localChatText) {
  const { data, turns } = clsCaptureTurns(serverLogText);
  if (!turns.length) return { error: 'no_turns', data };

  let turnRecords = clsBuildTurnRecords(turns);
  const spellTurns = turnRecords.filter(r => r.counts.spell > 0);
  const runeTurns = turnRecords.filter(r => r.counts.rune > 0);
  const grenadeTurns = turnRecords.filter(r => r.counts.grenade > 0);

  // --- detecção das incantações (local chat) ---
  // spell de dano: cast no turno [T-1,T+2] (offset 0). granada: cast 1-3s ANTES do
  // turno de explosão (a granada estoura ~3s depois do cast). cura é spammada
  // (overcast alto); buff cobre poucos turnos (recall baixo).
  const chat = parseLocalChat(localChatText);
  const winLo = turns[0].ts - 3, winHi = turns[turns.length - 1].ts + 3;
  const casts = chat.filter(c => c.level != null && CLS_MAGIC_PREFIX.test(c.text));
  const groups = new Map();
  for (const c of casts) {
    const k = c.speaker + '||' + c.text;
    if (!groups.has(k)) groups.set(k, { speaker: c.speaker, text: c.text, all: 0, inWin: 0, spell: new Set(), gren: new Set() });
    const g = groups.get(k); g.all++;
    if (c.ts >= winLo && c.ts <= winHi) {
      g.inWin++;
      for (const r of spellTurns) if (c.ts >= r.ts - 1 && c.ts <= r.ts + 2) { g.spell.add(r.idx); break; }
      for (const r of grenadeTurns) if (c.ts >= r.ts - 3 && c.ts <= r.ts - 1) { g.gren.add(r.idx); break; }
    }
  }
  const OVERCAST = 1.6, RECALL = 0.5, MINCAST = 3;
  const turnLocked = (cov, target) => cov >= 1 && (target ? cov / target >= RECALL : false);
  const ranked = [...groups.values()].map(g => {
    const sc = g.spell.size, gc = g.gren.size;
    const sOver = sc ? g.inWin / sc : Infinity, gOver = gc ? g.inWin / gc : Infinity;
    const sRec = spellTurns.length ? sc / spellTurns.length : 0;
    const gRec = grenadeTurns.length ? gc / grenadeTurns.length : 0;
    const known = clsKnownType(g.text);
    let kind = '—';
    if (known === 'attack') kind = 'spell';
    else if (known === 'grenade') kind = 'grenade';
    else if (known === 'heal' || known === 'support') kind = '—';
    else if (g.inWin >= MINCAST && sOver <= OVERCAST && turnLocked(sc, spellTurns.length)) kind = 'spell';
    else if (g.inWin >= MINCAST && gOver <= OVERCAST && turnLocked(gc, grenadeTurns.length)) kind = 'grenade';
    return {
      speaker: g.speaker, text: g.text, total: g.all, inWin: g.inWin, kind,
      spellCovered: sc, grenCovered: gc, covered: kind === 'grenade' ? gc : sc,
      overcast: kind === 'grenade' ? gOver : sOver, recall: kind === 'grenade' ? gRec : sRec,
    };
  }).filter(g => g.inWin > 0).sort((a, b) => (b.spellCovered + b.grenCovered) - (a.spellCovered + a.grenCovered));

  const dmgCandidates = ranked.filter(g => g.kind === 'spell' || g.kind === 'grenade');
  // jogador = dono do server log: melhor caster (maior recall, menor overcast) da
  // spell de dano que alinha. Em hunt de party há vários casters; prefere uma
  // incantação de ataque/granada CONHECIDA (contexto RP) p/ não cair na spell de
  // outra vocação de um party-mate (ex.: exori de um EK).
  let player = null;
  if (dmgCandidates.length) {
    const known = dmgCandidates.filter(g => clsKnownType(g.text) === 'attack' || clsKnownType(g.text) === 'grenade');
    const pool = known.length ? known : dmgCandidates;
    player = pool.slice().sort((a, b) => b.recall - a.recall || a.overcast - b.overcast)[0].speaker;
  }
  const damageSpells = dmgCandidates.filter(g => g.speaker === player && g.kind === 'spell').map(g => g.text);
  const grenadeSpells = dmgCandidates.filter(g => g.speaker === player && g.kind === 'grenade').map(g => g.text);

  // --- alinhamento ESTRITO + agregação (só turnos 100% alinhados entre os 2 logs) ---
  // Um turno só entra se TODOS os seus componentes de cast forem casados: spell e
  // granada pelo local chat (granada estoura ~3s após o cast → janela [G-3,G-1]),
  // runa pela linha "Using one of N … runes" do server log. Turno que não casar é
  // excluído INTEIRO (inclusive o arrow dele).
  const playerSpellCasts = casts.filter(c => c.speaker === player && damageSpells.includes(c.text));
  const playerGrenCasts = casts.filter(c => c.speaker === player && grenadeSpells.includes(c.text));
  const runeUses = parseRuneUses(serverLogText);

  // Boss single-target: o classificador de bandas não separa arrow×spell com 1 mob.
  // Reclassifica por ORDEM (AA primeiro, depois power) e reconstrói os turnRecords.
  if (data.distinctMobs === 1) {
    clsReclassifyByOrder(turns, runeUses, playerSpellCasts, playerGrenCasts);
    turnRecords = clsBuildTurnRecords(turns);
  }

  const nearestGren = G => {
    let best = null, bestDt = 99;
    for (const c of playerGrenCasts) if (c.ts >= G - 3 && c.ts <= G - 1) { const dt = G - c.ts; if (dt < bestDt) { bestDt = dt; best = c; } }
    return best;
  };

  const perSpell = new Map(), perGren = new Map(), perRune = new Map();
  const arrowAligned = []; let excludedTurns = 0;
  for (const r of turnRecords) {
    const sCast = r.counts.spell > 0 ? clsNearest(playerSpellCasts, r.ts) : null;
    const gCast = r.counts.grenade > 0 ? nearestGren(r.ts) : null;
    const rUse = r.counts.rune > 0 ? clsNearest(runeUses, r.ts) : null;
    const aligned = (r.counts.spell === 0 || sCast) && (r.counts.grenade === 0 || gCast) && (r.counts.rune === 0 || rUse);
    if (!aligned) { excludedTurns++; continue; }
    if (r.counts.arrow > 0) arrowAligned.push({ hits: r.counts.arrow, dmgs: r.dmgs.arrow });
    if (sCast) { if (!perSpell.has(sCast.text)) perSpell.set(sCast.text, []); perSpell.get(sCast.text).push({ hits: r.counts.spell, dmgs: r.dmgs.spell }); }
    if (gCast) { if (!perGren.has(gCast.text)) perGren.set(gCast.text, []); perGren.get(gCast.text).push({ hits: r.counts.grenade, dmgs: r.dmgs.grenade }); }
    if (rUse) { if (!perRune.has(rUse.name)) perRune.set(rUse.name, []); perRune.get(rUse.name).push({ hits: r.counts.rune, dmgs: r.dmgs.rune }); }
  }

  // --- tabela única (ordem: arrow · runas · spells · granada) ---
  const grenLabel = text => clsSpellLabel(text);
  const rows = [];
  if (arrowAligned.length) rows.push(clsAgg('arrow', 'arrow', arrowAligned));
  for (const [name, list] of [...perRune.entries()].sort((a, b) => b[1].length - a[1].length)) rows.push(clsAgg(name, 'rune', list));
  for (const [text, list] of [...perSpell.entries()].sort((a, b) => b[1].length - a[1].length)) rows.push(clsAgg(clsSpellLabel(text), 'spell', list));
  for (const [text, list] of [...perGren.entries()].sort((a, b) => b[1].length - a[1].length)) rows.push(clsAgg(grenLabel(text), 'grenade', list));
  // granadas castadas que NÃO deram dano (erraram): mostra a linha com 0 hits / 0 dano.
  for (const text of grenadeSpells) {
    if (perGren.has(text)) continue;
    const casts = playerGrenCasts.filter(c => c.text === text && c.ts >= winLo && c.ts <= winHi).length;
    if (casts > 0) rows.push({ label: grenLabel(text), kind: 'grenade', turns: casts, hitsMean: 0, dmgMean: 0 });
  }

  return {
    data, player, damageSpells, grenadeSpells, ranked, rows,
    totalTurns: turns.length, excludedTurns,
    spellTurnCount: spellTurns.length, grenadeTurnCount: grenadeTurns.length, runeTurnCount: runeTurns.length,
  };
}
