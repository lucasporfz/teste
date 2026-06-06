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
// Tabela COMPLETA de spells (tibia.com/library + TibiaWiki), TODAS as vocações.
// tipo: 'attack' (spell de dano) · 'grenade' (Divine Grenade: explode ~3s após o
// cast) · 'heal'/'support' (nunca entram como dano). Incantações com alvo entre
// aspas (exura sio "nome") são normalizadas removendo as aspas antes da consulta.
const CLS_SPELLS = {
  // ---- Paladin ----
  'exori san':            { name: 'Divine Missile',         type: 'attack' },
  'exori con':            { name: 'Ethereal Spear',         type: 'attack' },
  'exori infir con':      { name: 'Lesser Ethereal Spear',  type: 'attack' },
  'exori gran con':       { name: 'Strong Ethereal Spear',  type: 'attack' },
  'exori dir moe':        { name: 'Ethereal Barrage',       type: 'attack' },
  'exori dir san':        { name: 'Divine Barrage',         type: 'attack' },
  'utori san':            { name: 'Holy Flash',             type: 'attack' },
  'exevo mas san':        { name: 'Divine Caldera',         type: 'attack' },
  'exevo tempo mas san':  { name: 'Divine Grenade',         type: 'grenade' },
  'exura san':            { name: 'Divine Healing',         type: 'heal' },
  'exura gran san':       { name: 'Salvation',              type: 'heal' },
  'utevo grav san':       { name: 'Divine Empowerment',     type: 'support' },
  'exana amp res':        { name: 'Divine Dazzle',          type: 'support' },
  'utito tempo san':      { name: 'Sharpshooter',           type: 'support' },
  'utamo tempo san':      { name: 'Swift Foot',             type: 'support' },
  'utori hur':            { name: 'Divine Defiance',        type: 'support' },
  'exevo infir con':      { name: 'Arrow Call',             type: 'support' },
  'exevo con':            { name: 'Conjure Arrow',          type: 'support' },
  'exevo con flam':       { name: 'Conjure Explosive Arrow', type: 'support' },
  'exeta con':            { name: 'Enchant Spear',          type: 'support' },
  'exana ina':            { name: 'Cancel Invisibility',    type: 'support' },
  'exana mort':           { name: 'Cure Curse',             type: 'heal' },
  'utamo mas sio':        { name: 'Protect Party',          type: 'support' },
  'uteta res sac':        { name: 'Avatar of Light',        type: 'support' },
  'utevo gran res sac':   { name: 'Summon Paladin Familiar', type: 'support' },
  // ---- Knight ----
  'exori':                { name: 'Berserk',                type: 'attack' },
  'exori gran':           { name: 'Fierce Berserk',         type: 'attack' },
  'exori mas':            { name: 'Groundshaker',           type: 'attack' },
  'exori min':            { name: 'Front Sweep',            type: 'attack' },
  'exori infir min':      { name: 'Lesser Front Sweep',     type: 'attack' },
  'exori ico':            { name: 'Brutal Strike',          type: 'attack' },
  'exori gran ico':       { name: 'Annihilation',           type: 'attack' },
  'exori hur':            { name: 'Whirlwind Throw',        type: 'attack' },
  'exori amp kor':        { name: "Executioner's Throw",    type: 'attack' },
  'utori kor':            { name: 'Inflict Wound',          type: 'attack' },
  'exori ico scu':        { name: 'Shield Bash',            type: 'attack' },
  'exori scu':            { name: 'Shield Slam',            type: 'attack' },
  'utito tempo':          { name: 'Blood Rage',             type: 'support' },
  'utamo tempo':          { name: 'Protector',              type: 'support' },
  'exeta res':            { name: 'Challenge',              type: 'support' },
  'exeta amp res':        { name: 'Chivalrous Challenge',   type: 'support' },
  'utani tempo hur':      { name: 'Charge',                 type: 'support' },
  'utito mas sio':        { name: 'Train Party',            type: 'support' },
  'uteta res eq':         { name: 'Avatar of Steel',        type: 'support' },
  'utevo gran res eq':    { name: 'Summon Knight Familiar', type: 'support' },
  'exura ico':            { name: 'Wound Cleansing',        type: 'heal' },
  'exura med ico':        { name: 'Fair Wound Cleansing',   type: 'heal' },
  'exura gran ico':       { name: 'Intense Wound Cleansing', type: 'heal' },
  'exura infir ico':      { name: 'Bruise Bane',            type: 'heal' },
  'exana kor':            { name: 'Cure Bleeding',          type: 'heal' },
  // ---- Sorcerer ----
  'exori vis':            { name: 'Energy Strike',          type: 'attack' },
  'exori gran vis':       { name: 'Strong Energy Strike',   type: 'attack' },
  'exori max vis':        { name: 'Ultimate Energy Strike', type: 'attack' },
  'exori amp vis':        { name: 'Lightning',              type: 'attack' },
  'exori flam':           { name: 'Flame Strike',           type: 'attack' },
  'exori gran flam':      { name: 'Strong Flame Strike',    type: 'attack' },
  'exori max flam':       { name: 'Ultimate Flame Strike',  type: 'attack' },
  'exori min flam':       { name: "Apprentice's Strike",    type: 'attack' },
  'exori mort':           { name: 'Death Strike',           type: 'attack' },
  'exori infir vis':      { name: 'Buzz',                   type: 'attack' },
  'exevo vis lux':        { name: 'Energy Beam',            type: 'attack' },
  'exevo gran vis lux':   { name: 'Great Energy Beam',      type: 'attack' },
  'exevo vis hur':        { name: 'Energy Wave',            type: 'attack' },
  'exevo flam hur':       { name: 'Fire Wave',              type: 'attack' },
  'exevo gran flam hur':  { name: 'Great Fire Wave',        type: 'attack' },
  'exevo gran mas flam':  { name: "Hell's Core",            type: 'attack' },
  'exevo gran mas vis':   { name: 'Rage of the Skies',      type: 'attack' },
  'exevo max mort':       { name: 'Great Death Beam',       type: 'attack' },
  'exevo mort ora':       { name: 'Death Echo',             type: 'attack' },
  'utori mort':           { name: 'Curse',                  type: 'attack' },
  'utori vis':            { name: 'Electrify',              type: 'attack' },
  'utori flam':           { name: 'Ignite',                 type: 'attack' },
  'uteta mort':           { name: 'Master of Decay',        type: 'support' },
  'uteta flam':           { name: 'Master of Flames',       type: 'support' },
  'uteta vis':            { name: 'Master of Thunder',      type: 'support' },
  'exori moe':            { name: 'Expose Weakness',        type: 'support' },
  'exori kor':            { name: 'Sap Strength',           type: 'support' },
  'exori kor tempo':      { name: 'Aura of Exposed Weakness', type: 'support' },
  'exori moe tempo':      { name: 'Aura of Sapped Strength', type: 'support' },
  'uteta res ven':        { name: 'Avatar of Storm',        type: 'support' },
  'exana vita':           { name: 'Cancel Magic Shield',    type: 'support' },
  'utamo vita':           { name: 'Magic Shield',           type: 'support' },
  'utana vid':            { name: 'Invisible',              type: 'support' },
  'utori mas sio':        { name: 'Enchant Party',          type: 'support' },
  'exevo gran mort':      { name: 'Conjure Wand of Darkness', type: 'support' },
  'utevo gran res ven':   { name: 'Summon Sorcerer Familiar', type: 'support' },
  // ---- Druid ----
  'exori frigo':          { name: 'Ice Strike',             type: 'attack' },
  'exori gran frigo':     { name: 'Strong Ice Strike',      type: 'attack' },
  'exori max frigo':      { name: 'Ultimate Ice Strike',    type: 'attack' },
  'exori tera':           { name: 'Terra Strike',           type: 'attack' },
  'exori gran tera':      { name: 'Strong Terra Strike',    type: 'attack' },
  'exori max tera':       { name: 'Ultimate Terra Strike',  type: 'attack' },
  'exori moe ico':        { name: 'Physical Strike',        type: 'attack' },
  'exevo frigo hur':      { name: 'Ice Wave',               type: 'attack' },
  'exevo gran frigo hur': { name: 'Strong Ice Wave',        type: 'attack' },
  'exevo tera hur':       { name: 'Terra Wave',             type: 'attack' },
  'exevo gran mas frigo': { name: 'Eternal Winter',         type: 'attack' },
  'exevo gran mas tera':  { name: 'Wrath of Nature',        type: 'attack' },
  'exevo ulus frigo':     { name: 'Ice Burst',              type: 'attack' },
  'exevo ulus tera':      { name: 'Terra Burst',            type: 'attack' },
  'exevo fur frigo':      { name: 'Forked Glacier',         type: 'attack' },
  'exevo fur tera':       { name: 'Forked Thorns',          type: 'attack' },
  'exevo infir frigo hur': { name: 'Chill Out',             type: 'attack' },
  'exori infir tera':     { name: 'Mud Attack',             type: 'attack' },
  'utori pox':            { name: 'Envenom',                type: 'attack' },
  'utito dru':            { name: 'Elemental Synthesis',    type: 'support' },
  'uteta res dru':        { name: 'Avatar of Nature',       type: 'support' },
  'exana flam':           { name: 'Cure Burning',           type: 'heal' },
  'exana vis':            { name: 'Cure Electrification',   type: 'heal' },
  'exura sio':            { name: 'Heal Friend',            type: 'heal' },
  'utura mas sio':        { name: 'Heal Party',             type: 'support' },
  'exura gran mas res':   { name: 'Mass Healing',           type: 'heal' },
  'exura gran sio':       { name: "Nature's Embrace",       type: 'heal' },
  'utura sio':            { name: 'Shared Conservation',    type: 'support' },
  'utevo gran res dru':   { name: 'Summon Druid Familiar',  type: 'support' },
  // ---- Monk ----
  'exori pug':            { name: 'Double Jab',             type: 'attack' },
  'exori infir pug':      { name: 'Swift Jab',              type: 'attack' },
  'exori mas pug':        { name: 'Flurry of Blows',        type: 'attack' },
  'exori gran pug':       { name: 'Forceful Uppercut',      type: 'attack' },
  'exori gran mas pug':   { name: 'Greater Flurry of Blows', type: 'attack' },
  'exori amp pug':        { name: 'Mystic Repulse',         type: 'attack' },
  'exori infir amp pug':  { name: 'Lesser Mystic Repulse',  type: 'attack' },
  'exori med pug':        { name: 'Chained Penance',        type: 'attack' },
  'exori nia':            { name: 'Greater Tiger Clash',    type: 'attack' },
  'exori infir nia':      { name: 'Tiger Clash',            type: 'attack' },
  'exori gran nia':       { name: 'Devastating Knockout',   type: 'attack' },
  'exori mas nia':        { name: 'Sweeping Takedown',      type: 'attack' },
  'exori gran mas nia':   { name: 'Spiritual Outburst',     type: 'attack' },
  'exori mas res':        { name: 'Balanced Brawl',         type: 'support' },
  'utevo nia':            { name: 'Focus Harmony',          type: 'support' },
  'utamo tio':            { name: 'Focus Serenity',         type: 'support' },
  'utori virtu':          { name: 'Virtue of Harmony',      type: 'support' },
  'utito virtu':          { name: 'Virtue of Justice',      type: 'support' },
  'utura tio':            { name: 'Virtue of Sustain',      type: 'support' },
  'exura gran tio':       { name: 'Spirit Mend',            type: 'heal' },
  'exura mas nia':        { name: 'Mass Spirit Mend',       type: 'heal' },
  'exura tio sio':        { name: 'Restore Balance',        type: 'heal' },
  'uteta tio':            { name: 'Mentor Other',           type: 'support' },
  'uteta res tio':        { name: 'Avatar of Balance',      type: 'support' },
  'utevo mas sio':        { name: 'Enlighten Party',        type: 'support' },
  'utevo gran res tio':   { name: 'Summon Monk Familiar',   type: 'support' },
  // ---- comuns / utilitárias (várias vocações) ----
  'exura':                { name: 'Light Healing',          type: 'heal' },
  'exura gran':           { name: 'Intense Healing',        type: 'heal' },
  'exura vita':           { name: 'Ultimate Healing',       type: 'heal' },
  'exura max vita':       { name: 'Restoration',            type: 'heal' },
  'exura infir':          { name: 'Magic Patch',            type: 'heal' },
  'utura':                { name: 'Recovery',               type: 'heal' },
  'utura gran':           { name: 'Intense Recovery',       type: 'heal' },
  'exana pox':            { name: 'Cure Poison',            type: 'heal' },
  'utani hur':            { name: 'Haste',                  type: 'support' },
  'utani gran hur':       { name: 'Strong Haste',           type: 'support' },
  'utevo lux':            { name: 'Light',                  type: 'support' },
  'utevo gran lux':       { name: 'Great Light',            type: 'support' },
  'utevo vis lux':        { name: 'Ultimate Light',         type: 'support' },
  'exani hur':            { name: 'Levitate',               type: 'support' },
  'exani tera':           { name: 'Magic Rope',             type: 'support' },
  'exiva':                { name: 'Find Person',            type: 'support' },
  'exiva moe res':        { name: 'Find Fiend',             type: 'support' },
  'exevo pan':            { name: 'Food',                   type: 'support' },
  'utevo res':            { name: 'Summon Creature',        type: 'support' },
  'utevo res ina':        { name: 'Creature Illusion',      type: 'support' },
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
  // turnsList: [{hits, dmgs:[{v,raw,ok}]}] -> {label, kind, turns, hitsMean, dmgBase, dmgEff}
  //   dmgBase = dano normalizado (sem crit/Onslaught/prey); dmgEff = dano cru do log.
  // Ambos excluem overkill (capado distorce); se SÓ houver overkill, usa-o como
  // fallback p/ não mostrar 0 quando houve hits.
  const hits = turnsList.map(x => x.hits);
  const all = [].concat(...turnsList.map(x => x.dmgs || []));
  const meanPref = sel => {
    const clean = all.filter(d => !d.ok).map(sel);
    const vals = clean.length ? clean : all.map(sel);
    return Math.round(clsMean(vals));
  };
  return { label, kind, turns: turnsList.length, hitsMean: clsMean(hits), dmgBase: meanPref(d => d.v), dmgEff: meanPref(d => d.raw), hitsPerTurn: hits };
}

// Conta hits e soma revertedDmg por componente, por turno (lê l.correctedComponent).
function clsBuildTurnRecords(turns) {
  return turns.map((t, i) => {
    const counts = { arrow: 0, spell: 0, rune: 0, grenade: 0 };
    const dmgs = { arrow: [], spell: [], rune: [], grenade: [] };
    // ts em que a SPELL realmente bateu — a spell AoE cai ~1s depois do AA, então alinhar
    // o cast pelo ts das hits de spell (e não pelo ts do AA, que é a 1ª hit do turno) evita
    // pegar o cast anterior por empate de distância. Default = ts do turno se não houver spell.
    const spellTsList = [];
    for (const l of (t.rpComponentLines || [])) {
      const c = l.correctedComponent; if (!(c in counts)) continue;
      counts[c]++;
      if (c === 'spell' && Number.isFinite(l.ts)) spellTsList.push(l.ts);
      if (Number.isFinite(l.revertedDmg) && l.revertedDmg > 0) dmgs[c].push({ v: l.revertedDmg, raw: l.dmg, ok: !!l.overkill });
    }
    const spellTs = spellTsList.length ? Math.min(...spellTsList) : t.ts;
    return { idx: i + 1, ts: t.ts, spellTs, counts, dmgs };
  });
}

// Spells de EXECUÇÃO: dano com bônus quando o alvo está abaixo do limiar de vida
// (Terra Burst / Ice Burst / Executioner's Throw). O bônus é um multiplicador discreto
// sobre o roll-base do cast (Terra Burst observado = ×1.60). Como o roll-base muda a
// cada cast, o salto só aparece TURNO A TURNO, relativo ao base do próprio turno.
// Valor = a chave do dano normalizado pelo elemento (dano ÷ mod do elemento do mob),
// que isola o bônus da resistência elemental e permite comparar entre mobs.
const CLS_EXECUTION_ELEMENT = {
  'exevo ulus tera':  'earthOriginal',     // Terra Burst (earth)
  'exevo ulus frigo': 'iceOriginal',       // Ice Burst (ice)
  'exori amp kor':    'physicalOriginal',  // Executioner's Throw (physical)
};
// salto que separa base de bônus dentro de um turno. Base interno é ~constante (mesmo
// roll → normalizado idêntico entre mobs), bônus observado = 1.6 → 1.4 separa com folga.
const CLS_BONUS_JUMP = 1.4;

// Separa os hits de UM cast de spell de execução em tiers base/bônus, pelo salto de dano
// normalizado dentro do turno. Regra do usuário: turno com 1 tier só = bônus ATIVO
// (quando todos os mobs do cast estão no mesmo nível, é o bônus rolando — confirmado nos
// logs: single-tier cai na faixa de bônus). Retorna {base:{hits,dmgs}, bonus:{hits,dmgs}}.
function clsSplitExecutionTiers(lines, elemKey) {
  const normOf = l => (Number.isFinite(l[elemKey]) && l[elemKey] > 0) ? l[elemKey] : (l.revertedDmg || l.dmg || 0);
  const clean = lines.filter(l => !l.overkill && normOf(l) > 0);
  const base = clean.length ? Math.min(...clean.map(normOf)) : 0;
  const twoTiers = base > 0 && clean.some(l => normOf(l) >= CLS_BONUS_JUMP * base);
  const out = { base: { hits: 0, dmgs: [] }, bonus: { hits: 0, dmgs: [] } };
  for (const l of lines) {
    const isBonus = !twoTiers ? true : (base > 0 && normOf(l) >= CLS_BONUS_JUMP * base);
    const slot = isBonus ? out.bonus : out.base;
    slot.hits++;
    if (Number.isFinite(l.revertedDmg) && l.revertedDmg > 0) slot.dmgs.push({ v: l.revertedDmg, raw: l.dmg, ok: !!l.overkill });
  }
  return out;
}

// Classificação MECÂNICA (não-RP / single-target) — regra do jogo: AA single-target +
// poder AoE (spell/runa). Granada (Divine Grenade) explode EXATAMENTE 3s após o cast →
// só conta se houver um hit no segundo C+3 (senão errou o alvo e deu 0 dano — não rouba
// o turno). O AA tem assinatura DIFERENTE por vocação, então `usePositional` decide:
//   • usePositional=true (single-target OU EK melee): AA = hit[0] (mais cedo por ts/seq),
//     SEMPRE presente. O golpe melee é logado ANTES da AoE e fere todo turno; a magnitude
//     não separa (a AoE acerta mobs de armaduras diferentes, e o AA pode estar ACIMA por
//     crit ou ABAIXO da banda da spell — confirmado nos turnos do EK).
//   • usePositional=false (caster druida/mage em pack): o AA de varinha é single-target e
//     INTERMITENTE — um outlier baixo PROFUNDO (~0.15× a banda AoE, ex.: 122 vs ~900) que
//     nem sempre é o 1º hit e nem sempre existe. Só separa AA se o menor hit não-overkill
//     for ≤ AA_DEPTH× o 2º menor; senão o turno é AoE puro (sem AA). A posição NÃO serve
//     (o 1º log pode ser um hit da AoE), então aqui manda a magnitude.
// 1 hit = poder se há cast/runa alinhado, senão AA — EXCETO se o hit for em magnitude de
// AA (≤ AA_FALSE_POWER_FACTOR× a referência), caso em que a runa/spell não saiu (varinha).
const AA_DEPTH = 0.5;
const AA_FALSE_POWER_FACTOR = 1.5;
function clsReclassifyByOrder(turns, runeUses, playerSpellCasts, playerGrenCasts, usePositional) {
  // granada: marca 1 hit por cast, no exato C+3
  const allLines = [];
  for (const t of turns) for (const l of (t.rpComponentLines || [])) allLines.push(l);
  const grenSet = new Set();
  for (const c of playerGrenCasts) {
    const hit = allLines.find(l => l.ts === c.ts + 3 && !grenSet.has(l));
    if (hit) grenSet.add(hit);
  }
  // Janela cast→turno: o cast PRECEDE os hits (uma spell não bate antes de ser lançada),
  // e o offset cast→hit observado é ~0. Logo [T-1, T+1] (só ±1 p/ skew de relógio). NÃO
  // olhar T+2: lá já é o turno seguinte — era o que fazia o cast do próximo Terra Burst
  // ser colado num turno de 1 hit (o AA de varinha) e o AA virar "spell".
  const nearRune = T => runeUses.some(u => u.ts >= T - 1 && u.ts <= T + 1);
  const nearSpell = T => playerSpellCasts.some(c => c.ts >= T - 1 && c.ts <= T + 1);
  // Referência de magnitude do AA (caster): nos turnos multi-hit, o AA de varinha é o
  // outlier baixo profundo (≤ AA_DEPTH× o 2º menor). A mediana dessas amostras serve p/
  // detectar runa/spell que foi "usada" mas NÃO saiu: nesse caso o único hit do turno é a
  // varinha (~aaRef), muito abaixo da banda do poder (ex.: uhax 19:52:18 — gfb base ~945,
  // AA ~120). EK/positional não tem essa assinatura → mantém o comportamento por cast.
  let aaRef = 0;
  if (!usePositional) {
    const samples = [];
    for (const t of turns) {
      const ng = (t.rpComponentLines || []).filter(l => !grenSet.has(l) && !l.overkill);
      if (ng.length < 2) continue;
      const s = ng.slice().sort((a, b) => a.revertedDmg - b.revertedDmg);
      if (s[0].revertedDmg <= AA_DEPTH * s[1].revertedDmg) samples.push(s[0].revertedDmg);
    }
    aaRef = samples.length ? median(samples) : 0;
  }
  for (const t of turns) {
    const ordered = (t.rpComponentLines || []).slice().sort((a, b) => (a.ts - b.ts) || ((a.seq || 0) - (b.seq || 0)));
    const nonGren = [];
    for (const l of ordered) { if (grenSet.has(l)) l.correctedComponent = 'grenade'; else nonGren.push(l); }
    if (!nonGren.length) continue;
    const rune = nearRune(t.ts), spell = nearSpell(t.ts);
    const power = rune ? 'rune' : 'spell';
    if (nonGren.length === 1) {
      // 1 hit em magnitude de AA (≪ banda do poder) ⇒ a runa/spell não saiu, é varinha.
      const looksAA = aaRef > 0 && nonGren[0].revertedDmg <= aaRef * AA_FALSE_POWER_FACTOR;
      nonGren[0].correctedComponent = ((rune || spell) && !looksAA) ? power : 'arrow';
      continue;
    }
    if (usePositional) {
      nonGren.forEach((l, i) => { l.correctedComponent = (i === 0) ? 'arrow' : power; });
    } else {
      const clean = nonGren.filter(l => !l.overkill).slice().sort((a, b) => a.revertedDmg - b.revertedDmg);
      const aa = (clean.length >= 2 && clean[0].revertedDmg <= AA_DEPTH * clean[1].revertedDmg) ? clean[0] : null;
      nonGren.forEach(l => { l.correctedComponent = (l === aa) ? 'arrow' : power; });
    }
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
      // remove alvo entre aspas (exura sio "nome" -> exura sio) p/ casar na tabela
      text: (m[6] || '').trim().toLowerCase().replace(/\s*"[^"]*"\s*/g, ' ').replace(/\s+/g, ' ').trim(),
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
function classifyWithLocalChat(serverLogText, localChatText, opts) {
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
    // O jogador (dono do server log) tem suas casts TURN-LOCKED (≈1 por turno de
    // dano deste log); party-mates aparecem com overcast alto (castam mais do que
    // cai neste log, ou em mobs que não são os do log). Prefere turn-locked
    // (overcast<=OVERCAST), depois maior recall.
    const lock = g => (g.overcast <= OVERCAST ? 1 : 0);
    player = pool.slice().sort((a, b) => lock(b) - lock(a) || b.recall - a.recall || a.overcast - b.overcast)[0].speaker;
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

  // Regime de classificação:
  //  • RP em pack (≥2 mobs): mantém o classificador de bandas (validado 38/38) —
  //    no RP o "arrow" é AoE multi-hit e a separação holy por assinatura funciona.
  //  • Boss single-target OU outras vocações (EK/mage/…): separação MECÂNICA por
  //    ordem (AA single-target = hit[0]; AoE spell/runa depois), sem assinatura
  //    elemental. (O AA do EK é melee single-target; o band classifier holy não serve.)
  const RP_ATTACK = new Set(['exevo mas san', 'exori san', 'exori con', 'exori gran con',
    'exori infir con', 'exori dir san', 'exori dir moe', 'utori san', 'exevo tempo mas san']);
  const isRpRegime = damageSpells.concat(grenadeSpells).some(t => RP_ATTACK.has(t));
  if (data.distinctMobs === 1 || !isRpRegime) {
    // AA posicional p/ single-target (1 mob, sem banda) e p/ EK melee (golpe físico todo
    // turno, logado 1º); caster (druida/mage: spell exevo / runa) usa o AA por outlier.
    const isMeleeVoc = damageSpells.some(t => /^exori\b/.test(t));
    const usePositional = data.distinctMobs === 1 || isMeleeVoc;
    clsReclassifyByOrder(turns, runeUses, playerSpellCasts, playerGrenCasts, usePositional);
    turnRecords = clsBuildTurnRecords(turns);
  }

  const nearestGren = G => {
    let best = null, bestDt = 99;
    for (const c of playerGrenCasts) if (c.ts >= G - 3 && c.ts <= G - 1) { const dt = G - c.ts; if (dt < bestDt) { bestDt = dt; best = c; } }
    return best;
  };

  const perSpell = new Map(), perGren = new Map(), perRune = new Map();
  const perSpellTiers = new Map();  // spells de execução: {base:[...], bonus:[...]} por cast
  const arrowAligned = []; let excludedTurns = 0;
  // Séries por turno ALINHADO p/ os gráficos (mesma base do validador, sem simulação):
  // temporalSeries = hits/dano/relTime por turno; componentSeries = hits por componente.
  const baseTs = turns[0].ts;
  const temporalSeries = [];
  // por turno alinhado, a contribuição de cada componente/spell (p/ o gráfico "componentes
  // por turno"): uma linha por linha real da rotação, não o set fixo do validador.
  const alignedTurns = [];
  const componentSeries = { arrowHitsPerTurn: [], spellHitsPerTurn: [], runeHitsPerTurn: [], grenadeHitsPerShot: [] };
  // diagnóstico opcional (oráculo): traço por turno alinhado, sem footprint no app.
  const traceOn = !!(opts && opts.trace);
  const turnTrace = [];
  for (const r of turnRecords) {
    const sCast = r.counts.spell > 0 ? clsNearest(playerSpellCasts, r.spellTs) : null;
    const gCast = r.counts.grenade > 0 ? nearestGren(r.ts) : null;
    const rUse = r.counts.rune > 0 ? clsNearest(runeUses, r.ts) : null;
    const aligned = (r.counts.spell === 0 || sCast) && (r.counts.grenade === 0 || gCast) && (r.counts.rune === 0 || rUse);
    if (!aligned) { excludedTurns++; continue; }
    if (r.counts.arrow > 0) arrowAligned.push({ hits: r.counts.arrow, dmgs: r.dmgs.arrow });
    if (sCast) { if (!perSpell.has(sCast.text)) perSpell.set(sCast.text, []); perSpell.get(sCast.text).push({ hits: r.counts.spell, dmgs: r.dmgs.spell }); }
    if (sCast && CLS_EXECUTION_ELEMENT[sCast.text] && r.counts.spell > 0) {
      const spellLines = (turns[r.idx - 1].rpComponentLines || []).filter(l => l.correctedComponent === 'spell');
      const tiers = clsSplitExecutionTiers(spellLines, CLS_EXECUTION_ELEMENT[sCast.text]);
      if (!perSpellTiers.has(sCast.text)) perSpellTiers.set(sCast.text, { base: [], bonus: [] });
      const pt = perSpellTiers.get(sCast.text);
      if (tiers.base.hits) pt.base.push(tiers.base);
      if (tiers.bonus.hits) pt.bonus.push(tiers.bonus);
    }
    if (gCast) { if (!perGren.has(gCast.text)) perGren.set(gCast.text, []); perGren.get(gCast.text).push({ hits: r.counts.grenade, dmgs: r.dmgs.grenade }); }
    if (rUse) { if (!perRune.has(rUse.name)) perRune.set(rUse.name, []); perRune.get(rUse.name).push({ hits: r.counts.rune, dmgs: r.dmgs.rune }); }
    const sumRaw = c => r.dmgs[c].reduce((a, d) => a + (d.raw || 0), 0);
    temporalSeries.push({
      relTime: r.ts - baseTs,
      mobsHit: r.counts.arrow + r.counts.spell + r.counts.rune + r.counts.grenade,
      components: { arrow: r.counts.arrow, spell: r.counts.spell, rune: r.counts.rune, grenade: r.counts.grenade },
      damage: sumRaw('arrow') + sumRaw('spell') + sumRaw('rune') + sumRaw('grenade'),
    });
    componentSeries.arrowHitsPerTurn.push(r.counts.arrow);
    componentSeries.spellHitsPerTurn.push(r.counts.spell);
    componentSeries.runeHitsPerTurn.push(r.counts.rune);
    if (r.counts.grenade > 0) componentSeries.grenadeHitsPerShot.push(r.counts.grenade);
    alignedTurns.push({
      arrow: r.counts.arrow,
      spellText: sCast ? sCast.text : null, spellHits: r.counts.spell,
      runeName: rUse ? rUse.name : null, runeHits: r.counts.rune,
      grenText: gCast ? gCast.text : null, grenHits: r.counts.grenade,
    });
    if (traceOn) {
      turnTrace.push({
        idx: r.idx, ts: r.ts,
        spell: sCast ? sCast.text : null, rune: rUse ? rUse.name : null, gren: gCast ? gCast.text : null,
        counts: r.counts,
        lines: (turns[r.idx - 1].rpComponentLines || []).map(l => ({
          mob: l.mob, dmg: l.dmg, base: l.revertedDmg, comp: l.correctedComponent, ok: !!l.overkill,
          ts: l.ts, seq: l.seq || 0,
        })),
      });
    }
  }

  // --- tabela única (ordem: arrow · runas · spells · granada) ---
  const grenLabel = text => clsSpellLabel(text);
  const rows = [];
  if (arrowAligned.length) {
    const aRow = clsAgg('Auto ataque', 'arrow', arrowAligned);
    aRow.hitsTimeline = alignedTurns.map(a => a.arrow);
    rows.push(aRow);
  }
  for (const [name, list] of [...perRune.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const rRow = clsAgg(name, 'rune', list);
    rRow.hitsTimeline = alignedTurns.map(a => a.runeName === name ? a.runeHits : 0);
    rows.push(rRow);
  }
  for (const [text, list] of [...perSpell.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const row = clsAgg(clsSpellLabel(text), 'spell', list);
    row.hitsTimeline = alignedTurns.map(a => a.spellText === text ? a.spellHits : 0);
    const pt = perSpellTiers.get(text);
    if (pt && (pt.base.length || pt.bonus.length)) {
      row.tiers = [];
      // hits méd do tier = total de hits do tier / turnos do PAI (list.length), p/ que
      // base + bônus somem a média da linha pai (não a média por turno só do tier).
      const tierAgg = (kind, tierList) => {
        const a = clsAgg('', kind, tierList);
        a.hitsMean = list.length ? tierList.reduce((s, x) => s + x.hits, 0) / list.length : 0;
        return a;
      };
      if (pt.base.length) row.tiers.push(tierAgg('tier_base', pt.base));
      if (pt.bonus.length) row.tiers.push(tierAgg('tier_bonus', pt.bonus));
      const b = row.tiers.find(x => x.kind === 'tier_base'), bo = row.tiers.find(x => x.kind === 'tier_bonus');
      if (b && bo && b.dmgBase > 0) row.bonusMult = bo.dmgBase / b.dmgBase;
    }
    rows.push(row);
  }
  for (const [text, list] of [...perGren.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const gRow = clsAgg(grenLabel(text), 'grenade', list);
    gRow.hitsTimeline = alignedTurns.map(a => a.grenText === text ? a.grenHits : 0);
    rows.push(gRow);
  }
  // granadas castadas que NÃO deram dano (erraram): mostra a linha com 0 hits / 0 dano.
  for (const text of grenadeSpells) {
    if (perGren.has(text)) continue;
    const casts = playerGrenCasts.filter(c => c.text === text && c.ts >= winLo && c.ts <= winHi).length;
    if (casts > 0) rows.push({ label: grenLabel(text), kind: 'grenade', turns: casts, hitsMean: 0, dmgBase: 0, dmgEff: 0 });
  }

  return {
    data, player, damageSpells, grenadeSpells, ranked, rows,
    totalTurns: turns.length, excludedTurns,
    spellTurnCount: spellTurns.length, grenadeTurnCount: grenadeTurns.length, runeTurnCount: runeTurns.length,
    temporalSeries, componentSeries,
    turnTrace: traceOn ? turnTrace : undefined,
  };
}
