# Runner Property Rules 1.0 — Stage A

Baseline: `13818bf`; Stage A committed at `988ace8`. Stage B integration is described
in [runner-property-rules-stage-b.md](runner-property-rules-stage-b.md). This milestone supplies a standalone JSON contract, validator,
and deterministic evaluator. It does not activate property rules in gameplay or
Studio, change production tiles, or alter saves. Existing encounters, dice and turn
lifecycle retain their current owners.

## JSON contract

An optional `propertyRules` field may be authored on a tile definition:

```json
{
  "name": "Example display name",
  "propertyRules": {
    "version": 1,
    "blocks": [
      { "then": [{ "operation": "set", "property": "burning", "value": 1 }] },
      {
        "if": { "property": "wet", "operator": ">=", "value": 2 },
        "then": [
          { "operation": "subtract", "property": "burning", "value": 1 },
          { "operation": "subtract", "property": "wet", "value": 2 }
        ]
      }
    ]
  }
}
```

Property IDs are authored data, with no catalog or built-in environmental names.
They are case-sensitive ASCII identifiers of 1–64 characters: a letter or
underscore first, followed by letters, digits, underscores or hyphens. Whitespace,
paths and the JavaScript prototype keys `__proto__`, `prototype`, `constructor` are
rejected. `charge`, `Charge`, and any other valid identifier are distinct. These rules
describe numeric properties only; there is no implicit connection to native
Runner fields such as hearts, counters, or inventory.

The JSON Schema is `schemas/runner-property-rules.schema.json` (Draft 2020-12).
`version` and `blocks` are required. An empty block list is a valid no-op. Each
block requires a non-empty `then` array and may contain one `if` comparison.
There is no ELSE, nested conditional, expression, property-to-property operand,
priority, callback, or event trigger in this contract.

Operations use the exact JSON spellings `set`, `add`, `subtract`. Comparisons use
`=`, `!=`, `>`, `<`, `>=`, `<=`; `==` is not an alias. Values must be finite numbers,
including signed numbers and fractions. Numeric strings, booleans, null, NaN,
and infinities are rejected. For example, subtracting a negative operand adds its
magnitude. JavaScript IEEE-754 arithmetic applies; exact decimal arithmetic and
safe-integer-only semantics are not promised.

Unknown fields inside the rule document, blocks, conditions, or effects are
validation errors rather than silently ignored instructions. Unrelated fields
outside `propertyRules` remain untouched. Validation never repairs, normalizes,
deletes, or freezes the source JSON.

## Evaluation semantics

1. Validate the entire rule document and incoming property map before any effects.
   Incoming values must be finite, non-negative numbers with valid property IDs.
2. Copy and freeze the entry property snapshot once. All IF comparisons use this
   snapshot, even after earlier effects change that property or acquire another.
3. Missing properties fail every comparison, including `!=`, `<` and `= 0`.
   An explicitly acquired zero participates in ordinary numeric comparisons.
4. Visit blocks in array order. Unconditional blocks always match; a conditional
   block executes its ordered effects only when its IF matches.
5. Execute effects sequentially on separate working state. Set replaces the
   value; Add and Subtract use its current working value. Missing effect targets
   start from zero. Clamp each individual result to at least zero before the next
   effect. An effect acquires its target even if the resulting value is zero.
6. Return frozen copies; never mutate or freeze the caller's inputs. Repeated
   calls are distinct entries. Calling again with the previous output captures a
   new snapshot; calling with the same inputs returns the same result.

Finite operands can overflow during addition/subtraction. Such an entry fails
atomically: the returned properties remain the entry snapshot, no effects are
reported as applied, and a path-specific `numeric_overflow` diagnostic identifies
the failing effect. Earlier block comparison records may remain as attempted
evaluation diagnostics. No implicit saturation, Infinity, or partial commit occurs.

## Module and result boundaries

`src/propertyRules.js` exports:

- `validatePropertyRules(document, path?)`: structured severity/path/code/message
  errors for the standalone document; an empty array means valid.
- `validateTilePropertyRules(definition, path?)`: inspect only the optional field;
  existing tile definitions without it are accepted without migration.
- `validateRunnerProperties(properties, path?)`: validate a numeric property map.
- `evaluatePropertyRules(document, properties?)`: pure evaluation of one entry.

Evaluation results contain `format: "runner.property-rule-evaluation"`, `version`,
`ok`, `entrySnapshot`, final `properties`, `blocks`, ordered `effects`, and
`diagnostics`. Block records identify authored indices, match results, comparison
presence/actual/expected values, and the number of effects selected by the match.
That count describes selection, not a successful commit when `ok` is false.

Effect records identify sequence, block/effect indices, property, operation,
operand, before/after presence and value, acquisition, value change and clamping.
Absence is `{ "present": false, "value": null }`; acquired zero is
`{ "present": true, "value": 0 }`. Unchanged effects remain observable and ordered.
An absent-to-zero acquisition counts as a change. No timestamps, RNG or global
mutable state enter evaluation. Results are JSON-serializable and deeply frozen.

On malformed rules with a valid property map, failure returns the untouched
snapshot as final properties with no applied effects. An invalid property map
returns null snapshot/properties and diagnostics, so invalid input is not silently
coerced into an empty state.

The evaluator has no imports from gameplay, persistence, the dispatcher, or Studio.
It creates no event bus and owns no damage or terminal behavior. A future adapter
must attach event/source/placed-instance identities to its result using the
existing event architecture. Stage A deliberately owns no replay ledger or entry
deduplication. JSON-compatible input is required; executable objects, proxies,
getters, cyclic structures, and unbounded hostile input are outside this contract.

## Fixtures and verification

`fixtures/property-rules.json` contains Water, Air and Fire solely as test data:
Water sets `wet` to 5. Air subtracts 1 when entry `wet > 0`. Fire first sets
`burning` to 1, then subtracts 1 from `burning` and 2 from `wet` only when entry
`wet >= 2`. At `wet = 1` there is no partial protection. Absent `wet` fails the IF.
These fixture definitions supersede the initial Stage A examples.

`tests/propertyRules.test.js` covers repeated entries, insufficient wetness,
zero-clamping, all comparisons, cross-property writes, snapshot semantics, both
authored orders, missing versus acquired zero, immutability, deterministic output,
malformed data, overflow rollback, unrelated tile fields and existing catalog
compatibility. Run `node --test tests/propertyRules.test.js`, then `npm run check`.
No browser behavior changes in Stage A; the existing browser suite guards that
boundary.

Stage A verification passed: **18 focused tests**, including the same 18 tests
from an exported staged snapshot without the excluded uncommitted files, and a
fresh `npm run check` with **158 unit tests, 2 smoke tests, 91 browser tests**.
Staged whitespace checks passed. Only this module, schema, fixture, tests and
document belong to the milestone.

## Exact next step: Stage B entry adapter

Begin with one isolated gameplay fixture and an authoritative tile-entry adapter
in the existing event/dispatcher architecture. Define which successful movement
and gravity transitions constitute distinct entries, and capture one numeric
property snapshot before any effects belonging to each entry. Evaluate once,
commit successful property changes atomically, and forward structured diagnostics
to the existing development trace. Do not infer behavior from tile/property names.

Before enabling that adapter in normal gameplay, add a dedicated Runner property
map and entry identity/replay metadata to persistence and resume handling, retaining
the difference between missing and zero. Browser tests must cover movement,
gravity, repeated entries, save/resume, no duplicate application, and interaction
with approved encounter/end-turn boundaries. Explicitly resolve any mapping to
native damage or terminal outcomes through their existing owners. Production
catalog migration and Studio controls remain separate milestones. None of this
Stage B wiring is implemented here.
