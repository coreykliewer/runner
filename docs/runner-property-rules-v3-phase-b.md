# Property Rules 3.0: Phase B native gameplay integration

Version 3 tile entries now capture the four authoritative native values once and
use the existing sequential interpreter and tile-entry dispatcher. Version 1/2
entry behavior and custom identifier semantics remain unchanged. No Studio,
schema, production catalog or level changes are included.

## Native owners

- Hearts increases use `healRunner`, which refuses terminal revival and applies
  the existing healing flash. Decreases use `takeDamage`. Set handles both paths.
  The damage handler accepts an optional validated target for version 3 writes,
  avoiding catastrophic cancellation when setting very large health to a small
  target. Healing also accepts a validated target to retain exact Set values near
  the safe-integer limit when starting from fractional health. Existing callers
  retain their original damage arithmetic and death flow.
- Diamonds writes update `runner.score`, apply its positive-change flash and run
  the existing achievement checks. They do not manufacture or consume map pickups.
- XP writes use `setXp` in the existing progression module, then apply progression
  state and achievement checks. Existing `addXp` and legacy pickup paths are not
  changed. A target setter avoids losing a small Set target through delta rounding.
- Moves comes from the authoritative dice engine. All Moves writes are rejected
  during prevalidation. No movement-time mutation API is introduced.

Version 3 native operands remain non-negative safe integers. Existing fractional
values are retained when adding/subtracting integers; Set uses the whole-number
target. Custom operands retain their existing signed/fractional behavior. Targets
clamp to zero. Health Set/Subtract can require a fractional damage delta when the
old health is fractional; that compatibility delta goes through native damage.
Existing explicit Lose Hearts effects keep their version-specific semantics.

## Ordering, checkpoints and compatibility

Only version 3 events add an immutable `nativeValues` snapshot to the existing
tile-entry batch. The decoder validates that optional snapshot; older batches remain
valid. Entry Values always uses it. After every native effect, including narration
and achievements, the existing driver reads fresh authoritative values for Current
Values before advancing. No native fields are copied into `runner.properties`.

The approved consumed-entry sequence is retained: prevalidate, persist the entry
identity/property prefix/pending instruction, invoke the adapter, capture native
values, checkpoint, and advance. Lethal damage stops all later effects. Exceptions
after a possible side effect remain uncertain and consumed, never retried. The
existing at-most-once crash limitation is unchanged. Native-reader failure after
an attempted action also stops the sequence with diagnostics.

Reserved-name collisions in saved custom maps prevent the entire version 3 entry
sequence. The map and native values remain distinct and untouched, the entry is
consumed, and a player explanation plus persisted/development diagnostics identify
the conflict. There is no automatic rename, transfer, or merge. Legacy version 1/2
rules continue treating those names as custom. Explicit migration authoring is
Phase C work. Collision inspection of external saves/catalogs is not automatic
outside the version 3 entry preflight.

## Exact portable values

Old positive integer links and their encoding remain unchanged. Newly encoded
fractional or unsafe-integer Hearts/Diamonds/Kills use an optional `exactNative`
object inside the existing carried-progress JSON. Legacy tokens contain truncated
integer fallbacks without embedded dots. New decoders whitelist finite numeric
fields and restore exact values; they never retain `exactNative` as runtime state.
Score/Kills must remain non-negative. Fractional negative terminal health is
preserved; old negative integer tokens retain their prior clamping behavior.
XP already travels through JSON and retains its precision.

JSON round trips preserve JavaScript numeric values, including fractions and very
large finite numbers; no decimal-arithmetic library is introduced. Older builds
can read the fallback integer tokens but cannot retain the new precision. Fractional
parts already lost from historical links or saves cannot be reconstructed safely.
Portable resume retains its existing inactive-dice policy; local checkpoints retain
the existing active dice/roll lifecycle.

## Verification scope

Focused tests cover all nine native property/operation combinations, aliases,
fractional starting values, small Set targets after very large health/XP, healing,
damage, lethal stopping, Entry/Current Values, custom/native authored order,
achievement deduplication, narration, collisions, Moves rejection, failure after
healing, replay, checkpoint, level transition and fresh-browser portable resume.
Version 1/2 and old-link regressions remain in the full verification suite.

Phase C remains separate: unified selectors, authoring and collision migration UI,
and version 3 Studio previews have not been implemented here.
