#!/usr/bin/env node
// Testador OFFLINE do classificador RP contra o GABARITO (faixas confirmadas pelo usuário).
// Carrega o parser real só pra obter os hits por turno (mob/dmg/holyBase/físBase/crit/overkill/ts);
// aplica o ALGORITMO CANDIDATO (rpClassifyTurn, definido aqui) e compara com o gabarito.
// NÃO toca no parser. Uso: node tools/rp-gabarito.mjs [--verbose]
import fs from 'node:fs'; import vm from 'node:vm'; import path from 'node:path'; import process from 'node:process';
const ROOT = process.cwd(); const read = p => fs.readFileSync(p, 'utf8');
const html = read(path.join(ROOT, 'index novo.html'));
function brace(s, from, open) { const cl = open === '{' ? '}' : ']'; const oi = s.indexOf(open, from); let d = 0, st = null; for (let i = oi; i < s.length; i++) { const ch = s[i], pv = s[i - 1]; if (st) { if (ch === st && pv !== '\\') st = null; continue; } if (ch === '"' || ch === "'" || ch === '`') { st = ch; continue; } if (ch === open) d++; else if (ch === cl) { d--; if (d === 0) return s.slice(oi, i + 1); } } return null; }
function ext(name) { let i = html.indexOf('function ' + name + '('); if (i >= 0) return html.slice(i, html.indexOf('{', i)) + brace(html, i, '{'); for (const kw of ['const ', 'let ', 'var ']) { const j = html.indexOf(kw + name); if (j >= 0) { const eq = html.indexOf('=', j); const o = html.indexOf('{', eq), b = html.indexOf('[', eq); const open = (b >= 0 && (o < 0 || b < o)) ? '[' : '{'; return kw + name + '=' + brace(html, eq, open) + ';'; } } return null; }
const mi = html.indexOf('MOB_ELEMENT_MODS'), eq = html.indexOf('=', mi), MODS = JSON.parse(brace(html, eq, '{'));

function loadTurns(log) {
  const ctx = { MOB_ELEMENT_MODS: MODS, console, Math, JSON, Array, Object, Number, String, isFinite, isNaN, parseInt, parseFloat, Date };
  vm.createContext(ctx);
  for (const f of ['js/stats.js', 'js/paladin.js', 'js/parser-rp-helpers.js', 'js/parser.js']) vm.runInContext(read(path.join(ROOT, f)), ctx);
  for (const n of ['MOBS_TABLE', 'percentile', 'extractRpGrenadePeakResidual']) if (typeof ctx[n] === 'undefined') { const s = ext(n); if (s) vm.runInContext(s, ctx); }
  const orig = ctx.correctRpComponentsByElement; ctx.correctRpComponentsByElement = function (t, ts, ...r) { const x = orig.call(this, t, ts, ...r); ctx.__cap = ts; return x; };
  ctx.parseServerLog(read(log), true);
  return ctx.__cap;
}

// ---- GABARITO: faixas corretas (0-based, inclusivas). Componentes na ordem arrow→spell→granada. ----
// ranges: [arrowEnd, spellEnd] => arrow=[0,arrowEnd), spell=[arrowEnd,spellEnd), grenade=[spellEnd,n)
const GAB = {
  'logs/rp ingol.txt': { 16:[8,17], 24:[8,16], 46:[8,17], 63:[6,12], 80:[7,13], 119:[4,10], 155:[12,12], 156:[13,26] },
  'logs/mazzerin rp.txt': { 2:[10,22], 22:[7,7], 35:[4,12], 37:[9,19], 47:[3,12], 53:[6,15], 75:[10,20], 99:[11,22], 117:[10,21], 127:[6,10], 158:[10,14] },
  'logs/server log rp.txt': { 15:[10,21], 26:[6,13], 69:[8,17], 78:[8,8], 83:[10,20], 85:[12,28], 87:[9,21], 89:[5,13], 91:[9,21], 93:[8,19], 99:[9,20], 131:[6,16] },
  'logs/agazi rp.txt': { 34:[7,15] },
  'logs/dlc rp 1.txt': { 92:[12,26], 110:[8,24] },
  'logs/dlc rp 2.txt': { 3:[9,22], 155:[10,23] },
  'logs/dlc rp 3.txt': { 63:[9,18], 127:[10,21] },
};

// ===================== ALGORITMO CANDIDATO =====================
// hits: [{dmg, holy, phys, crit, overkill, mob, ts}], ordem do log. mark: 'explode'|'cast'|'normal'.
// Retorna {arrowEnd, spellEnd}.
function rpClassifyTurn(hits, mark) {
  const n = hits.length;
  if (n === 0) return { arrowEnd: 0, spellEnd: 0 };
  if (mark === 'cast') return { arrowEnd: n, spellEnd: n };
  const EQ = 0; // holy é determinístico: mesmo mob + mesma componente = dano cru EXATO (±0).
  const eq = (a, b) => Math.abs(a - b) <= EQ;
  // valor usado pra comparar "mesmo mob, mesmo componente = mesmo dano EXATO" = o dano cru.
  const val = i => hits[i].dmg;
  const mobOf = i => hits[i].mob;

  // Crit-run: troca de estado-de-crit é fronteira de componente (regra do usuário).
  const critChanges = [];
  for (let i = 1; i < n; i++) if (hits[i].crit !== hits[i-1].crit) critChanges.push(i);

  // BACKWARD-SCAN por âncora-de-mob (método do usuário no t117):
  // De trás pra frente, monta a banda corrente. Cada mob fixa sua âncora (1º dano visto na banda).
  // Um hit continua na banda se: overkill (ambíguo) OU mob ainda não visto na banda OU bate exato
  // com a âncora do seu mob. Um hit QUEBRA a banda se: não-overkill E mob já visto na banda E dano
  // difere da âncora. Retorna o índice de início da banda (primeiro hit que pertence a ela).
  function bandStart(hi) {
    const anchor = Object.create(null);
    let start = hi; // exclusivo no topo; banda = [start, hi)
    for (let i = hi - 1; i >= 0; i--) {
      if (hits[i].overkill) { start = i; continue; }
      const m = mobOf(i), v = val(i);
      if (anchor[m] === undefined) { anchor[m] = v; start = i; continue; }
      if (eq(v, anchor[m])) { start = i; continue; }
      break; // âncora do mob diverge → fim da banda
    }
    return start;
  }
  // exige que a banda seja "sustentada": algum mob repetiu (≥2 hits do mesmo mob com dano igual).
  function sustained(lo, hi) {
    const c = Object.create(null);
    for (let i = lo; i < hi; i++) { if (hits[i].overkill) continue; const m = mobOf(i); (c[m] = c[m] || []).push(val(i)); }
    for (const m in c) { const ds = c[m]; for (let a = 0; a < ds.length; a++) for (let b = a+1; b < ds.length; b++) if (eq(ds[a], ds[b])) return true; }
    return false;
  }
  // banda holy-constante cross-mob: spell e granada normalizam ao MESMO holyBase entre mobs
  // distintos (≥2 mobs, todos dentro de ~6%). Arrow (físico) NÃO satisfaz. = "danos iguais".
  function holyConst(lo, hi) {
    const byMob = Object.create(null);
    for (let i = lo; i < hi; i++) { if (hits[i].overkill) continue; const h = hits[i].holy; if (!Number.isFinite(h) || h <= 0) continue; const m = mobOf(i); (byMob[m] = byMob[m] || []).push(h); }
    const meds = []; for (const m in byMob) { const a = byMob[m].sort((x, y) => x - y); meds.push(a[a.length >> 1]); }
    if (meds.length < 2) return false;
    const c = meds.slice().sort((x, y) => x - y)[meds.length >> 1];
    // holyBase deve ser ~constante cross-mob com tolerância APERTADA (~2%): spell/granada reais
    // são quase exatos; cauda de arrow tem spread maior (t155/t78). Tolera 1 mob com mod impreciso
    // (liod/striker) exigindo só MAIORIA dos mobs concordando (não todos).
    const tol = Math.max(12, c * 0.02);
    const agree = meds.filter(v => Math.abs(v - c) <= tol).length;
    return agree >= 2 && agree * 2 >= meds.length;
  }

  // banda holy REAL (consistência exata): (a) cada mob com ≥2 hits não-overkill tem dano cru
  // IDÊNTICO (holy é determinístico; arrow varia → t99 cyclursus 771≠772 reprova) E (b) holyConst
  // cross-mob (≥2 mobs no mesmo nível-base). Cobre spell-sem-repetição (t34, cada mob 1×) via (b).
  function isHolyBand(lo, hi) {
    const byMob = Object.create(null);
    for (let i = lo; i < hi; i++) { if (hits[i].overkill) continue; const m = mobOf(i); (byMob[m] = byMob[m] || []).push(val(i)); }
    for (const m in byMob) { const ds = byMob[m]; for (let k = 1; k < ds.length; k++) if (ds[k] !== ds[0]) return false; }
    return holyConst(lo, hi);
  }

  const t0ts = hits[0].ts;
  const secStartFrom = (lo) => { for (let i = lo; i < n; i++) if (Number.isFinite(hits[i].ts) && hits[i].ts > t0ts) return i; return -1; };

  // CRIT-RUN como espinha (regra do usuário): troca crit↔não-crit = fronteira de componente.
  if (critChanges.length === 2) {
    return { arrowEnd: critChanges[0], spellEnd: critChanges[1] };
  }
  if (critChanges.length === 1) {
    const c0 = critChanges[0];
    if (mark === 'explode') {
      // (b') prefixo crit = arrow inteiro; sufixo não-crit = spell + granada (DUAS bandas holy).
      const sg1 = bandStart(n);
      const sg2 = sg1 > c0 ? bandStart(sg1) : c0;
      if (sg2 >= c0 && sg1 > sg2 && sustained(sg2, sg1) && holyConst(sg2, sg1) && holyConst(sg1, n)) {
        return { arrowEnd: c0, spellEnd: sg1 };
      }
      const aEndPrefix = bandStart(c0);
      if (aEndPrefix < c0 && sustained(aEndPrefix, c0)) {
        return { arrowEnd: aEndPrefix, spellEnd: c0 }; // (a) arrow+spell no prefixo, granada sufixo
      }
      const sec = secStartFrom(c0);
      let sEnd;
      if (sec > c0) sEnd = sec;
      else { sEnd = bandStart(n); if (sEnd <= c0 || !sustained(sEnd, n)) sEnd = n; }
      return { arrowEnd: c0, spellEnd: sEnd }; // (b) arrow prefixo, spell+granada sufixo
    }
    return { arrowEnd: c0, spellEnd: n };
  }

  const b1 = bandStart(n);
  // banda final mágica = sustentada OU banda holy real (spell que acerta cada mob 1× — t34).
  // Senão o fim é arrow → tudo arrow (t78, t155).
  if (!sustained(b1, n) && !isHolyBand(b1, n)) {
    return { arrowEnd: n, spellEnd: n };
  }
  const b2 = b1 > 0 ? bandStart(b1) : 0;

  // GRANADA = DUAS bandas holy REAIS empilhadas (spell [b2,b1) + granada [b1,n)). A 2ª banda
  // precisa: (i) sustained = algum mob repete (descarta cauda de arrow SEM repetição — t87/t26/t89),
  // E (ii) isHolyBand = mesmo mob com dano IDÊNTICO (descarta cauda de arrow que repete mas VARIA —
  // t99 cyclursus 771≠772, t131 506≠507). Prefixo arrow [0,b2).
  if (b2 > 0 && sustained(b2, b1) && isHolyBand(b2, b1) && isHolyBand(b1, n)) {
    return { arrowEnd: b2, spellEnd: b1 };
  }

  // Sem granada: arrow + spell (banda final = spell; resto = arrow).
  return { arrowEnd: b1, spellEnd: n };
}
// ===============================================================

function holyMod(mob){ const m = MODS[(mob||'').toLowerCase().trim()]; return m && m.holyDmgMod || 1; }
function physMod(mob){ const m = MODS[(mob||'').toLowerCase().trim()]; return m && m.physicalDmgMod || 1; }

const verbose = process.argv.includes('--verbose');
const useParser = process.argv.includes('--parser'); // lê o output REAL do parser, não a cópia offline
let pass = 0, fail = 0;
for (const log of Object.keys(GAB)) {
  const T = loadTurns(log);
  for (const tnStr of Object.keys(GAB[log])) {
    const tn = +tnStr; const st = T[tn - 1]; const L = st.rpComponentLines || [];
    const hits = L.map(l => ({ dmg: l.dmg, holy: l.holyOriginal || (l.dmg/holyMod(l.mob)), phys: l.physicalOriginal || (l.dmg/physMod(l.mob)), crit: l.type === 'crit', overkill: !!l.overkill, mob: l.mob, ts: l.ts }));
    let got;
    if (useParser) {
      let aEnd = L.findIndex(l => l.correctedComponent !== 'arrow'); if (aEnd < 0) aEnd = L.length;
      let sEnd = L.findIndex(l => l.correctedComponent === 'grenade'); if (sEnd < 0) sEnd = L.length;
      got = { arrowEnd: aEnd, spellEnd: sEnd };
    } else {
      got = rpClassifyTurn(hits, st.rpGrenade || 'normal');
    }
    const [ga, gs] = GAB[log][tn];
    // Fronteiras em cima de hit OVERKILL são "tanto faz" (usuário): aceita se o único desvio
    // está num índice de borda que é overkill (o componente do overkill é ambíguo).
    const okExact = got.arrowEnd === ga && got.spellEnd === gs;
    // Borda "tanto faz" (usuário): aceita se TODOS os hits entre a borda obtida e a esperada
    // são overkill (componente ambíguo — dano capado, herda posição).
    const tol = (gotB, expB) => { const lo = Math.min(gotB, expB), hi = Math.max(gotB, expB); for (let i = lo; i < hi; i++) if (!hits[i] || !hits[i].overkill) return false; return true; };
    const ok = okExact || (tol(got.arrowEnd, ga) && tol(got.spellEnd, gs));
    if (ok) pass++; else fail++;
    if (!ok || verbose) {
      console.log(`${ok?'OK ':'XX '} ${log.split('/').pop().replace('.txt','')} t${tn} [${st.rpGrenade||'normal'}] esperado a0-${ga-1}/s${ga}-${gs-1}/g${gs}-${L.length-1}  obtido a0-${got.arrowEnd-1}/s${got.arrowEnd}-${got.spellEnd-1}/g${got.spellEnd}-${L.length-1}`);
    }
  }
}
console.log(`\nRESULTADO: ${pass} OK / ${fail} ERRO (de ${pass+fail})`);
