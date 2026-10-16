# Runner Tile System 2.0: Architecture Audit

**Status:** Review material. This document records current behavior and proposes a path for review; it does not authorize implementation.

The audit compares the repository at the time of writing with [the approved design](TILE-SYSTEM-2.0.md). Compatibility labels describe the current implementation, not the feasibility or desirability of a proposed change.

## Current Architecture

The active game already uses a numeric tile registry (`tiles2.json`) and numeric grid maps (`levels.json`). Definitions are property-driven, numeric tile IDs are stable, maps keep variants in a parallel grid, and old letter catalogs/maps remain supported as migration or runtime compatibility inputs. Runtime work is still concentrated in `game.js`; reusable codecs, validation, event, state, and editor modules have been extracted under `src/`.

## Capability Compatibility Matrix

| Approved area | Current status | Repository evidence and gap |
| --- | --- | --- |
| Roll-and-write, 2D side-scrolling dungeon crawler | Partial | The game is a 2D side-scrolling grid game with dice-based movement. It does not have a separately modeled write/mark action or roll-and-write domain layer. The genre statement is a product direction, not a claim that such a layer already exists. |
| Two independently spendable time pools | Partial | `dieValue1` and `dieValue2` are separately depleted, but movement availability is their sum and both are fixed six-sided rolls. There is no general time-pool abstraction. |
| Selected die determines where spending starts | Compatible | `selectedDie` controls `useMovementPoint()`; when the selected die empties, spending continues from the other die. |
| Items, abilities, and events may modify dice/time | Missing | Pickup effects support counters, XP, hearts, score, messages, and flags. Narrative events and achievements can modify progress, but there is no shared action API for modifying either die or time. Turbo is a movement mode, not a general dice/time effect system. |
| Every die change is observable and can trigger conditions | Missing | Current point spending mutates die values in `useMovementPoint()` without publishing a gameplay event. Dice are set directly by `rollDice()`; no common event covers spending, receipt, item use, reroll, replacement, or configured changes. Existing `after_move` and `after_roll` encounter triggers do not satisfy this requirement. |
| Two-die changes use deterministic events and avoid duplicate consequences | Missing | There is no dice-change transaction ID, per-change event sequence, post-change pair payload, or transaction-aware idempotency. The approved default attack limit must remain once per attacker instance per player roll across all these event sources. |
| Grid-based position and collision | Compatible | `cells` represent a rectangular grid; runtime collision, movement, and boundaries are resolved on grid coordinates. |
| SVG artwork is visual, not collision | Compatible | Collision and movement use definition properties such as `solid`, `slope`, and gravity; SVG is sanitized, loaded as an image, and rendered separately. |
| Inside, above, on top, below, beside, contact, configurable distance | Partial | The runtime has inside/top damage and directional movement costs; adjacent monster checks use four cardinal cells; encounter rules support Manhattan/Chebyshev distance and four relative positions. There is no shared spatial-query API for the whole approved relation set, and contact/distance semantics are not unified. |
| Blocked movement costs no time by default | Compatible, with interaction caveat | Ordinary movement spends after collision and jump validation, so a rejected step does not spend. Lock/monster interactions can resolve before movement payment and have their own behavior. Confirm whether those interactions are in scope for the timing rule. |
| Gravity and forced movement are free unless configured | Partial | Full and step gravity do not call `spendMovement`; step gravity is gated by remaining movement, while full gravity can run without it. Player-triggered `forceDown()` in a no-gravity/fluid tile does spend. There is no configurable cost policy for gravity/forced movement. |
| Movement costs can combine both dice | Compatible | `spendMovement()` consumes multiple points from the selected die and then the other. Current movement costs are point counts, not an explicit combined-pool cost model. |
| Movement costs are nonnegative whole numbers | Conflict | Validation accepts any finite number for movement cost fields. It does not reject negatives or fractions, and runtime spending assumes point-like decrements. |
| Selected die first, then other die | Compatible | This is implemented by `useMovementPoint()` and also applies to multi-point movement payment. |
| Global and level-specific dice capacities, including above six | Conflict | `rollDice()` hard-codes 1 through 6. There are no global/per-level capacity fields; the dirty encounter-rule validator/editor also caps exact-dice values at six. |
| Movement-triggered encounters evaluate after movement and time payment; other conditions can trigger from any die change | Partial | Generic `after_move` rules run after a paid move and post-movement processing, but do not run for each die change. Adjacent monster attacks also run after movement. Lock/monster attacks invoked by attempting to enter a solid tile are resolved before ordinary movement payment; `after_roll` rules are separate. The new design requires conditions to observe all die changes and does not make movement the exclusive trigger. |
| Voluntary early rerolls and roll-limit accounting | Partial | The existing UI permits rerolling while time remains; `rollDice()` replaces both values and increments `rollCount`, so the approved early-reroll allowance and existing roll-limit accounting are present. Per-die observable reroll events, same-value events, and explicit discard snapshots are missing. Both-dice exhaustion still requires another roll under the approved rule. |
| Attacks use current remaining dice by default | Compatible | `evaluateDiceRule()` reads the current `dieValue1` and `dieValue2`, which movement spending decrements. It does not make an independent enemy roll. |
| Automatic attacks at most once per attacker instance per player roll | Conflict | `checkAdjacentMonsterAttacks()` may revisit the same cell on successive moves in one roll. It returns after one hit per check, not once per attacker instance per roll. Encounter rules have an optional `once_per_roll` ledger keyed by tile ID, coordinate, and rule ID, but it is not the default monster attack path. |
| Damage immediately after triggering action resolves | Partial | Damage is applied synchronously through `takeDamage()` in movement, hazard, combat, and encounter handlers. Ordering varies by path; a single shared action-resolution boundary does not exist. |
| Runner attacks with current dice and configurable conditions | Partial | Monster variant `playerHit` has data-driven one- or two-die conditions (single-die value, sum, parity, or exact pair). This is not a general attack capability/rule model, and the condition set is narrower than encounter expressions. |
| Optional independent enemy rolls | Missing | Enemy checks evaluate the current player dice. There is no optional enemy roll policy or enemy dice state. |
| Automatic pickup on cell entry | Compatible | `handlePickupsAtCurrent()` is called after movement, gravity, and forced-step paths; collection immediately applies the reward and replaces the cell with air. |
| Gravity and automatic forced movement continue at zero time | Partial | Full gravity can run without time, but the step-gravity branch is coupled to `totalMovementPoints()`. Automatic forced movement has no general independent cost policy. `forceDown()` is player-directed and currently charges movement points in fluid; that interaction remains distinct from automatic movement. |
| Independent interaction costs | Missing | Locks and monsters resolve through special handlers; there is no generic interaction cost field independent from movement cost. |
| Item use defaults to zero time, configurable per item | Missing | There is no item-use action or inventory. Pickups apply effects immediately. |
| Structured inventory references numeric catalog Item IDs | Missing | Runner state has no inventory collection. The approved representation requires ID references, stack quantities or stateful per-instance records, and no duplicated item name or behavior. |
| Player statistics remain separate from inventory quantities | Missing | Existing stats/progression fields exist, but there is no inventory model or contract that keeps its quantities separate. |
| Unlimited inventory by default, optional limits | Missing | Runner state has no inventory collection or capacity model. |
| Items persist between levels by default, with exceptions | Partial | Reward totals and progression can carry across exits; there are no held items or persistence exceptions. Cell mutations are not saved midlevel. |
| Item rewards reference reusable catalog definitions | Partial | Reusable tile definitions and inline `effects` exist, but there is no inventory Item-ID reference contract for reusable item definitions. |
| Compact inventory serialization in resume links where useful | Missing | `src/state.js` serializes selected progress compactly, but has no inventory payload or compact item-reference encoding. |
| Custom named states and optional templates | Partial | `storyFlags` and once-only narrative events exist. There is no general named state/template model for tile or placed entities. |
| Placed-instance state persists through save/resume | Conflict | Monster HP is held in a coordinate-indexed runtime array; encounter activation is in an in-memory `Map`. Checkpoint state restores a canonical map and does not serialize midlevel position or mutations. There are no production player saves requiring migration; future state persistence still needs stable placement IDs. |
| Stable placement IDs and source-scoped rewards | Missing | Maps have no `instanceIds` grid and no source reward ledger. A pickup cell changes to air only for the current runtime map. Narrative `once` is keyed by event ID. Do not infer a source claim from possession of an Item ID. |
| Simultaneous rules: higher priority, then author order | Conflict | Dirty encounter rules sort only by local `order`; the runtime traverses cells row-major, with no global priority stage. Narrative events run in array order and have no priority field. |
| Seven approved categories | Conflict | Current editor metadata accepts only `Environmental`, `Item`, and `Interactive`. |
| Categories organize only; capabilities do not depend on category | Compatible | Categories are editor metadata and filtering. Gameplay reads definitions, not category values. Preserve this boundary. |
| Any tile can combine capabilities regardless of name, category, or numeric ID | Partial | Many supported properties can coexist on a definition and dispatch is mostly property-driven. Combat and locks still depend on specific variant data shapes; support is not yet universal across capability types. No runtime behavior should be selected by tile name, category, or numeric ID. |
| Manhattan spatial default with inclusive ranges | Partial | The dirty encounter-rule implementation defaults to Manhattan and validates inclusive min/max bounds; there is no shared spatial query API and contact/beside geometry is not unified. |
| Compressed resume links with 8 KiB target and file fallback | Missing | `src/resumeLinks.js` currently encodes existing hashes but does not compress inventory/instance state, enforce a target, or provide a resume-bundle fallback. Existing `#map=`, `#mapv=1`, `#st=`, and `#resume=1` forms remain compatibility requirements. |
| Nested rule actions capped at 64 children per root action | Missing | The dirty encounter engine resolves only the current limited action types and has no root-action child queue or queue cap. |
| Catalog and Inspector, expandable Rule Builder | Partial | Studio has a catalog/entry list and inspector. Encounter-rule editing is rendered from the tile property editor; it is not yet a dedicated top-level expandable Rule Builder area. |
| Show only enabled capabilities | Conflict | The Tile Builder renders all supported capability groups and properties, with default/override controls. It does not present only explicitly enabled capability groups. |
| Guided tile creation | Compatible | `studio.js` retains a multi-step tile-creation wizard with name, category, start mode, and review. |
| SVG thumbnails/editing without a large preview | Compatible in current UI | Catalog entries show SVG thumbnails and the Inspector edits artwork; the current Studio workspace markup has no large artwork-preview panel. `tile-catalog-guide.md` still describes a workspace artwork preview and should be corrected separately when docs are next reconciled. |

## Existing Mechanics to Preserve

- Stable numeric IDs, monotonic ID allocation, retired IDs, registry roles, and legacy aliases in `src/numericTileRegistry.js`.
- Explicitly versioned numeric maps, parallel variants, dimensions, spawn coordinates, and preserved top-level metadata in `src/numericMapCodec.js`.
- Legacy-to-numeric map decoding and normalization in `src/tileCompatibility.js`; keep old map strings and resume links readable during migration.
- Grid collision, gravity, fluids, slopes, bounce, fall damage, tile exits, and movement behavior that reads properties from definitions in `game.js` and `src/gameMapRuntime.js`.
- Selected-die-first payment, including multi-point payment from both dice, in `useMovementPoint()` and `spendMovement()`.
- Variant resolution and inherited variant properties in `src/shared/variants.js` and `src/editor/tilePropertyEditor.js` while migrating existing content.
- Generic encounter triggers, distance modes, conditions, expressions, ordered rules, and once-per-roll rule activation in `src/encounterRules.js`.
- Reusable narrative events, achievements, flags, progression, and level routing in `src/events.js`, `src/achievements.js`, `src/progression.js`, and `src/levelRouting.js`.
- Sanitized SVG import/editing and catalog thumbnails in `src/editor/svgArtwork.js` and `src/editor/studio.js`.
- Studio validation, dependency checks, stable-ID CRUD, document loading/saving, fallback download, and guided creation in `src/editor/studio.js`, `src/editor/documentStore.js`, and `src/editor/tilePropertyEditor.js`.
- Current checkpoint and portable-link compatibility via `src/state.js` and `src/resumeLinks.js`; `#map=`, `#mapv=1`, `#st=`, and `#resume=1` are existing public formats.
- Current item rewards, hazard behavior, exit routing, stats, counters, achievements, and message sanitization unless a separately approved design explicitly changes them.

## Missing Engine Capabilities

1. A unified dice/time model with global and level-specific per-die capacities, whole-number cost validation, modification actions, and an exhausted-pools/roll-required gate.
2. A dice-change event stream covering every die mutation, with post-change values, stable event/action identity, deterministic two-die sequencing, and idempotent condition/action consumption.
3. Shared spatial relation queries and defined distance/position semantics usable by movement, combat, hazards, and rules; Manhattan distance with inclusive integer bounds is the approved default.
4. A generic capability/action resolution layer that schedules combat and other encounters after payment while preserving immediate damage after action resolution.
5. Attacker-instance identity and a default once-per-player-roll activation ledger that applies across dice-change events.
6. Independent interaction time costs, plus structured inventory by numeric Item ID, item use/capacity, separate statistics, and reusable item references.
7. Named states, optional templates, stable placed-instance IDs, per-instance reward tracking, and level-scoped serialization.
8. Deterministic global rule evaluation ordered by priority and author-defined order.
9. A schema-aware editor model for the seven approved catalog categories, enabled capabilities, and an expandable focused Rule Builder.
10. A versioned migration path and preview for registries, maps, legacy monster/lock variants, inventory/reward references, and authored resume data. Production player-save migration is not required.

These are gaps relative to the approved decisions. This list does not define additional mechanics.

## Conflicts Requiring Resolution Before Implementation

- **Roll behavior:** Voluntary early rerolls are approved and already possible in the current UI; the runtime must preserve the existing roll-limit/persistence/death behavior and add per-die events even for unchanged results. Both exhausted dice still require a roll before further time-based movement.
- **Time and gravity:** Gravity and automatic forced movement must continue at zero remaining time; both are free unless independently configured. Runtime should distinguish these from player-directed interactions.
- **Manual downward movement:** `forceDown()` in fluid pays movement points. Confirm whether this is ordinary player movement or “forced movement” under the approved free-by-default decision.
- **Interaction timing:** Entering a monster/lock currently resolves a blocked interaction without movement payment; generic encounters run post-movement. Define which actions constitute encounter triggers and when their costs are charged.
- **Dice event evaluation:** Time spending starts at the selected die and spills to the other die only for the remaining cost; event sequence follows those actual mutations. Other multi-die actions need an explicit deterministic mutation order. The dispatcher evaluates each event against its immutable post-change dice snapshot, in sequence, after the originating action's mutations finish. Consequences deduplicate by action, rule, and source instance; consequence-triggered dice changes queue as later actions. Reroll events are evaluated even when values are unchanged. Remaining schema decisions are exact event names and how action-defined ordering is encoded. Automatic attacks remain capped once per attacker instance per player roll.
- **Placement persistence:** Stable UUID placement IDs and source-scoped rewards are approved. Runtime persistence is missing; no production player-save migration is required, and historical claims must not be invented.
- **Inventory persistence:** Define how level-transition exceptions are authored and how old immediate pickup rewards map to items, if item-use semantics are introduced.
- **Spatial semantics:** Manhattan distance and inclusive integer range endpoints are approved. Exact beside/contact/on-top geometry and diagonal inclusion remain open.
- **Resume-link packaging:** Compression, versioning, the 8 KiB target, and downloadable file fallback are approved; exact codec and bundle format remain implementation details.
- **Nested action safety:** The 64-child-action limit and overflow diagnostic are approved. A specific cycle-detection algorithm beyond the cap remains open.

## Proposed Reusable JSON Schema

The following is a **proposal for review**, not an approved format. It illustrates separation of identity, category, artwork, capabilities, map placement, reusable item rewards, and placed-instance state. Names/categories/IDs are not dispatch keys. The final version, field set, defaults, and migrations require approval before implementation.

```json
{
  "format": "runner.tile-system",
  "version": 2,
  "catalog": {
    "nextTileId": 106,
    "tiles": [
      {
        "id": 104,
        "name": "Example item",
        "category": "Items",
        "artwork": { "svg": "<svg>...</svg>" },
        "capabilities": { "item": {} }
      },
      {
        "id": 105,
        "name": "Example source",
        "category": "Interactables",
        "capabilities": { "reward": { "itemId": 104 } }
      }
    ]
  },
  "playerState": {
    "statistics": { "score": 0 },
    "inventory": {
      "stacks": [{ "itemId": 104, "quantity": 2 }],
      "instances": [{ "instanceId": "item-instance-1", "itemId": 104, "durability": 3, "charges": 2 }]
    }
  },
  "levels": {
    "example": {
      "map": {
        "format": "runner.numeric-map",
        "version": 2,
        "width": 1,
        "height": 1,
        "cells": [[105]],
        "variants": [[null]],
        "instanceIds": [["instance-1"]],
        "spawn": { "x": 0, "y": 0 }
      },
      "instanceState": {
        "instance-1": { "state": "default", "data": {} }
      },
      "rewardLedger": {
        "instance-1": { "reward-1": true }
      }
    }
  }
}
```

The following events illustrate the approved selected-die-first spend. Exact event type names are not yet selected. Each event's `after` pair is its immutable condition-evaluation snapshot:

```json
[
  {
    "eventId": "spend-123:1",
    "actionId": "spend-123",
    "sequence": 1,
    "type": "die_changed",
    "die": "die1",
    "before": { "die1": 2, "die2": 4 },
    "after": { "die1": 0, "die2": 4 }
  },
  {
    "eventId": "spend-123:2",
    "actionId": "spend-123",
    "sequence": 2,
    "type": "die_changed",
    "die": "die2",
    "before": { "die1": 0, "die2": 4 },
    "after": { "die1": 0, "die2": 3 }
  }
]
```

Here Die 1 was selected and the movement cost was 3, so the final remaining time is 3. If Die 2 were selected, its actual debit event would come first. For each originating action, capture all die-change events in mutation order before dispatching consequences. The dispatcher evaluates conditions for every `die_changed` event against that event's `after` snapshot, in sequence; a reroll action event is likewise evaluated against its final dice snapshot, including when values did not change. Any optional action-completed event is informational unless a future approved contract makes it a condition trigger.

Even when a rule matches multiple snapshots, apply its consequence at most once for the tuple `(actionId, ruleId, sourceInstanceId)` within that action; the first matching event in sequence claims the consequence. Record dispatched event IDs and consequence keys for idempotency. Queue dice mutations caused by consequences as later child actions after the current action's event batch, so they cannot interleave with its snapshots. Independently enforce the once-per-attacker-instance-per-player-roll key across distinct actions and events.

A reroll action should also emit an observable action event when a resulting value is unchanged; an event stream that records only unequal before/after values would miss that approved trigger.

Proposed schema constraints for discussion:

- Keep positive safe integer IDs stable and never reuse retired IDs; retain the current allocator/mapping guarantees.
- Keep `category` as optional catalog metadata from the seven approved labels. No capability or runtime dispatch may be inferred from category, name, or numeric ID.
- Represent runtime behavior as independently composable capability objects. Unknown extension data should be preserved, but validated core fields should have explicit types and defaults.
- Keep SVG in an artwork field and keep collision/spatial behavior in capability data.
- Represent movement costs as nonnegative safe integers and spend from the selected die first, spilling any remainder to the other die. The exact cost object is unresolved.
- Reference item rewards by numeric catalog Item ID rather than duplicating reward definitions on every placement. Item-use details remain unresolved.
- Store inventory stacks as `{ itemId, quantity }` and stateful items as instance records with an Item ID and only their changing instance state. Keep player statistics in a separate state object; do not copy item names or behavior into inventory.
- Preserve a rectangular grid and parallel per-cell identity/variant data. `instanceIds` or an equivalent stable placement marker must distinguish separate reward sources; the generation and repair policy is unresolved.
- Store level-scoped placed-instance state and reward-claim markers separately from reusable tile definitions. Never infer a source's reward state from Runner's inventory. The state/template shape and lifecycle are unresolved.
- If inventory is included in portable resume links, encode ID/quantity and instance-state data compactly where useful, with an approved size/fallback policy.
- Give rule records explicit `priority` and author order. Trigger/condition/action vocabulary and tie handling are unresolved.

The current version-1 registry and map codecs should remain adapters during any staged rollout; do not overwrite the preserved legacy source files.

## Migration Strategy

1. **Freeze and inventory inputs.** Treat `tiles2.json` and `levels.json` as canonical current content and retain `tiles2.legacy.json` / `levels.legacy.json` unchanged. Run existing validation and migration previews; record every reference, reward source, and unresolved cell before transforming anything.
2. **Version the schema and adapters.** Add explicit readers/writers for old numeric registry/map versions and the approved new version. Reuse `normalizeTileDefinitions()`, `decodeMapToNumeric()`, `decodeNumericMap()`, `encodeNumericMap()`, and the existing deterministic legacy mapping. Keep old URLs readable.
3. **Migrate definitions by data shape, not identity.** Convert current definition properties into capability data. Convert monster/lock variant entries into reusable capability-bearing records using their stored rule/combat fields; allocate stable IDs from the registry allocator. Convert rewards to reusable numeric Item-ID references. Never branch on display name, category, or a particular numeric ID. Preserve SVG, messages, legacy aliases, unknown JSON, and other variants.
4. **Migrate maps in preview-first mode.** Preserve every cell coordinate, tile reference, spawn, exit mapping, and applicable variant. Assign a stable identity to each placed instance that needs state/reward tracking, and retain an explicit migration manifest so IDs survive repeated conversions. Report ambiguous placements, duplicate/missing identity, unresolved references, and unprojectable legacy cells; do not silently drop or invent data.
5. **Migrate runtime state.** Introduce a new save version carrying Runner progress/dice, separate statistics and structured inventory, plus level-scoped instance state and reward claims. Preserve known fields from v2 local checkpoints. Since old checkpoints omit midlevel state, do not infer which reward sources were collected from inventory; flag the unavoidable uncertainty and use only an explicitly approved default/repair policy.
6. **Migrate portable links compatibly.** Continue decoding current `#map=`, `#mapv=1&map=`, `#st=`, and `#resume=1` forms. Version any new payload explicitly, and encode inventory references/quantities compactly where useful subject to an approved size policy. Keep checkpoint links usable in fresh browsers; do not imply that existing links contain unsaved midlevel state.
7. **Dual-read, single-write rollout.** During transition, read legacy and current documents but write only the approved new version after validation. Offer export/preview and retain backups until representative saves, links, levels, and entity interactions pass regression tests.

## Reusable Code and Components

| Existing surface | Reuse in a future approved implementation |
| --- | --- |
| `src/numericTileRegistry.js`: `normalizeTileRegistry()`, `allocateTileId()`, `addNumericTile()`, `duplicateNumericTile()`, `removeNumericTile()` | Stable identity, validation, deterministic legacy mapping, and ID allocation. Extend versioning rather than replacing these guarantees. |
| `src/numericMapCodec.js`: `createNumericMap()`, `decodeNumericMap()`, `encodeNumericMap()`, `validateNumericMap()` | Versioned rectangular map parsing and validation; extend for instance identity only after the data model is approved. |
| `src/tileSystemV2.js`: version constants, `validate*V2()`, `decode*Document()`, `encode*Document()` | Additive Phase 1 registry/map/level and player-state schema validation/codecs; existing v1 runtime codecs remain unchanged. |
| `src/tileSystemMigrationPreview.js`: `previewAuthoredMigrationV1ToV2()` | Pure authored-content preview with deterministic placement UUID candidates, legacy variant review, category/capability field mapping, and no file writes. |
| `src/tileSystemV2ResumeCodec.js`: `encodeResumeStateV2()`, `decodeResumePayloadV2()` | Detached gzip v2 resume codec with URL target and file-payload fallback; does not replace or wire into legacy links in Phase 1. |
| `scripts/preview-tile-system-v2.mjs`: `npm run preview:tile-system-v2` | Read-only CLI for current v1 authored content; rejects `--apply`/`--write`. |
| `src/tileCompatibility.js`: `normalizeTileDefinitions()`, `decodeMapToNumeric()`, `decodeMapForRuntime()` | Legacy/current adapter boundary and property-based registry normalization. |
| `src/gameMapRuntime.js`: `buildNumericGameMap()` | Runtime grid and per-cell state-map initialization; a likely home for instance-state initialization once designed. |
| `src/shared/variants.js`: `sanitizeVariant()`, `getVariantBucketEntry()`, `mergeVariantDef()` | Existing variant reads and compatibility while content migrates. |
| `src/encounterRules.js`: `resolveEncounterRulesAt()`, expression parsing/evaluation, validators | Existing trigger-condition-action evaluation and validation; extend with approved capabilities/order only after contracts are decided. |
| `src/editor/encounterRuleEditor.js`: `renderEncounterRuleEditor()` | Focused rule authoring controls and rule testing; refactor placement/layout, not domain behavior, as needed. |
| `src/tileProperties.js` and `src/editor/tilePropertyEditor.js`: property metadata and editor rendering | Capability metadata, typed controls, override/inheritance behavior, and safe unknown-property editing. |
| `src/editor/svgArtwork.js` and `src/editor/studio.js`: `sanitizeSvgArtwork()`, tile thumbnails, artwork import | Sanitized SVG handling and the existing no-large-preview thumbnail/editor workflow. |
| `src/validation.js`: `validateTiles()`, `validateLevels()`, `validateContentDocuments()` | Central content diagnostics and cross-reference validation. |
| `src/editor/documentStore.js`: `ContentDocumentStore` | Multi-document load, import, dirty tracking, validation boundary, save/export lifecycle. |
| `src/state.js`: `createInitialState()`, `createCheckpointState()`, carry codecs, local save/load | Versioned save migration and persistence compatibility; add instance state under explicit versioning. |
| `src/resumeLinks.js`: `createResumeHash()`, `createResumeUrl()` | Versioned portable link encoding while retaining old hash forms. |
| `src/events.js`, `src/achievements.js`, `src/levelRouting.js` | Existing narrative/event, achievement, and route behavior; avoid duplicating these systems in the tile schema. |

## Incremental Implementation Plan and Test Gates

Phase 0 architecture decisions are approved. Phase 1 may proceed only on authored schemas, validation, codecs, and migration previews; later phases still require their own approval. Keep all implementation data-driven and never dispatch by tile name, category, or ID.

| Phase | Scope after approval | Required verification |
| --- | --- | --- |
| 0. Contract decisions | Approved decisions are recorded in the design specification and Phase 0 contract; non-blocking schema/geometry details remain pending. | Confirm pending defaults are not treated as approved implicitly. |
| 1. Schemas, validation, codecs, and preview | Add additive v2 registry/map/level schemas, validators/codecs, and deterministic authored-content migration previews. Do not change gameplay, editor UI, active catalogs, levels, or player saves. | Unit tests for representations, v1 adapters/round trips, stable ID preservation, unknown-property preservation, deterministic preview output, and zero file writes. |
| 2. Runtime foundations | Add spatial queries, configurable dice pools, shared time spending/modification, dice-change events, roll gating, and action-resolution ordering as approved. | Unit tests for each spatial relation/distance metric; every die-change source; selected-die-first spend and spill events in actual order; immutable post-change snapshots; deterministic action-defined order for other multi-die changes; reroll events with unchanged values; per-action consequence idempotency; selected-die depletion/fallback; zero/combined costs; pool maxima above six; blocked moves; gravity; forced movement; and roll-required boundaries. Browser tests for movement and item-driven dice changes. |
| 3. Capabilities and encounters | Move locks/monsters and related rule resolution behind capability data; apply priority/order and once-per-instance-per-roll behavior. | Unit tests for one activation per instance/roll, deterministic ordering, current-dice attacks, optional independent enemy rolls, and immediate damage; browser coverage for attack, lock, and post-payment timing. |
| 4. Items and instance state | Introduce numeric-ID inventory stacks and item instances, reusable reward references, inventory/use costs/limits, named states/templates, stable placed-instance state, and source-scoped reward ledgers. | Unit/browser tests for stack quantities, stateful item instances, stats separate from inventory, auto pickup, configured use costs, inventory defaults/limits, multiple sources awarding the same Item ID, source-specific once-only rewards, cross-level persistence/exceptions, first-format initialization, compressed link round trips, and file fallback. No production save migrator is required. |
| 5. Studio authoring | Add the seven catalog categories, capability visibility, Catalog/Inspector/expandable Rule Builder layout, focused complex-rule editor, guided creation, and SVG thumbnail/edit flow. | Browser tests for category filters without behavior changes, capability combinations, property toggles, guided creation, rule editing/testing, artwork sanitization, and narrow responsive layout. |
| 6. Content and compatibility migration | After approval, apply reviewed previews to authored catalogs/maps and convert monster/lock variants; retain legacy imports/URLs and source backups. No production player-save migration. | Migration fixtures and golden-map comparisons; old and new registry/map tests; prototype checkpoint behavior regression; legacy/custom numeric URL tests; fresh-context resume tests; full `npm run check`. |

Phase 1 schema/codec/preview coverage is in `tests/tileSystemV2.test.js`. Existing focused coverage to extend in later phases includes `tests/numeric-tile-compatibility.test.js`, `tests/mapCodec.test.js`, `tests/validation.test.js`, `tests/encounterRules.test.js`, `tests/state.test.js`, `tests/resumeLinks.test.js`, `tests/numeric-gameplay.browser.spec.js`, and `tests/editor-studio.browser.spec.js`. The full repository gate is `npm run check`; Phase 1 does not alter engine/editor behavior or active content.

## Design Ambiguities for Review

- Is “roll-and-write” a literal player action/board-marking loop, or the high-level description of rolling dice and writing/recording progress?
- Voluntary early rerolls, selected-die-first spill, zero-time gravity/automatic forced movement, stable placement IDs, higher-priority-first ordering, global/level dice capacities, the 64-child limit, Manhattan defaults, compressed 8 KiB-target links with file fallback, and no production player-save migration are approved.
- Does “gravity and automatic forced movement” include player-directed down movement in fluid, bounce steps, and other player-triggered displacement?
- Are blocked attacks/interactions considered movement attempts for time payment and encounter ordering?
- Which spatial relations are directional, symmetric, or inclusive of diagonals? Manhattan distance and inclusive integer range endpoints are approved.
- Does “attacker instance” mean the whole placed entity or an individual attack source within it? Does the once-per-roll guard reset only on a new player roll or also on level transition?
- Are state templates definitions of allowed state shape, default values, capability bundles, or something else? Can templates be nested or overridden?
- How should duplicate/missing placement identities be reported in a migration preview when no production save history exists? Authored placement identity and copy/move behavior are approved.
- What is the omitted-value default for independent interaction costs, and which blocked interactions charge them?
- Which event type names and action-order encodings should the schema use? Per-die snapshots, after-action dispatch, first-match consequence, and the 64-child limit are approved.
- Which compression codec and downloadable bundle format should implement the approved resume-link target/fallback?

These questions remain for later-phase design review. They do not block Phase 1's schemas, validation, codecs, and authored-content migration previews; gameplay/editor work remains out of scope.