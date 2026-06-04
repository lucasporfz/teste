# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-page **Tibia hunt XP/h calculator + simulator + server-log validator**. It parses combat logs, infers a player's damage/coverage/rotation, simulates hunts to estimate XP/h, and validates the simulation against the real log. UI and comments are **Portuguese (pt-BR)** (`js/i18n.js` holds pt/en strings).

The active app is **`index novo.html`**. `index atual.html`, `calculadora.html`, and `tibia_sim.py` are older/abandoned versions — ignore them. `skills-main/`, `ui-ux-pro-max-skill-main/`, and `wheel/` are unrelated vendored content — ignore them.

## Running and checking (no build system)

There is **no package.json, bundler, or test framework**. The app is plain HTML + `<script>` files opened in a browser (use a Live Server / static server; `Chart.js` is loaded from a CDN). The simulation can only run in the browser (it relies on a Web Worker and `self`); it cannot be exercised headless.

- **Syntax check a JS file:** `node --check js/<file>.js`
- **Parse-check the inline HTML scripts:** extract `<script>` blocks and run them through `new Function(...)`. There are exactly **2 inline non-`src` script blocks** (the Web Worker block + the main app block).
- The browser-only XP/h validation is done **by the user in the app** — you cannot verify XP/h numbers from the CLI.

## js/ modules: globals, not modules

Files in `js/` are loaded as plain `<script src>` (see `index novo.html` ~L1013–L1021). They share one **global scope** — there are no `import`/`export`. **Load order matters**:

`i18n.js` → (worker block) → `stats.js` → `sim-core.js` → `parser-rp-helpers.js` → `parser.js` → `guide.js` → `paladin.js` → `log-generator.js` → `histogram.js` → `validator-comparison.js` → `classifier-parser.js` → `classifier.js` → main inline block.

A function defined in an earlier file is callable from a later one (e.g. `parser.js` uses helpers from `parser-rp-helpers.js`). When adding a shared helper, define it in a file that loads before its callers.

## ⚠️ The simulation engine is duplicated in 4 places — keep them in sync

The core per-turn simulation loop exists in **four copies**, and any change to sim mechanics (damage, AoE coverage, rune/spell mix, grenade) must be applied to **all** of them:

1. **Inline Web Worker** in `index novo.html` (`<script id="simWorker" type="javascript/worker">`, turned into a Blob) — `simSession`/`simulateLevel`, the per-level XP/h sweep that runs off the main thread.
2. **`runSimInline`** + its inner `simSession` in `index novo.html` — same logic, main-thread fallback.
3. **`collectSimHitDistribution`** in `index novo.html` — the validator's hit-distribution / XP comparison and per-component histograms.
4. **`generateHuntLog`** in `js/log-generator.js` — powers "ver log de hunt deste modelo".

Params flow: `parser.js` (extracted from log) → `js/validator-comparison.js` (`simConfig` + `baseSimState`) → the engines. A new sim parameter must be threaded through the validator config(s), the worker `onmessage` destructuring + `rpMix` object, the `runSimInline`/`collectSimHitDistribution` destructuring, and `log-generator.js`'s `buildLogInputFromConfig`.

## Parser & RP component classifier (the most delicate code)

`parser.js parseServerLog()`: log text → `events` → `turns` (2-second windows) → `turnStats`. For Paladin ("RP") it classifies each turn's hits into **arrow / spell / rune / grenade** via `js/parser-rp-helpers.js` (`classifyRpTurnComponents` → `rpClassifyTurnByBands` / `correctRpComponentsByElement`).

Hard-won classifier rules (do not loosen without re-validating):
- **Holy damage is deterministic**: same mob + same component = **identical raw damage** (`EQ = 0`, exact). Arrow is physical and varies. This separates arrow from spell/grenade even when they differ by ~1.
- **`holyConst`**: a band's `holyOriginal` is ~constant cross-mob (tight, ~2%), but tolerates **one** mob with an imprecise element mod by requiring only a **majority** of mobs to agree.
- **`isHolyBand`** = same-mob-exact + `holyConst`.
- **Grenade** = two stacked real holy bands (spell + grenade); the lower one needs `sustained` (a mob repeats) **and** `isHolyBand`; an arrow prefix is required. Independent of which second the grenade lands in.
- **Onslaught** (weapon proc, +60% fixed) is **additive over base with crit** (`÷(1 + (crit−1) + 0.6)`), not multiplicative; it is excluded from the crit-multiplier/rate pool. See `rpAmplificationDivisor`.

`js/validator-comparison.js` runs ~several candidate RP models per log, scores them (`scoreCandidateByVocation`), and picks the best for `auto`. "Artifice" models that force good XP without simulating well are flagged `diagnosticOnly` (selectable manually but excluded from `auto`).

## Testing the classifier: the gabarito (oracle)

`tools/rp-gabarito.mjs` is the regression oracle: **38 ground-truth turns** (`GAB` map, confirmed by the user) spanning arrow/spell/grenade, false-explode, false-rune, crit-runs, same-second grenades, imprecise mob mods, and spell-without-repeat.

- `node tools/rp-gabarito.mjs` — runs the **offline copy** of the algorithm (`rpClassifyTurn`, defined inside the tool).
- `node tools/rp-gabarito.mjs --parser` — runs the **real parser** (`rpClassifyTurnByBands`).
- Both must report **38/38**. Add `--verbose` to see per-turn lines.

**Critical workflow:** the algorithm exists in two copies — the offline `rpClassifyTurn` in `rp-gabarito.mjs` and the real `rpClassifyTurnByBands` in `parser-rp-helpers.js`. Derive/validate a change **offline first**, then port it to the parser, and confirm both modes stay 38/38. When the user dictates a new ground-truth turn, add it to `GAB` before changing the parser.

Other dev tools (all load the real parser by extracting `MOB_ELEMENT_MODS` + functions from `index novo.html` into a Node `vm` sandbox; run **one log per process** — parser state contaminates across logs):
- `node tools/rp-table.mjs "<log>" <turn1based> [...]` — per-hit table (dmg, holyBase, físBase, crit, overkill, second, current classification). Use this to inspect a turn with the user.
- `node tools/rp-analyze.mjs "<log>"` — per-log anomaly audit (component band consistency, false-explode, counts).
- `node tools/rp-markov.mjs "<log>"` — coverage / crit / rune-spell-mix diagnostics.
- `node tools/check-inline.mjs` — parse-checks the 2 inline `<script>` blocks of `index novo.html` (the documented HTML check).

## The Classificador (parallel feature — separate from the Validador)

A second mode (button **"classificador"** next to "validador") that crosses a **server log** + a **local chat** to report, in one **rotation table**, per component/spell: **turns, avg hits, dano base, dano efetivo**. **No simulation** — only observed hits/damage. Built so the **Validador parser stays untouched**. Works for all vocations (RP/EK validated; mage/druid/monk by the same mechanics).

- **Its own parser** `js/classifier-parser.js` (`parseLogForClassifier`) — a trimmed, classifier-exclusive parse: **no `log_too_short` guard** (reads single-kill boss fights), article `A/An/The` **optional** (bosses have proper names: "Murcion loses…"). It **reuses the shared classification helpers** (`correctRpComponentsByElement` / `rpClassifyTurnByBands`) — shared logic, *not* "the validador parser" (`parseServerLog`, never called here).
- **Spell table** `CLS_SPELLS` (`js/classifier.js`): **every** spell of **all vocations** (incantation → name + type), read from the **TibiaWiki Spells page** (the user pastes its HTML; both fandom and tibia.com block WebFetch / are incomplete). type ∈ `attack` / `grenade` (Divine Grenade) / `heal` / `support`. Incantations with a quoted target (`exura sio "name"`) are normalized (quotes stripped) before lookup.
- **Join logic** `classifyWithLocalChat`: parses the local chat (`HH:MM:SS Name [level]: text`), auto-detects the **player** (best-recall caster of a *known* attack/grenade spell — avoids a party-mate's other-vocation spell), classifies incantations as **spell / grenade / —**, and joins by timestamp. **spell** = cast in `[T-1,T+2]`; **grenade** (Divine Grenade) = cast ~3s before the explosion; heal/support excluded.
- **Component split = MECHANICAL, by order (user rule): AA single-target first, then AoE spell/rune** — *not* by elemental signature.
  - **RP in a pack** (≥2 mobs): uses the shared **band classifier** (the validated 38/38 holy-consistency path) — in RP the "arrow" is AoE multi-hit.
  - **Single-target boss (`distinctMobs===1`) OR any non-RP vocation** (EK/mage…): `clsReclassifyByOrder` — `hit[0]` = **Auto ataque** (the single-target AA), the rest = the power (spell/rune/grenade). Grenade hit only at **exactly `C+3`** (cast→explode 3s); if absent it dealt 0 (shown as a 0/0 row, does **not** steal the neighbor's spell turn). A 1-hit turn is power-only if a cast/rune aligns, else AA-only.
- **Strict alignment**: a turn is analyzed **only if every cast component (spell/grenade via local chat, rune via the "Using one of N … runes" server line) matches 100%**; else the whole turn (AA included) is dropped.
- **Damage columns**: per hit, `revertedDmg` (crit/Onslaught/prey removed = **dano base**) and the raw log `dmg` (**dano efetivo**). Both **exclude overkill** (capped → distorts the mean), with overkill as **fallback** only when a component has *no* clean sample (so it never shows 0 when there were hits). Label for the AA component is **"Auto ataque"** (i18n `cls_comp_arrow`).
- **Oracle**: `node tools/rp-classify-proto.mjs "<server log>" "<local chat>"` loads the real `classifier-parser.js` + `classifier.js` in a `vm` and prints the rotation table + incantation detection (one pair per process). Fixtures: `server log rp` + `localchat rp` (RP pack), `darklight …` (RP party pack), `murcion …` (RP single-target boss), `bastion …` / `night harpy …` (EK packs).

## Conventions

- Windows + PowerShell environment. The `Bash` tool is also available; note heredocs mangle backslashes — write `.mjs`/script files with the `Write` tool, not heredocs.
- Commit only when asked; end commit messages with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- `logs/*.txt` are real combat logs used as fixtures by the gabarito/tools. `.claude/settings.local.json` and `.claude/scheduled_tasks.lock` are local and not committed.

---

# Behavioral guidelines

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
