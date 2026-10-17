# Voluntary end-turn lifecycle

Roll now means **End Turn + Roll**. A click closes the active turn even when the level has no rolls left. Ending a final turn resolves its effects, then ends the run if Runner is alive and the objective remains incomplete. The earlier blocked-reroll feedback policy is superseded.

## Ordering and ownership

1. The authoritative dice engine's `endTurn()` zeroes Die 1, then Die 2, irrespective of the selected movement die. Only actual changes create frozen `die_changed` events. An active `(0,0)` still ends once; initial `(0,0)` with no turn does not emit `turn_ended`.
2. The existing dispatcher processes all closing snapshots, including its child queue, before the lifecycle phase. Global priority and authored order apply within that phase. The closing roll ID remains unchanged.
3. A separate typed `runner.turn-event-batch` carries `turn_ended`, using zero before/after snapshots without pretending that a die changed. The same dispatcher processes it. Duplicate event IDs, consequence keys, attacker-per-roll guards, and explicit once-per-turn guards are retained.
4. Roll-time drowning runs once at the closing boundary. The previous initial-roll drowning charge is retained without synthesizing a turn end. All damage still uses `takeDamage()`.
5. Lethal consequences stop progression. A living Runner with a completed objective wins before the budget check. Otherwise, exhausted roll budgets use the existing out-of-rolls death flow without RNG, counter increments, or new-roll events.
6. If allowed, `startRoll()` begins from `(0,0)`, assigns a new roll identity, increments the existing counter once, and emits `die_rolled` snapshots in die order. New-roll encounters then run. Direct `earlyReroll()` now rejects the old bypass with `end-turn-required`; callers must close and resolve the turn first.

The controller rejects reentrant Roll calls during resolution. A later distinct click ends the newly active turn; it is not a retry of the previous click. Delayed dice animations cannot overwrite a newer display update or a terminal reset.

## Authored rules

Existing `after_move` and `after_roll` rules retain their phases. Add `dice_changed` to opt a source's authored rule into dice mutation boundaries, including closing zeroing and new-roll events. Add `turn_ended` for explicit lifecycle consequences. No production catalogs are migrated.

Damage remains an automatic attack with the existing attacker-per-roll guard by default. A creature's default automatic `turn_ended` attack does not gain another hit after it attacked during movement or closing zeroing. Explicit non-attack turn effects can declare `activation: { scope: "once_per_turn" }`, permitted only on `turn_ended` rules. They have a separate per-rule/per-source/per-roll activation key and do not consume or reset the attack allowance.

The development trace records zeroing mutations, `action_boundary` phases (`dice_changed`, then `turn_ended`), the frozen lifecycle batch, ordering, actual damage, suppressed effects, and new-roll events. Handlers declining an effect after death are traced as suppressed rather than applied.

## Persistence and compatibility

Existing v2 checkpoint fields remain intact. Optional top-level `turn` metadata records roll identity, active/idle/closed phase, terminal outcome, and dispatcher activation/deduplication ledgers. Existing migration already preserves additive metadata, so no unrelated validation or Studio files are changed.

The synchronous end-turn/new-roll transaction suppresses intermediate checkpoint writes and commits its final state once. Movement checkpoints are also refreshed after encounter consequences, so damage and its attack guard are saved together. Reload restores terminal outcomes without running handlers, logging another terminal event, or rolling. Closed turns cannot emit a second lifecycle event. Active-turn attacker and once-per-turn guards are restored into the same dispatcher.

Older checkpoints without metadata infer an active turn from positive dice or a positive roll count. Historical attack activations absent from an old save cannot be reconstructed; the new guarantees apply to checkpoints containing the new metadata. Checkpoint placement continues to use the existing level-boundary spawn behavior.

## Verification and limits

Verification passed: focused engine/dispatcher tests **30/30**, focused lifecycle/playtest browser tests **13/13**, and `npm run check` with **138 unit tests, 2 smoke tests, and 84 browser tests**. `git diff --check` also passed. The full check includes the preserved uncommitted Studio/validation tests; those files were not modified by this integration.

Coverage includes `(0,1)`, `(1,0)`, `(0,0)`, and `(1,1)` in normal gameplay and the isolated encounter fixture, with available, exhausted, and unlimited roll budgets. Additional checks cover selected Die 2 not changing discard order; initial versus active zero dice; cross-snapshot priority; explicit lifecycle damage after closing attacks; shared attacker guards across phases and reload; lethal damage and drowning; survival before objective success; immutable snapshots; RNG/counter invariants; and terminal resume.

Preservation review adds explicit regression assertions for the exit distinction: movement on the final permitted roll still reloads the mapped destination with no terminal outcome; Roll-based completion remains terminal in the current level without consuming a roll. The movement test waits for the destination reload before inspecting its checkpoint.

Fresh preservation verification passed with **138 unit, 2 smoke, and 84 browser tests** in the working tree. An exported staged snapshot excluding all uncommitted Studio, validation-hook, feedback, and debug work passed **137 unit, 2 smoke, and 83 browser tests**. The isolated browser suite used a separate server port and two workers; production code and test assertions were unchanged. This confirms the lifecycle does not depend on the excluded work.

The generic dispatcher reward-handler unit test verifies that restored activation guards prevent replay. This slice does not introduce authored inventory/reward handlers; runtime authored encounter actions remain damage-only. Existing movement-driven exit routing is unchanged; the objective ordering here applies to the Roll lifecycle. Lifecycle phases are synchronous and checkpointed at transaction boundaries, rather than supporting resumable asynchronous effects. Dispatcher ledgers currently retain session history; compaction is deferred.
