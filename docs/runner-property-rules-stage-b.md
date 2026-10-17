# Runner Property Rules 1.0 — Stage B gameplay integration

Baseline: `988ace8`. The Stage A schema and evaluator remain authoritative. This
milestone adds tile-entry dispatch and persistence, with no Studio controls or
production catalog migration.

## Corrected acceptance fixtures

`fixtures/property-rules.json` defines Water, Air and Fire only for tests:

- Water sets `wet = 5`.
- Air compares entry `wet > 0`, then subtracts 1 from `wet`.
- Fire sets `burning = 1`, then compares entry `wet >= 2`. Only a matching IF
  subtracts 1 from `burning` and 2 from `wet`, in that order.

At `wet = 1`, Fire leaves `wet = 1` and `burning = 1`; no partial protection.
Missing `wet` also provides no protection. Sufficient wetness can acquire
`burning = 0`, which remains present. The unchanged evaluator clamps every
individual result to zero and evaluates every IF against the entry snapshot.
Names and IDs never select runtime behavior.

## One grid-cell entry boundary

`enterRunnerCell()` in `game.js` owns committed coordinate changes for ordinary
walking, jumps/diagonal jumps/slopes, each turbo step, step gravity, every cell of
full gravity, force-down, and forced bounce. Initial spawn, checkpoint restoration,
and rollback placement do not call it. Same-cell calls are ignored. Collision and
movement-budget checks remain in their existing paths before successful entry;
stationary combat, blocked actions and dice-only changes are not entries. Rolling
can still cause real gravity entries when the existing physics requires them.

At entry, coordinates are committed, the effective tile definition (including
variant overrides) and numeric Runner properties are captured, then one frozen
`runner.tile-entry-batch` with one `tile_entered` event is dispatched. The source
identifies level, coordinates, numeric tile ID, variant and placed instance.
`before` and `after` both describe the immutable entry property snapshot; they are
not dice snapshots or a claim that effects have already run.

Property rules run before destination pickup/grant/hazard handling and before the
existing settled-action encounter boundary. A multi-cell movement creates one
entry per entered cell. Each new entry snapshots the preceding entry's committed
property results. No intermediate collision-free cell is fabricated for a diagonal
or slope move. Native movement, physics, spending and encounter boundary order are
otherwise unchanged.

## Dispatcher ownership and atomic effects

`src/tileEntry.js` supplies batch creation/decoding, a property-rule adapter, and
application helpers. The existing `TileSystemV2RuleDispatcher` accepts the new
typed batch and entry condition. The existing gameplay dispatcher instance handles
both encounters and the new `property_rules` effect. There is no second event bus,
encounter executor or damage handler.

One property effect invokes the Stage A evaluator on the whole authored document.
Successful output replaces `runner.properties` atomically. Invalid rules or numeric
overflow retain all prior property values, expose diagnostics, and consume the
entry identity, so a reload or repeated delivery cannot activate previously failed
content retroactively. A tile with no rules still consumes its entry identity.

The property map is distinct from native Runner fields, counters and stats.
`burning`, `wet`, or a property named `hearts` has no implicit native damage,
drowning, movement or death behavior. Those remain owned by existing gameplay
handlers. Attack guards and dice-event cursors are not consumed or reset by a
property-rule effect.

## Entry identity, persistence and resume

Runner carries `propertyEntry: { runId, sequence }`, with a unique run namespace
and the last committed entry sequence. A new accepted move allocates the next
sequence, with an event/action ID derived from that namespace and sequence.
The dispatcher suppresses duplicate event/consequence IDs. The property effect
also requires exactly the next sequence in the same namespace. This high-water
guard rejects replay even in a fresh dispatcher with no previous event ledger.
Returning to the same tile later produces a fresh event and applies its rules.

`src/state.js` adds the numeric property map and entry marker to existing v2 local
checkpoints and to the existing carried-progress payload in `v1` resume links.
No version bump, new storage key or new resume-link format is required. Empty
property maps may be omitted from portable payloads; acquired zero values are
included. Legacy checkpoints default to an empty property map and a fresh entry
namespace when gameplay initializes. Invalid numeric maps or entry markers fall
back to safe empty/default state during decoding; malformed authoring remains a
validator/evaluation diagnostic without modifying the source tile JSON.

Entry properties and identity are checkpointed together, with the shared
dispatcher's local ledger. The existing end-turn transaction still suppresses
intermediate writes and saves its final state. Exit checkpoints and level carry
links retain property state and the marker across levels, while dice and spawn
handling keep their existing level-boundary semantics. Reload and portable resume
place Runner at the canonical spawn without generating an entry. A subsequent
real move is a new entry. Portable links still start without an active dice roll.

## Observability and verification

The existing opt-in local development trace records `tile_entry` batches,
`property_rules` evaluations/diagnostics, dispatcher ordering, and replay
suppression. Entry and property snapshots are copied/frozen. Tracing remains
disabled by default and has no control over property outcomes.

Unit tests cover corrected acceptance rules, immutable batches, malformed and
stationary events, shared-dispatcher replay prevention, high-water restoration,
atomic failure, no-rule entries, zero presence, local checkpoints and portable
carry across levels. Browser fixtures cover the full Water → Air → Fire path,
repeated Air entries, insufficient protection, acquired zeros after reload,
step/full gravity, force-down, bounce, turbo, blocked and unaffordable actions,
dice-only actions, local resume, mapped exits, fresh-browser portable resume and
actual replay into the restored gameplay dispatcher.

Verification passed: **35 focused unit tests**, **9 focused browser tests**, and
fresh `npm run check` runs in both the working tree and exported staged snapshot
with **162 unit tests, 2 smoke tests, 100 browser tests** each. Staged whitespace
checks passed. The existing encounter trace assertion now scopes ordering to its
dice action, so independent entry consequences do not masquerade as encounters.

## Remaining limits and Stage C boundary

The existing checkpoint model restores canonical maps/spawns rather than exact
midlevel position or world mutations. Entry effects are synchronous and cannot
resume halfway through an entry. Entry sequences must remain safe integers; the
shared local dispatcher still retains its existing unbounded session ledger.
Carried property maps can lengthen portable URLs; this slice does not add a new
compressed resume protocol. Stage A identifier, grammar and numeric limits apply.

Production tiles have not been migrated. Stage C would add safe Studio authoring
and previews for the property-rule contract, including preservation of unsupported
JSON. No Stage C UI work is included here.
