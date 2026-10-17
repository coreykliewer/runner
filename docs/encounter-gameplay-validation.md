# Encounter gameplay validation milestone

Scope: validate the dispatcher integration based on `fe3f7ef`; no catalog migration, inventory work, or Studio redesign.

## Run the repeatable playtest

Run `npm run playtest:encounters`, then open **http://127.0.0.1:8001/?runnerTrace=1&fog=off**.
The server binds to loopback. Its explicit `--encounter-playtest` mode serves an in-memory numeric registry and level, and injects a development-only script with fixed rolls and instructions. Normal `npm run dev` and production assets keep their existing behavior. The production tile/level JSON files and save formats are unchanged.

Use the exact URL above without resume/hash parameters; refresh it to start fresh. Port 8001 keeps this fixture's normal checkpoint storage separate from the usual port 8000 game. Do not export/resume fixture checkpoints into production catalogs.

| Step | Action | Expected result |
| --- | --- | --- |
| 1 | Roll, then select Die 1 | Dice `(2,4)`, 5 hearts, one of two rolls used. |
| 2 | Right onto the blue path | Cost 3, mutations `(0,4)` then `(0,3)`, final position `(2,1)`. Sentinel hits once for 1 after movement settles. |
| 3 | Inspect trace | Lower-priority rule matches at total 4; higher-priority rule matches at total 3. Priority 10, authored order 2 executes before priority 0, authored order 1. Lower attack is suppressed. Legacy automatic damage is skipped for the same placed source. |
| 4 | Left | Cost 1, dice `(0,2)`. Still within the sentinel's range; eligible attacks are suppressed for the same player roll. Hearts stay at 4. |
| 5 | Roll early | Discards 2 time, rolls `(1,2)`, uses the second player roll. Existing final-roll warning appears. |
| 6 | Try Roll again | Blocked while 3 time remains. Trace records `blocked_with_time_remaining`; no extra roll or attack occurs. |
| 7 | Right | Cost 3 exhausts both dice. The new roll permits one new sentinel hit; hearts become 3. |
| 8 | Roll; repeat the click | Existing out-of-rolls death occurs once. The repeated click has no gameplay effect. |

The banner's **Refresh diagnostic trace** button shows the structured JSON. The fixed random values exist only in the injected development script; the real game still uses its normal dice engine and controls.

## Trace contract

On a loopback hostname only, `?runnerTrace=1` enables `window.getRunnerEventTrace()` and `window.clearRunnerEventTrace()`. Without that opt-in, no collector or public trace API is created and the dispatcher has no observer. No trace data is persisted or sent over the network.

The getter returns a frozen `{ dropped, records }` snapshot. Records are deep copies, recursively frozen, bounded to the latest 2,000 entries, and numbered with `traceSequence`. Clearing diagnostics does **not** clear gameplay ledgers or permit another attack. Export from the console with `JSON.stringify(window.getRunnerEventTrace(), null, 2)`.

Records observe the existing dice batches, dispatcher matching/ordering, and damage handler; they do not deliver events or execute encounters:

- `movement_attempt`, `roll_attempt`, `die_selected`, `player_action`: requested/actual time cost, selected die, position, success, discarded reroll time, and available action/roll IDs.
- `dice_mutation`: the original batch event's immutable before/after dice, event sequence, operation, action/roll identity, and source.
- `action_boundary`: resolved player position, phase, final displayed dice, and batches about to dispatch.
- `rule_evaluated`: matching result with trigger, conditions, event snapshot, player position, priority, authored order, and rule/source identity.
- `consequence_ordered`: priority-sorted candidate ordinal within its batch; candidates may subsequently be suppressed. This is distinct from a successfully applied effect.
- `consequence_applied`: effect index/type/payload and optional handler result. Damage handlers include the actual evaluated amount and resulting hearts.
- `consequence_suppressed`, `attack_suppressed`, `event_suppressed`: deduplication/attacker-limit reasons linked to the rule, event, and placed source when available.
- `legacy_hook_skipped`: explicit dispatcher ownership prevents the legacy automatic-attack hook from running at that source.
- `damage_applied`, `roll_limit`, `game_over`, `dispatcher_diagnostic`: actual damage, death/roll-limit outcomes, and existing dispatcher errors.

Placed encounter identity currently uses the runtime's level/coordinate/tile identity, rather than a new saved instance format. Unmatched rules include their inputs and final match result; a future inspector can add per-condition rejection explanations. The trace does not add synthetic dice mutations for pre-existing non-batch operations such as death's display reset; `game_over` records the remaining dice before that reset.

## Findings

Damage occurs after the approved movement/roll boundary using the triggering event's snapshot. Priority can select a later snapshot before an earlier lower-priority match. A source attacks once per player roll across movement actions; a new voluntary reroll resets that allowance. The legacy hook does not add damage. Lethal damage still goes through `takeDamage()` and the existing death flow once.

The fixture's authored message identifies the attacker, amount, condition, and that the condition occurred during the move. Existing roll/final-roll/death messages remain intact.

Two feedback gaps were reproduced in browser tests:

1. A rule matching **only `(0,4)`** attacks after the move displays `(0,3)`. With an empty authored message, the fallback says only **“You take 1 damage.”** It identifies neither the source nor the triggering condition. This can feel arbitrary even when execution is correct.
2. An `after_roll` rule can match a mixed old/new reroll snapshot **`(1,4)`** although the completed reroll displays **`(1,2)`**. This is consistent with the approved snapshot semantics, but a player cannot infer it from the final dice alone. The automated variant includes an explicit snapshot message to make the cause understandable.

The final-roll warning is visible, but attempting another roll while time remains produces no additional player message. The trace explains the blocked click; the existing player-facing behavior may feel unresponsive. This milestone does not change those message policies.

## Verification and next work

Focused commands:

```text
node --test tests/developmentTrace.test.js tests/encounterIntegration.test.js tests/tileSystemV2RuleDispatcher.test.js
npx playwright test tests/encounter-playtest.browser.spec.js tests/encounter-integration.browser.spec.js
npm run check
```

Focused coverage includes 11 unit tests and 7 browser tests. The new trace tests check opt-in gating, bounds/immutability, duplicate-event diagnostics, and that absent/throwing observers cannot change dispatcher results. Browser coverage includes the repeatable fixture, ordinary-mode exclusion, intermediate-only feedback, mixed reroll snapshots, and lethal damage.

Validation result: both focused commands passed. `npm run check` passed with **123 unit tests, 2 smoke tests, and 52 browser tests**. `git diff --check` passed. These checks ran against the working tree, including the preserved uncommitted editor/validation tests.

Preservation recheck: the working-tree `npm run check` passed again with those counts. A separate copy of the base commit plus only the 11 milestone files also passed `npm run check`: **122 unit tests, 2 smoke tests, and 51 browser tests**. The difference is the excluded, unrelated validation test and Studio browser test. That copy used a separate loopback browser-test server port; no runtime behavior or test assertions were changed for isolation.

For a future Studio event inspector, show an expandable timeline grouped by player roll and action: requested cost/selected die → captured snapshots → settled player/source positions → rule matches → priority-sorted candidates → applied/suppressed consequences. Link a placed source and authored rule, distinguish execution ordinal from authored order, expose suppression reasons, show actual damage beside the trigger snapshot and final dice, and indicate dropped trace records. Reuse this observer contract; playback must not reapply effects.

Before broader integration: agree on player-facing trigger feedback (especially intermediate/reroll snapshots), add per-condition match explanations and stable lifecycle identity as needed, and reconcile the existing uncommitted encounter-editor/validation work separately. Future creature, lock, hazard, and inventory migration remains outside this milestone.

Preserved uncommitted work: `editor.css`, `src/editor/tilePropertyEditor.js`, `src/editor/encounterRuleEditor.js`, `src/tileProperties.js`, `src/validation.js`, `tests/editor-studio.browser.spec.js`, `tests/validation.test.js`, `.vscode/tasks.json`, `tmp-debug.mjs`, and `tmp-debug.spec.js`. None is included in this milestone's implementation changes.
