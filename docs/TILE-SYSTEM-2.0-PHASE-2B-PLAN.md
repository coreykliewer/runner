# Runner Tile System 2.0: Phase 2B Integration Plan

**Status:** Technical plan for review only. No Phase 2B code changes are authorized by this document.

Phase 2A is present at `219d863561c058e0662cd4db3d4cb0ce849924a0`. Its dice engine and rule dispatcher remain independent of gameplay. This plan describes how to integrate them without changing active catalogs/levels, the Tile Builder UI, or the existing save and resume formats.

## 1. Current Worktree and Overlap

The worktree was inspected before planning. The following pre-existing changes are uncommitted and must not be overwritten, discarded, or included in a Phase 2B commit.

| Worktree paths | Current change | Phase 2B overlap / handling |
| --- | --- | --- |
| `game.js` | Adds encounter-module loading, an activation ledger, `runEncounterRulesAtEvent()`, and calls after movement, forced-down, turbo, and rolls. | **Direct overlap.** Reconcile with the user before replacing or reusing these hooks. They currently dispatch `after_move`/`after_roll` independently of Phase 2A event batches. |
| `src/encounterRules.js`, `tests/encounterRules.test.js` | Untracked expression parser, Manhattan/Chebyshev range and position checks, v1 encounter-rule validation/resolution, local order/repeat modes, damage-only actions. | **Direct conceptual overlap.** Preserve its safe expression, range, and position behavior through an adapter or an explicitly approved consolidation. Do not import this untracked module into a committed engine path without approval. |
| `src/validation.js`, `tests/validation.test.js` | Modified to import/validate the untracked encounter-rule format. | **Direct schema overlap.** Reconcile before moving legacy definitions into Phase 2A rules; leave these existing edits untouched meanwhile. |
| `tests/numeric-gameplay.browser.spec.js` | Adds browser coverage for the uncommitted encounter path. | **Direct runtime overlap.** Keep intact and use as a parity baseline after its author/worktree changes are reconciled. |
| `editor.css`, `src/editor/tilePropertyEditor.js`, `src/tileProperties.js`, `src/editor/encounterRuleEditor.js`, `tests/editor-studio.browser.spec.js` | Adds encounter-rule property metadata and an Inspector editor/test. | Editor work is outside Phase 2B runtime integration. Preserve all changes; do not stage them. The v1 authoring shape is relevant input for the legacy adapter. |
| `.vscode/tasks.json` | Adds local focused/full test tasks. | No engine overlap; leave untouched and uncommitted. |
| `tmp-debug.mjs`, `tmp-debug.spec.js` | Temporary browser diagnostics. | No intended integration; leave untouched and uncommitted. |

The Phase 2A files in `src/tileSystemV2DiceEngine.js`, `src/tileSystemV2RuleDispatcher.js`, and their tests are committed. The only existing overlap with those committed files is the separate uncommitted `game.js`/`encounterRules.js` path; it is not an established integration contract.

## 2. Existing Gameplay Paths

| Concern | Current path | Recommended Phase 2B disposition |
| --- | --- | --- |
| Dice spending | `useMovementPoint()` mutates `dieValue1/2` directly; `spendMovement()` loops over points, updates UI and saves. Called by normal movement, turbo, and player-directed `forceDown()` in fluid. | Replace the mutation loop with `TileSystemV2DiceEngine.spendTime()`. Keep selected die/UI handling in a thin adapter. A rejected transaction must not mutate game state. Remove direct spend calls only after every call site is migrated. |
| Rolling and limits | `rollDice()`, `enforceRollLimitBeforeNextRoll()`, `calculateCurrentRollLimitState()`, `getLevelRollLimit()` own random rolls, `rollCount`, early rerolls, final-roll messages, and terminal death rules. | Reuse `getLevelRollLimit()` and the existing `rollCount` lifecycle as the sole roll-limit source. Adapt `rollDice()` to `startRoll()` when both dice are empty and `earlyReroll()` when time remains. Do not add a second persistent roll counter or alter death/final-roll conditions. |
| Lock interaction | `resolveSolidInteractionAt()` calls `tryUnlockLockAt()`, which resolves `tile.lock` via `evaluateDiceRule()` and replaces an opened cell with air. | Adapt lock variant data into a generic interaction rule/action. Keep interaction cost independent of movement cost. Do not run both `tryUnlockLockAt()` and the new dispatcher for one interaction. |
| Creature combat | `tryFightMonsterAt()` handles player hit and monster response on blocked contact; `checkAdjacentMonsterAttacks()` scans four cardinal cells after movement and applies one hit per check. HP is coordinate-indexed in `monsterStateMap`. | Convert legacy monster variants to generic attacker/attack rule records. Replace the automatic-attack path only after parity tests; enforce the `(playerRollId, attackerInstanceId)` guard across all events/actions, not once per function call. |
| Dirty generic encounter feature | `runEncounterRulesAtEvent()` scans cells row-major, calls the dirty v1 `resolveEncounterRulesAt()`, and calls `takeDamage()` immediately. Hooks currently run after move/roll, not per die event. | Reuse/port safe expressions and spatial predicates through a compatibility adapter. Choose one executor per resolved source. Remove or disable the old side-effecting call only when the generic dispatcher owns that source. Shadow comparison, if used, must never apply effects twice. |
| Damage | `takeDamage()` changes hearts, sets death state, saves, and calls `endGame()`; hazards and legacy attacks call it directly. | Reuse as the one generic `damage` effect handler during cutover. Route each encounter cause through either its existing handler or the dispatcher, never both. Preserve source/death messages and immediate-after-action timing. |
| Movement and physics | `singleMove()` validates collision/jumps, resolves blocked interactions, spends, moves, handles pickup/hazards/exits, applies gravity, then checks adjacent monsters. Turbo has its own two-step flow. `forceDown()` has separate logic. | Keep collision, rendering, pickup, and exit behavior in place initially. Wrap successful movement and its spend in one root action; adapt each existing movement entry point in a separate slice. Do not silently charge gravity or automatic forced movement. |
| Gravity / bounce | `applyFullGravity()` can fall without spending; `applyGravityAfterMove()` only step-falls while total movement remains, otherwise falls fully; bounce steps are free. | Preserve zero-time gravity and automatic forced movement as free. Emit spatial/movement events for their resolved displacements without fabricating dice-change events. Resolve the step-gravity gating conflict in its own regression-tested slice. |
| Persistence and resume | `buildPersistentGameState()` passes dice values, selected die, and `rollCount` to `createCheckpointState()`; `savePersistentGameState()` writes only checkpoint saves when the canonical map matches. `src/resumeLinks.js` and existing `#map=`, `#mapv=1`, `#st=`, `#resume=1` behavior remain active. | Adapt the engine snapshot to the existing save object shape. Keep local-save keys/version, checkpoint timing, and resume UI/hash formats unchanged in Phase 2B. Do not serialize new instance/inventory state here. |

## 3. One Authoritative Runtime Path

The integration must use exactly one path for each state-changing action:

| Responsibility | Authority after cutover |
| --- | --- |
| Dice/time mutation and event creation | `TileSystemV2DiceEngine`; game code sends a transaction and renders the returned immutable state/batch. No other code directly decrements, replaces, or clears die values. |
| Condition evaluation and encounter selection | `TileSystemV2RuleDispatcher` consumes captured batches. Legacy encounter/monster/lock records are adapted to canonical rules before dispatch; they are not also executed by imperative legacy handlers. |
| Damage and typed effect execution | Registered effect handlers. The `damage` handler calls the existing `takeDamage()` once, preserving its death/message/save behavior. Other effects use generic typed handlers, not tile-name/category/ID branches. |
| Automatic attack frequency | Dispatcher ledger keyed by player-roll identity and stable attacker instance. Remove the old per-check-only protection when the converted source is dispatcher-owned. |
| Nested effects | Dispatcher FIFO child-action queue and root-action cap. Child dice changes go through the same engine and return batches to the same dispatcher. |

**No-double-execution rule:** normalize every source into a canonical rule/action list with explicit ownership. For a given resolved source/action, either the legacy fallback executes it or the dispatcher executes it, never both. During parity work, legacy code may run in read-only shadow mode to compare candidate actions, but it must not call `takeDamage()`, mutate tiles/HP, or consume items. A source with converted `capabilities.rules` must not also run the old `runEncounterRulesAtEvent()`, `checkAdjacentMonsterAttacks()`, `tryFightMonsterAt()`, or `tryUnlockLockAt()` side effect for the same trigger. Deduplicate adapter output by stable source/rule identity, not name/category/tile ID.

The dirty `encounterRules.js` implementation is a v1 source adapter candidate, not a second execution engine to keep beside Phase 2A. Preserve its expression parser, condition meanings, Manhattan/Chebyshev distances, positions, and local repeat semantics by mapping its outputs to canonical rules and testing parity. Resolve its ownership with the author of the uncommitted changes before altering those files.

## 4. Recommended Integration Sequence

Each step is a separate reviewable change with focused unit and browser tests. Do not proceed past a failing parity gate.

1. **Reconcile the dirty encounter feature.** Obtain/record ownership of the uncommitted `game.js`, encounter module, validation, editor, and tests. Leave unrelated editor/debug changes unstaged. Add a pure adapter that converts current `encounterRules`, `monster`, and `lock` data into canonical rule candidates; no runtime hooks change yet. Test expressions, range, positions, messages, order, and repeat behavior against current fixtures.
2. **Roll and reroll bridge.** Give the dice engine the effective global/per-level capacities and the existing `rollCount`/limit. Derive a stable `playerRollId` from existing level/roll lifecycle state; test continuity across checkpoint reload/level transition before choosing its exact key. Adapt `rollDice()` to select `startRoll()` at zero time and `earlyReroll()` when time remains. Keep existing random source, drowning/death check, final-roll message, `addRunnerCounter("dice_roll")`, selected die, persistence call, and objective exception unchanged. Verify both die events are observable even when unchanged.
3. **Movement payment bridge.** Migrate standard `singleMove()` spend and turbo spend to `spendTime()` behind a thin adapter. Preflight collision/jump/affordability before committing position or time. Preserve zero-cost blocked moves and ensure an unaffordable/invalid move leaves dice, position, and logs unchanged. Turbo’s current first-step-then-spend ordering needs a transaction boundary so a failed spend cannot leave the first step committed accidentally.
4. **Movement and spatial events.** After a successful paid movement action has completed its position/pickup/hazard/exit mutations, dispatch its captured die events and a separate movement/spatial event. Add a relation matcher with approved Manhattan/inclusive range semantics; do not reuse `tileDistanceFromRunner()` as the default because it is Chebyshev. Adapt cardinal adjacency and on-top/contact only after geometry tests. Gravity, automatic forced movement, and bounce remain free at zero time; represent each resolved displacement as a movement event, not as a fake spend. Keep player-directed `forceDown()` cost separate.
5. **Legacy interactions and creature attacks.** First adapt a lock contact interaction with an independent interaction-cost transaction and a single `transition_state` effect. Then adapt player-vs-creature blocked interaction, preserving current remaining-dice conditions, HP, defeated replacement, and messages. Finally adapt automatic adjacent attacks to generic rules and stable attacker instances. For each source, disable its old side-effect route only when dispatcher parity is established. Do not make a blocked movement pay movement cost in addition to the configured interaction cost.
6. **Items and configured dice changes.** Route existing item/pickup/event dice modifications through engine `changeDice()` transactions; queue consequence-created dice changes as child actions. Preserve existing pickup rewards and immediate effects until inventory/equipment APIs are separately integrated. Once inventory use is available, make item use atomic (preflight, consume, independent use-time cost, dice/effect mutations, commit, then dispatch). Do not invent inventory state or alter save formats in this integration plan.
7. **Roll-limit, death, and persistence cutover.** Make the engine’s dice snapshot authoritative for UI reads while mirroring its dice/selectedDie/rollCount into existing `StateModule` fields. Preserve `calculateCurrentRollLimitState()`, `enforceRollLimitBeforeNextRoll()`, final-roll ordering, level objective exception, `endGame()`, and checkpoint save key/version. Treat death cleanup to zero as an explicit engine action; suppress new encounter consequences once game over begins. Verify same-browser reload and portable legacy links remain unchanged.

## 5. Priority and Snapshot Integration Rule

For one root action, capture all die events first in actual mutation order. Evaluate every event’s conditions against its own frozen `after` pair. Keep the earliest matching event for each `(actionId, ruleId, sourceInstanceId)` consequence, then sort distinct consequences by higher priority, lower `authorOrder`, event sequence, and authored effect order. Reserve the once-per-attacker/per-player-roll key only when applying this sorted consequence list. This prevents the first scanned low-priority snapshot from consuming the attack guard before a higher-priority match on a later snapshot.

Concrete regression fixture:

- Initial dice `(2,4)`, Die 1 selected, movement cost `3` produces Die 1 `2->0`, snapshot `(0,4)`, then Die 2 `4->3`, snapshot `(0,3)`.
- One attacker instance has a low-priority attack rule matching `dice_sum == 4` and a higher-priority attack rule matching `dice_sum == 3`.
- Assert both conditions are evaluated against the matching snapshots, but only the higher-priority attack applies once for that attacker and player roll. The lower-priority match must not cause a second attack. Repeat with the same rule matching both snapshots and assert its consequence is claimed once by its first matching event.
- Trigger the same attacker on a second action in the same roll and assert no second automatic attack; trigger another attacker instance and assert it can attack once.

This specifically tests the Phase 2A dispatcher’s current boundary: attack keys are presently reserved while collecting event matches. Phase 2B must reserve that key after the per-action candidate set is globally priority-ordered, without weakening first-matching-event deduplication.

## 6. Regression Gates Before Replacing Existing Paths

| Slice | Tests required before cutover |
| --- | --- |
| Dice transaction | Keep the Phase 2A unit tests. Add selected Die 2 overflow, zero-cost blocked movement, insufficient movement no-op, capacity rejection, early reroll roll-count increment, roll-limit exhaustion, and event snapshots stable after later mutations. |
| Movement/turbo | Existing `tests/gameplay.browser.spec.js` movement-cost and movement tests; add movement/position/dice unchanged on rejection, turbo partial/failed step parity, and no double spend. |
| Physics/spatial | Add zero-time full/step gravity, automatic forced movement, bounce, fluid, fall damage, pickups/exits, Manhattan boundary inclusivity, cardinal adjacency, and contact/on-top geometry fixtures. Assert free automatic displacements produce no dice events but still produce movement events. |
| Locks/creatures | Preserve `tests/numeric-gameplay.browser.spec.js` distinct numeric lock and monster variants/art/defeat replacement tests. Add blocked interaction cost exactly once, current-remaining-dice attacks, HP persistence within the live level, two attackers at once, one attacker across two intermediate snapshots, and one attack per attacker per roll. |
| Dirty encounter adapter | Extend the uncommitted `tests/encounterRules.test.js` only after reconciliation: expression safety, sum/parity/exact dice, both distance metrics, positions, event triggers, first-match-per-tile, once-per-roll, action messages, and no old/new duplicate damage. Preserve this file’s authorship and do not stage unrelated edits. |
| Roll/persistence/death | Existing `tests/gameplay.browser.spec.js` final permitted roll, out-of-roll death once, reload during final roll, checkpoint/portable link tests, plus early reroll consuming exactly one level roll and retaining existing final-roll/death behavior. Assert save fields stay `dieValue1`, `dieValue2`, `selectedDie`, `rollCount` under the current save version. |
| No double resolver | Instrument one legacy-adapted attack and assert exactly one effect/`takeDamage` call whether shadow parity is on or off. Test v1-only fallback and dispatcher-owned generic rules separately; no source may execute in both modes. |

Run the focused unit/browser slice for each step, then `npm run check` before any scoped Phase 2B commit. The dirty worktree must be reviewed again immediately before staging; stage only files explicitly approved for the integration slice.

## 7. Open Risks / Boundaries

- The uncommitted generic encounter runtime currently runs on `after_move`/`after_roll`, only handles damage actions, and orders by local `order`; it must not become a second executor beside the Phase 2A dispatcher.
- `dieValue1/2` are mutated during load, roll, spend, and `endGame()`. All mutations need a defined event/action policy before the engine becomes authoritative; death cleanup must not trigger a new attack.
- Existing automatic attack checks are cardinal and one-per-check, not once-per-attacker-per-roll. Legacy variant conversion needs source-specific parity tests before deleting direct handlers.
- The engine currently has no world geometry or built-in effect handlers; `relationMatcher` and typed handlers are integration seams that need one owner in `game.js`/adapters.
- The existing prototype checkpoint does not persist midlevel map/monster state. This plan does not add state persistence or migrate production saves.
- The user’s uncommitted editor/encounter changes may change during this plan review. Do not commit or overwrite them without explicit reconciliation.

Phase 2B implementation requires approval of this sequence and reconciliation of the overlapping uncommitted encounter changes. This document does not authorize code changes.