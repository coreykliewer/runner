# Property Rules 3.0: Phase A

This phase adds the version 3 contract, validation, unified name resolution, native
readers and sequential condition evaluation. No gameplay adapter, Studio control,
production catalog, level, checkpoint format or portable codec is changed.

## JSON contract and ownership

Use the version 2 JSON structure with `version: 3`. The four case-insensitive
reserved names are Hearts, Diamonds, XP and Moves. All other valid IDs remain
case-sensitive custom numeric properties. There is no namespace field and no
separate custom Hearts choice. Authored spelling is preserved in source JSON;
resolution returns the canonical built-in spelling in diagnostic records.

```json
{
  "version": 3,
  "blocks": [
    {
      "if": {
        "type": "comparison", "mode": "current",
        "property": "Hearts", "operator": "<=", "value": 2.5
      },
      "then": [
        { "type": "property", "operation": "add", "property": "Hearts", "value": 1 },
        { "type": "property", "operation": "set", "property": "visited", "value": 0 }
      ]
    }
  ]
}
```

Comparison operands may be finite fractions. Built-in property effects use
non-negative safe-integer operands (including zero) for Set/Add/Subtract. Moves
writes are rejected for every spelling and operation. Version 3 Lose Hearts uses
positive safe-integer amounts; version 2 fractional Lose Hearts remains unchanged.
Custom effects retain signed finite operands and zero-clamping. No effects execute
in this module's native reader or validator.

Fall, Jumps and Kills are not native names in this contract and their informational
Stats are unchanged. They are not aliases to their existing native fields. As with
other unreserved identifiers, an explicitly authored property with one of those
names remains custom.

## Native readers and snapshots

`readBuiltInProperties(runner, { getRemainingMoves })` reads `runner.hearts`,
`runner.score`, and `runner.xp` (legacy missing XP defaults to zero). Moves comes
only from the supplied authoritative dice-total reader, never `movementLeft`.
It does not read `runner.stats`, counters, or similarly named custom properties.
The result is a frozen snapshot, not a second store of authoritative gameplay state.

Existing fractional values are retained without rounding. Score and XP must be
non-negative; Moves must be a non-negative safe integer. Hearts may be negative
after existing lethal damage: the reader preserves that native fact rather than
changing health or its death flow. An adapter must stop execution at terminal death.

For standalone evaluation pass the complete canonical snapshot:

```js
const nativeValues = readBuiltInProperties(runner, { getRemainingMoves });
const result = evaluatePropertyRules(rules, customProperties, { nativeValues });
```

All four values are required for version 3, even when a particular rule does not
read them. Missing/malformed snapshots fail closed rather than fabricating zero
values. Entry Values reads an immutable original snapshot. Current Values reads
preceding custom effects and the last acknowledged native snapshot. Built-ins
always exist, including at zero; missing custom properties still fail all numeric
comparisons, and acquired custom zero remains distinct from missing.

## Sequential execution boundary

The existing iterator accepts the same third options argument. Built-in property
effects yield a native instruction with `nativeProperty` identifying its canonical
owner. Its original `effect.property` spelling is unchanged. Other native effects
remain interleaved in their exact authored positions. No sorting is added.

Version 3 acknowledgements for `applied` and `terminal` must include a fresh complete
`nativeValues` snapshot. This includes narrative/achievement effects, so progression
changes cannot leave Current Values stale. A failed acknowledgement may also supply
known native values; otherwise the last known snapshot is retained with failure
diagnostics. Malformed or missing required acknowledgements stop execution.
Terminal and failed outcomes continue to stop later effects and retain the prefix.

Evaluation adds `entryNativeValues`, current `nativeValues`, resolved condition
identity, and native before/after snapshots to version 3 diagnostics. Custom state
remains in `properties`; no built-in values are copied into that map.

`evaluatePropertyRules` stops with `native_effect_required` at an eligible native
write; it never executes it. The existing game entry path supplies no native
snapshot and therefore cannot activate version 3 in Phase A. Studio also retains
version 3 as read-only unsupported JSON until Phase C.

## Compatibility and migration

Version 1/2 validation, evaluation output, signed/fractional custom operations,
native-effect behavior and custom identifier semantics are unchanged. For those
versions, `Hearts`, `hearts`, and `XP` continue to mean distinct custom properties.
The legacy default version constant remains 1; there is no automatic upgrade.

`findReservedPropertyCollisions(legacyRules, storedCustomProperties)` reports exact
reference paths and stored keys before an upgrade. It does not rename references,
discard values, or transfer them into native fields. Version 3 evaluation rejects
a custom map containing any reserved spelling, preventing silent merge/shadowing.
Phase C must require an explicit reviewed rename before upgrade; Phase B must
also check resumed custom bags. Call this helper on each tile/variant rule document
and the applicable saved property map; it does not scan external catalogs itself.

The authored repository catalog and level JSON were scanned during Phase A and
contained no reserved-name property-rule collisions. Browser saves and external
catalogs remain uninspected.

Checkpoint JSON already retains fractional native values. The current portable
Hearts/Diamonds carry encoding does not: it uses dot-separated base-36 integer
tokens and can lose a fractional suffix. XP travels through JSON and retains its
fraction. Phase B must add a backwards-compatible exact numeric carry extension,
keeping old links readable. This phase does not change that codec or claim to fix
its existing limitation.

## Phase B work and decisions

Connect the native reader at the existing tile-entry boundary. Use authoritative
health/healing, score and progression adapters for writes; acknowledge with fresh
native snapshots and persist consumed-entry guards before side effects. Preserve
the approved at-most-once/uncertain-outcome policy, achievement deduplication,
terminal stopping and existing turn/dice boundaries. Moves remains read-only.

An integer operand must not round an existing fractional value: adding 1 to 2.5
must produce 3.5, and Set replaces it with the authored whole-number target. Retain
native damage behavior for lethal fractional health. Approval is needed only if
changing the approved operand policy or compatibility strategy; no live write
adapter, healing function, migration UI or persistence implementation is included.
