# Property Rules 2.0: Phase A

This phase extends the standalone validator and evaluator. No native gameplay
adapter or Studio control is connected. Production catalogs and levels are unchanged.
`PROPERTY_RULES_VERSION` remains 1 for existing authoring defaults;
`PROPERTY_RULES_VERSIONS` lists supported contracts. Version 1 keeps its schema,
entry-only comparisons, output shape, and atomic overflow behavior.

## Version 2 contract

The shared JSON Schema accepts versions 1 and 2 as distinct alternatives. Version 2
uses the following types, with no implicit conversion from version 1:

- Condition: `{ "type": "comparison", "property": "charge", "operator": ">=", "value": 3 }`.
- Existence: `{ "type": "exists", "property": "charge" }` or `not_exists`.
- Conditions optionally specify `"mode": "entry"` (default) or `"current"`.
- Property effect: `{ "type": "property", "operation": "add", "property": "charge", "value": 1 }`.
- Native instruction: `{ "type": "lose_hearts", "amount": 1 }`.
- Native instruction: `{ "type": "narrative", "text": "Authored text" }`.
- Native instruction: `{ "type": "achievement", "id": "authored_id", "title": "Authored title", "body": "Optional body" }`.

The existing `blocks`, optional `if`, and non-empty `then` arrays remain. No IF
means ALWAYS. Existence conditions do not accept numeric operators or values.
Existence checks use own properties, including acquired zero; every numeric
comparison against an absent property fails, including `!=`. Property identifiers
remain arbitrary, case-sensitive, and subject to the existing identifier rules.

Property operands remain signed finite numbers. Every property result clamps to
zero. Heart-loss amounts are positive finite numbers, including fractions, matching
the native arithmetic health model. Native text, achievement ID/title, and an
optional body must contain non-whitespace text. Narrative text is plain text;
HTML, narrative references, and repetition options are not part of this contract.
Unknown fields/types and malformed values fail validation without changing input.

The isolated Burning and Poison examples are in `fixtures/property-rules-v2.json`.
Canonical Burning increments first; its Current Values threshold block resets,
requests heart loss, then requests narrative. A lethal acknowledgement stops the
narrative but keeps the earlier reset. Damage-before-reset intentionally leaves
the incremented value on death. Neither fixture changes production tiles.

## One sequential evaluator

`createPropertyRuleExecution(rules, properties)` returns a synchronous generator.
Its first `next()` starts evaluation: it prevalidates the entire definition and
incoming state, owns a JSON copy of the rules, and freezes an entry snapshot.
Callers must start it at the tile-entry boundary. Each IF is evaluated once at the
beginning of its block: Entry Values uses the original snapshot; Current Values
uses the working property state after all preceding effects. THEN arrays execute
in exact authored order. There is no sorting by type, priority, or execution phase.

Property-only execution completes on the first `next()`. At each native instruction,
the generator yields a frozen request with the instruction, property state at that
point, block/effect indices and execution numbers, an effect key, and a diagnostic
evaluation snapshot. It performs no native action. The caller must acknowledge it:

```js
const execution = createPropertyRuleExecution(rules, entryProperties);
let step = execution.next();
// Phase A tests simulate acknowledgements; production adapters are Phase B.
while (!step.done) {
  inspect(step.value.effect);
  step = execution.next({ status: "applied" });
}
const evaluation = step.value;
```

Acknowledgement statuses:

- `applied`: continue to the next authored effect.
- `terminal`: stop immediately; return `ok: true`, `status: "terminal"` and the
  preceding property prefix. No later effect or block executes.
- `failed`: stop immediately; return `ok: false`, `status: "failed"`, retain the
  preceding prefix, and report `native_effect_failed`.
- A missing or invalid status stops as a failure; it never silently skips an action.

An instruction is yielded once per iterator. Continuing an exhausted iterator
cannot replay it. Effect keys are local authored positions, **not global replay
identities**. Phase B must scope them to the existing entry event ID and persist
the consumed entry/activation guard before handlers can save or end the run.
Creating another iterator is not a safe retry mechanism.

Unexpected adapter errors must be caught by the future adapter and acknowledged
as failed (or terminal when the run ended). Earlier damage, rewards, logs, and
property changes cannot be rolled back. No automatic retry is allowed, because a
handler may have completed its side effect before failing. Phase B must trace the
failure and checkpoint the consumed entry and completed prefix together. This
phase contains no adapter, side-effect transaction, or cross-resume native ledger.

Version 2 arithmetic overflow also stops with the earlier prefix retained, since
an earlier native effect might already be irreversible. Version 1 still rejects
overflow atomically with its original state and no applied effects.

## Convenience evaluation and records

`evaluatePropertyRules()` drives the same interpreter. With only property effects
it returns the complete evaluation. At the first eligible native instruction it
returns `ok: false`, `status: "native_effect_required"`, a `pendingEffect`, and the
informational property prefix. It never executes or silently skips native effects.
The existing gameplay entry handler commits only successful evaluations, so it
cannot partially activate these unconnected native definitions. A failed condition
that skips a native block does not prevent other property-only blocks executing.

Version 2 adds `rulesVersion`, `status`, and ordered `records` to the existing
version-1 evaluation envelope. Records distinguish block evaluations from effect
execution and include immutable property snapshots, authored indices, one-based
block/effect numbers, and native acknowledgements. Record sequence and effect
sequence are different: block evaluations also consume record sequence numbers.
Outputs are deterministic JSON with no timestamps or generated event IDs.

## Phase B boundary

Reuse the universal dispatcher's property-rule handler to drive this iterator.
Commit each preceding property prefix before calling a native adapter, especially
before `takeDamage()` can save terminal state. Route damage through `takeDamage`,
narrative through existing action delivery/logging, and achievements through the
existing unlock helper, announcing only newly acquired IDs. Keep the encounter
attacker-per-roll guard separate from an authored tile-entry health instruction.

Phase B must verify native adapters, terminal checkpoints, consumed-entry persistence,
and achievement/narrative deduplication before enabling production use. Studio 2.0
controls, previews, mixed-type reordering, and exact order through save/reopen,
import/export, and variants remain Phase C/D acceptance work. Studio currently
preserves version 2 as unsupported read-only JSON; no automatic upgrade occurs.
