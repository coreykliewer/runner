# Runner Tile System 2.0: Phase 0 Technical Contract

**Status:** Proposed contract for review. Not authorization to implement.

This proposal is subordinate to the approved decisions in [TILE-SYSTEM-2.0.md](TILE-SYSTEM-2.0.md) and the current-code findings in [TILE-SYSTEM-2.0-AUDIT.md](TILE-SYSTEM-2.0-AUDIT.md). The schema, defaults, examples, and migration policies below that go beyond those decisions are recommendations requiring approval. No engine, editor, catalog, map, or save-format changes are included in this phase.

## 1. Contract Principles

1. One numeric registry owns all tile and item definitions. Tile IDs and Item IDs share its monotonic allocator and namespace; an item is a catalog record with an `item` capability, not a separate hard-coded entity schema.
2. The seven categories are labels for catalog organization only: `Environment`, `Items`, `Creatures`, `Mechanisms`, `Hazards`, `Interactables`, and `Effects`. Names, categories, and IDs are never gameplay dispatch keys.
3. A definition is an identity plus optional artwork, category metadata, and any combination of capabilities. Capabilities and rules are data. The engine evaluates generic capability and rule contracts, not object names such as Rat, Lock, or Chest.
4. Keep SVG artwork separate from collision and gameplay. A sanitized SVG is presentation only; grid cells and capability data control traversal and interaction.
5. Keep maps, per-placement state, player state, and reusable catalog definitions separate. Save only changed per-instance state and inventory deltas, not copied item definitions.
6. Preserve unrecognized JSON properties as compatible extension data during migration, editing, import/export, and round trips. Do not silently discard fields merely because this editor version does not understand them.

## 2. Proposed Versioned JSON Contract

The example format versions are proposals. Current active formats remain `runner.numeric-tile-registry` v1, `runner.numeric-map` v1, and Runner save state v2 until separately approved and migrated.

All numeric IDs in the examples are fictional, non-authoritative placeholders, not allocations or reservations. In particular, `90001` through `90007` are chosen outside the active catalog range observed while preparing this contract. Production IDs must always come from the live shared allocator; sample `nextTileId` values are illustrative only.

### Registry v2

Proposed registry format: `runner.numeric-tile-registry`, version `2`. Keep current fields such as `nextTileId`, `legacyIdMapping`, and role IDs where applicable. Do not renumber or recycle any existing ID. Allocate every new catalog entry, including item definitions, through the same `nextTileId` allocator.

```json
{
  "format": "runner.numeric-tile-registry",
  "version": 2,
  "nextTileId": 90002,
  "legacyIdMapping": { "R": 2, ".": 1 },
  "airTileId": 1,
  "playerArtTileId": 2,
  "settings": {
    "dice": {
      "die1": { "maximum": 6 },
      "die2": { "maximum": 6 }
    }
  },
  "tiles": [
    {
      "id": 90001,
      "name": "Display-only name",
      "category": "Environment",
      "artwork": { "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><rect width=\"32\" height=\"32\"/></svg>" },
      "capabilities": {
        "traversal": {
          "collision": { "mode": "blocking", "shape": "cell" },
          "movement": { "entryCost": { "default": 1, "fromAbove": 1, "whileInside": 1 } },
          "gravity": { "enabled": true, "timeCost": 0 }
        }
      },
      "legacyCode": "P",
      "futureCompatibleProperty": { "preserved": true }
    }
  ]
}
```

Rules for this document:

- `id` is a positive safe integer. Existing IDs remain stable. `nextTileId` is greater than all active and reserved IDs.
- `name` is display metadata. `category` is optional and must be one of the seven labels. Neither selects behavior.
- `artwork.svg` contains editable, sanitized SVG. It never affects collision.
- `capabilities` is an open object containing only capabilities enabled for that definition. Unrecognized capability keys and other unknown properties survive round trips.
- Item definitions use the same `tiles` array and ID allocator. `capabilities.item` marks an item definition and contains item-specific authoring data. A reward refers to that record by `itemId`.
- The shown global dice settings are a proposed location for default maximums. A level may override them only if that precedence is approved; otherwise keep the settings in the single ruleset configuration. Each maximum is a positive integer and may exceed six.
- `legacyCode` and `legacyIdMapping` remain compatibility aliases only. Runtime behavior does not depend on them.

### Composable Capabilities

The capability namespace is intentionally generic. This proposal's initial vocabulary is:

| Capability | Proposed responsibility |
| --- | --- |
| `traversal` | Grid collision, movement costs, gravity, and optional forced-movement costs. Blocked movement cost defaults to zero. Costs are nonnegative whole numbers; a spend can consume both dice. |
| `vitals` | Maximum health, defense, and other generic damage-resistance values. Current health belongs to placed-instance state or player state, not a shared definition. |
| `item` | Stackability, use-time cost (default zero), use/equip eligibility, and typed `onUse` actions applied in the atomic item-use transaction. It contains no player-owned quantity. |
| `equipment` | Allowed slot metadata and generic capability modifiers while equipped. The equipment instance references the catalog Item ID. |
| `states` | Optional named state definitions, initial state, and valid state transitions. Current state belongs to the placed instance. |
| `rules` | Generic trigger-condition-action rules. Rule source may be any placed instance or global event source. |
| `rewards` | Reusable reward references, including numeric `itemId`, quantity, and stable reward key. Claims are scoped to a placed source instance. |
| `hazards` | Generic damage or status actions associated with a defined spatial/time trigger. |

These names are a proposal, not a new approved mechanic list. The implementation may consolidate overlapping capability names if it preserves the approved behavior and authoring clarity. A tile can combine any of them regardless of category.

Spatial relations and ranges have one authority: `rules[].trigger.relation`. Do not also store range/minimum/maximum/metric in a tile-level detection capability. A rule without a spatial trigger has no spatial range; a rule with one uses that rule's relation definition. The default metric remains pending approval in Section 7.

### Rule Record

Proposed common rule shape:

```json
{
  "id": "rat-bite",
  "priority": 20,
  "authorOrder": 10,
  "trigger": {
    "events": ["movement_resolved", "die_changed"],
    "relation": { "kind": "distance", "minimum": 1, "maximum": 2, "metric": "manhattan" }
  },
  "conditions": [
    { "type": "dice_sum", "operator": "lessThanOrEqual", "value": 3 }
  ],
  "actions": [
    { "type": "damage", "target": "runner", "amount": 1 }
  ],
  "activation": { "scope": "attacker_per_player_roll" }
}
```

Rule conditions use a validated expression/condition vocabulary, not JavaScript evaluation. Actions are typed data such as `damage`, `modify_die`, `grant_item`, `consume_item`, and `transition_state`. The initial schema must not add a custom rule type per creature or object. Any optional script/plugin system is outside this contract and requires separate approval.

### Atomic Item Use

Proposed item use is one all-or-nothing action transaction coordinating inventory consumption, any configured use-time cost, item-defined dice changes, and event generation:

1. Preflight the item reference/instance, quantity, usability conditions, and total required time. If preflight fails, do not consume inventory or mutate either die; emit no committed `item_used` or `die_changed` event.
2. Stage the inventory decrement, time payment, and item-defined effects as one transaction. Apply time payment first using selected-die-first spending; apply item-defined dice changes next in their declared deterministic order. Every actual die mutation produces its own immutable `die_changed` event in actual mutation order.
3. If any required part cannot be completed, abort the staged transaction without partial inventory or dice changes. On success, commit all staged state together, then publish the captured events in sequence. An `item_used` completion event follows the inventory/time/effect mutations and carries the committed final context and dice pair.
4. Only after successful commit does the dispatcher evaluate the captured events. It observes inventory after consumption and reads the immutable per-die snapshots for `die_changed` conditions. Consequences that further modify dice are queued as child actions and cannot interleave with this transaction's events.

This transaction boundary prevents consuming an item without its time/effect result, or granting a dice effect without consuming the item. Whether a failed use emits a separate non-consequential diagnostic event is an implementation detail, not an inventory or dice mutation.

## 3. Seven Complete Tile Examples

These are illustrative v2 records, not changes to `tiles2.json`. IDs `90001` through `90007` are fictional, non-authoritative placeholders selected outside the current active range; they are not assigned or reserved IDs. Real IDs must be obtained from the shared allocator. All examples use the same `id`, `name`, `category`, `artwork`, `capabilities` record shape. A capability not shown is disabled/absent.

```json
[
  {
    "id": 90001,
    "name": "Stone Wall",
    "category": "Environment",
    "artwork": { "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><rect width=\"32\" height=\"32\" fill=\"#68716f\"/><path d=\"M0 16h32M16 0v16M8 16v16\" stroke=\"#303a38\"/></svg>" },
    "capabilities": {
      "traversal": {
        "collision": { "mode": "blocking", "shape": "cell" },
        "movement": { "blockedCost": 0 }
      },
      "vitals": { "maximumHealth": 8, "defense": 4 }
    }
  },
  {
    "id": 90002,
    "name": "Water",
    "category": "Environment",
    "artwork": { "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><rect width=\"32\" height=\"32\" fill=\"#438da0\"/><path d=\"M0 10q8-5 16 0t16 0M0 22q8-5 16 0t16 0\" fill=\"none\" stroke=\"#b7e4dc\" stroke-width=\"2\"/></svg>" },
    "capabilities": {
      "traversal": {
        "collision": { "mode": "passable", "shape": "cell" },
        "movement": { "entryCost": { "default": 1, "whileInside": 1 } },
        "gravity": { "enabled": false, "timeCost": 0 }
      }
    }
  },
  {
    "id": 90003,
    "name": "Rat",
    "category": "Creatures",
    "artwork": { "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><ellipse cx=\"16\" cy=\"19\" rx=\"10\" ry=\"7\" fill=\"#8b8174\"/><circle cx=\"24\" cy=\"16\" r=\"5\" fill=\"#8b8174\"/><circle cx=\"26\" cy=\"15\" r=\"1\" fill=\"#111\"/><path d=\"M7 21q-8 1-5 7\" fill=\"none\" stroke=\"#b56b6b\" stroke-width=\"2\"/></svg>" },
    "capabilities": {
      "traversal": { "collision": { "mode": "blocking", "shape": "cell" } },
      "vitals": { "maximumHealth": 3, "defense": 0 },
      "rules": [
        {
          "id": "rat-bite",
          "priority": 20,
          "authorOrder": 10,
          "trigger": {
            "events": ["movement_resolved", "die_changed"],
            "relation": { "kind": "distance", "minimum": 1, "maximum": 2, "metric": "manhattan" }
          },
          "conditions": [{ "type": "dice_sum", "operator": "lessThanOrEqual", "value": 3 }],
          "actions": [{ "type": "damage", "target": "runner", "amount": 1 }],
          "activation": { "scope": "attacker_per_player_roll" }
        }
      ]
    }
  },
  {
    "id": 90004,
    "name": "Lock",
    "category": "Mechanisms",
    "artwork": { "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><rect x=\"5\" y=\"13\" width=\"22\" height=\"17\" rx=\"2\" fill=\"#b28b42\"/><path d=\"M10 13V9a6 6 0 0 1 12 0v4\" fill=\"none\" stroke=\"#554323\" stroke-width=\"3\"/><circle cx=\"16\" cy=\"21\" r=\"2\" fill=\"#342b20\"/></svg>" },
    "capabilities": {
      "traversal": {
        "collision": { "mode": "blocking", "shape": "cell", "byState": { "open": "passable" } },
        "movement": { "blockedCost": 0 }
      },
      "states": {
        "initial": "locked",
        "definitions": { "locked": {}, "open": {} },
        "transitions": [{ "from": "locked", "to": "open" }]
      },
      "rules": [
        {
          "id": "unlock-with-key",
          "priority": 50,
          "authorOrder": 20,
          "trigger": { "events": ["interaction_requested"], "relation": { "kind": "contact" } },
          "conditions": [
            { "type": "inventory_quantity", "itemId": 90005, "operator": "greaterThanOrEqual", "value": 1 },
            { "type": "dice_sum", "operator": "greaterThanOrEqual", "value": 4 }
          ],
          "actions": [
            { "type": "consume_item", "itemId": 90005, "quantity": 1 },
            { "type": "transition_state", "target": "self", "to": "open" }
          ]
        }
      ]
    }
  },
  {
    "id": 90005,
    "name": "Gold Key",
    "category": "Items",
    "artwork": { "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><circle cx=\"10\" cy=\"12\" r=\"6\" fill=\"none\" stroke=\"#d4aa35\" stroke-width=\"4\"/><path d=\"M15 16 28 29m-5-5 4-4m-8 0 4-4\" fill=\"none\" stroke=\"#d4aa35\" stroke-width=\"4\"/></svg>" },
    "capabilities": {
      "item": { "stackable": true, "useTimeCost": 0, "automaticPickup": true }
    }
  },
  {
    "id": 90006,
    "name": "Treasure Chest",
    "category": "Interactables",
    "artwork": { "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path d=\"M3 12h26v17H3z\" fill=\"#85502f\"/><path d=\"M3 12q13-13 26 0v5H3z\" fill=\"#b8783f\"/><path d=\"M14 16h4v7h-4z\" fill=\"#e2bd59\"/></svg>" },
    "capabilities": {
      "traversal": { "collision": { "mode": "blocking", "shape": "cell", "byState": { "open": "passable" } } },
      "states": {
        "initial": "closed",
        "definitions": { "closed": {}, "open": {} },
        "transitions": [{ "from": "closed", "to": "open" }]
      },
      "rewards": [{ "id": "chest-key", "itemId": 90005, "quantity": 1, "claimScope": "placed_instance_once" }],
      "rules": [
        {
          "id": "open-chest",
          "priority": 10,
          "authorOrder": 30,
          "trigger": { "events": ["interaction_requested"], "relation": { "kind": "contact" } },
          "conditions": [{ "type": "state_equals", "target": "self", "value": "closed" }],
          "actions": [
            { "type": "transition_state", "target": "self", "to": "open" },
            { "type": "grant_reward", "rewardId": "chest-key" }
          ]
        }
      ]
    }
  },
  {
    "id": 90007,
    "name": "Time Potion",
    "category": "Effects",
    "artwork": { "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path d=\"M10 3h12v5l4 5v15H6V13l4-5z\" fill=\"#8c557d\"/><path d=\"M10 18h12\" stroke=\"#ead8a1\" stroke-width=\"3\"/><circle cx=\"16\" cy=\"23\" r=\"2\" fill=\"#ead8a1\"/></svg>" },
    "capabilities": {
      "item": {
        "stackable": true,
        "useTimeCost": 0,
        "automaticPickup": true,
        "consumeOnUse": true,
        "onUse": [
          { "type": "modify_die", "target": "selected", "operation": "add", "amount": 2, "clampToMaximum": true }
        ]
      }
    }
  }
]
```

Rat is only a data example. In the focused Inspector/Rule Builder, a designer edits its display `name`, the rule's trigger relation `maximum`, dice-condition `value`, and damage `amount`. Saving changes JSON data only; no engine branch or handler for the string `Rat` is added. The same rule record and controls apply to other catalog entries.

## 4. Dice-Event Architecture

### Proposed Event Envelope

Use an immutable event per die mutation, with one root action ID shared by the action's event batch:

```json
{
  "eventId": "action-uuid:1",
  "actionId": "action-uuid",
  "parentActionId": null,
  "sequence": 1,
  "type": "die_changed",
  "die": "die1",
  "operation": "spend",
  "before": { "die1": 2, "die2": 4 },
  "after": { "die1": 0, "die2": 4 },
  "valueChanged": true,
  "rollId": "player-roll-uuid",
  "source": { "kind": "movement", "instanceId": null }
}
```

Snapshots are value copies. They are never mutated after event creation. `eventId` is unique; `actionId` identifies the whole causal action; `parentActionId` links a consequence-created child action; `sequence` is assigned from actual mutation order. The pair in `after` is the only dice pair a condition for that event may read.

### Approved Early Rerolls

Voluntary rerolls are approved while unused time remains. A voluntary reroll discards the remaining time from both dice, replaces both die values, and consumes exactly one player roll under the existing roll-limit mechanic. Emit an observable reroll event for each die even when its numeric result is unchanged. Preserve existing roll-limit behavior, persistence, and death conditions; the reroll rule does not add a separate roll counter or change those conditions. The exact event names and serialization remain governed by the proposed event schema and are not implementation authorization.

### Spend Example: Die 1 = 2, Die 2 = 4, Die 1 Selected, Cost = 3

The spend is one action with two ordered mutations. Time remaining after the action is 3.

| Sequence | Mutation | Before snapshot | After snapshot |
| --- | --- | --- | --- |
| 1 | Spend 2 from selected Die 1 | `(2, 4)` | `(0, 4)` |
| 2 | Spend remaining 1 from Die 2 | `(0, 4)` | `(0, 3)` |

The event list is `die1` then `die2`, because that is the actual selected-first debit order. If Die 2 was selected, the event list begins with Die 2. Movement cost validation guarantees a nonnegative whole number and preflight ensures combined remaining time covers a successful paid action. A blocked movement defaults to cost zero and does not emit spend events.

### Evaluation and Consequence Order

Proposed dispatcher contract:

1. Validate and identify the originating action. Assign one root `actionId` and record its `rollId` and action context.
2. Apply all state mutations belonging to that originating action in deterministic order. For each die mutation, immediately append an event containing a fresh immutable dice snapshot. A multi-die spend orders mutations selected die first, then the other die. Other actions state their explicit target order. Rerolls emit an observable per-die reroll event even if `before` equals `after`; use `valueChanged: false` rather than suppressing the event.
3. Do not execute rule consequences between the mutations of one action. Once that action is resolved, evaluate conditions for every captured event in ascending `sequence`, using that event's immutable `after` pair and captured action context. Evaluate all matching conditions for a given event against the same snapshot before applying any consequences from it.
4. For each event snapshot, gather matches, then sort by higher `priority` first and lower `authorOrder` first. Proposed validation requires `authorOrder` to be unique within the applicable event-order scope; equal priority is therefore deterministic and author-controlled, not map-row order or tile-ID order.
5. By default, the first matching event in sequence claims a consequence key `(actionId, ruleId, sourceInstanceId)`. A later snapshot from the same action may still be evaluated, but cannot repeat that consequence. Record processed `eventId`s and consequence keys so retry/replay is idempotent. An explicit per-event repeat option is a proposed advanced setting and must not bypass the automatic-attack guard.
6. Apply queued consequences in the sorted match/action order after evaluation of the originating event batch. Damage takes effect synchronously when its consequence is applied, after its triggering action has resolved and before the next player input/action.
7. If a consequence changes a die, enqueue it as a child action with its own `actionId`, `parentActionId`, sequence, and event batch. Finish the current batch first; then process child actions FIFO. Never interleave child mutations into a parent snapshot sequence.
8. Independently key automatic attacks by `(playerRollId, attackerInstanceId)`. The first qualifying attack consumes that key, so repeated movement, multiple dice events, retries, or child actions do not cause a second automatic attack by that attacker in the same roll. This is the approved default.

This makes every die change observable without collapsing it into `movement_resolved`. `movement_resolved` remains a separate action event after payment and movement resolution. Rule engine safety should include cycle detection and a bounded child-action queue. A concrete queue limit and behavior on limit exhaustion are proposals requiring approval because they affect extreme rule chains.

## 5. Inventory and Placed-Instance Identity

### Proposed Player-State Shape

Player statistics are independent from inventory. Stateless stack quantities use catalog IDs; individual item instances are stored only when per-copy state such as durability, charges, or identity is required.

```json
{
  "statistics": { "health": 5, "score": 12, "xp": 3 },
  "inventory": {
    "stacks": [
      { "itemId": 90005, "quantity": 2 }
    ],
    "instances": [
      { "instanceId": "item-uuid", "itemId": 90007, "charges": 1, "durability": 4 }
    ],
    "equipment": [
      { "slot": "hand", "itemInstanceId": "item-uuid" }
    ]
  }
}
```

The catalog definition supplies item name, artwork, rules, use cost, stackability, and equipment eligibility. Inventory stores only `itemId`, quantity, and necessary changing instance state; it does not copy the item name or behavior. Equipped items are references to owned item records, not duplicate definitions. Statistics such as score, health, and XP are not item counts.

### Proposed Placement IDs

Recommend an opaque UUID per stateful/reward-capable placement, stored in an `instanceIds` grid parallel to `cells` and `variants`; use `null` for stateless cells. Instance identity is separate from the numeric catalog ID:

- Moving/editing an existing placement preserves its `instanceId`.
- Duplicating or painting a new placement allocates a new UUID, even if tile ID and variant are identical.
- Copying a level allocates new placement UUIDs for the copied level so reward claims cannot cross between copies.
- IDs are persisted in authored maps and runtime saves; they are never reconstructed from the current coordinates during ordinary load.
- For legacy migration, create missing UUIDs once and persist a migration manifest keyed by source document, level key, old coordinate, tile ID, and variant. Re-running the same migration reuses manifest values. After conversion, map-editor operations preserve or replace IDs according to move versus duplicate semantics.

The exact UUID version and copy-level policy require review. Coordinates, names, categories, and tile IDs alone are not durable instance identity.

### Proposed Map and Instance State

```json
{
  "format": "runner.numeric-map",
  "version": 2,
  "width": 2,
  "height": 1,
  "cells": [[90006, 90004]],
  "variants": [[null, "a"]],
  "instanceIds": [["chest-uuid", "lock-uuid"]],
  "spawn": { "x": 0, "y": 0 }
}
```

Save only non-default placed-instance state and source-scoped reward claims. A reward claim key is `(levelKey, instanceId, rewardId)`. The same `itemId` may be awarded by many sources; possessing that item never proves a specific source has been claimed.

```json
{
  "instanceState": {
    "chest-uuid": { "state": "open" },
    "rat-uuid": { "health": 2 }
  },
  "rewardClaims": [
    { "instanceId": "chest-uuid", "rewardId": "chest-key" }
  ]
}
```

## 6. Compatibility and Migration Rules

Migration is preview-first, dual-read, single-write, and data-driven. Existing behavior remains active until a separately approved cutover. Do not change active catalogs/maps or saved-game formats as part of this contract.

| Existing data/behavior | Compatibility rule |
| --- | --- |
| Numeric tile registry v1 and stable IDs | Read v1 unchanged. Migrate records to the proposed v2 shape without renumbering, reusing, or compacting IDs. Preserve `legacyIdMapping`, role IDs, names, aliases, unknown fields, and all SVG source. Use the current allocator for additions. |
| Numeric maps v1 | Read `cells`, parallel `variants`, and `spawn` unchanged. v2 adds parallel `instanceIds`; variants are copied cell-for-cell. Validate dimensions before writing. |
| Legacy RLE maps and links | Keep the old string decoder and `#map=` reader. Keep `#mapv=1&map=` numeric links. New map writers can emit v2 only after approval; do not reinterpret old hash payloads. |
| Snake and Lock variants | Continue resolving existing `monster` and `lock` variants during migration. Convert their stored fields to generic capabilities/rules in a preview, preserve original variant keys/data as compatibility extensions, and test equivalent behavior before retiring any adapter. Do not dispatch on the words Snake or Lock. |
| Existing encounters and narrative events | Adapt current encounter rules and narrative events into generic event/condition/action interfaces. Preserve trigger fields, event order, once flags, rules, messages, and unknown properties. Do not merge their schemas destructively or change timing until parity is demonstrated. |
| SVG artwork | Preserve source strings and variant artwork. Continue sanitizer behavior and use artwork only for rendering/catalog thumbnails, never collision. |
| Local save v2 | Keep the v2 decoder and existing checkpoint semantics: restore the canonical level map/spawn and saved Runner/dice fields. v2 does not record midlevel placement or reward history; do not invent a source claim or infer one from inventory. Midlevel pickups may reappear after checkpoint restore as they do today. Begin source-scoped claim tracking only when a claim is actually observed and recorded in the new format. |
| Resume links | Continue reading `#map=`, `#mapv=1&map=`, `#st=`, and `#resume=1`. New portable state gets an explicit version marker. Do not claim old links contain midlevel map mutations or placement state that they never encoded. |
| Current gameplay | Keep old readers and behavior behind adapters until migrated fixtures and browser tests pass. A migration preview must report changes and unresolved records; no unknown cell, variant, SVG, or property is silently discarded. |

Unknown compatible properties must survive read/edit/save even if absent from the current form controls. Invalid recognized values should be diagnosed, not coerced silently. Migration output must be deterministic and repeatable.

## 7. Proposed Defaults Requiring Approval

These recommendations are not approved design decisions. Choices with likely gameplay impact are marked **material**.

| Question | Recommended default | Gameplay impact / approval note |
| --- | --- | --- |
| Gravity and forced movement | Free unless a capability configures a whole-number cost. Treat each completed grid displacement as a movement action; evaluate movement rules after its resolution. Costs, if configured, use selected-die-first spill. | **Material:** whether gravity happens at zero remaining time and whether every fall cell can trigger rules changes hazards/encounter frequency. Recommend resolve each discrete fall/forced step, but ask approval. |
| Stable instance IDs | Opaque UUID per stateful/reward-capable placement; persist in `instanceIds`. Move preserves ID, duplicate/new placement creates one, copied level receives new IDs. Legacy conversion writes once and reuses a migration manifest. | **Material:** changing identity resets state/reward eligibility; map-editor copy/move semantics need explicit approval. |
| Equal-priority rules | For each event snapshot, priority descending, then explicit `authorOrder` ascending. Require unique author order within the event scope. Never use map row, tile name, category, or tile ID to break ties. | **Material:** determines which state mutation/reward happens first. Priority direction and author-order scope must be approved. |
| Legacy saves missing reward history | Preserve known v2 fields and current checkpoint reset behavior: restore the canonical map/spawn and saved Runner/dice state. Do not backfill source claims, synthesize claimed/unclaimed history, or infer claims from inventory/statistics. A midlevel pickup absent from v2 may reappear after restore, as it does today. Start source-scoped claims only for rewards actually observed and recorded after migration. | **Compatibility recommendation:** reappearance/re-award follows existing checkpoint semantics; the contract does not claim to know whether a source was collected before an old save. Any policy that suppresses or otherwise changes that behavior requires explicit approval. |
| Resume-link size and fallback | Keep old hashes unchanged. New compact payload includes only required IDs, quantities, and non-default item instance state. Recommend an 8 KiB maximum encoded URL; if exceeded, do not truncate/drop inventory. Offer a downloadable versioned resume bundle and retain local `#resume=1` as a same-browser option. | **Material:** portable resume may require a bundle for large inventories. Confirm limit against target browsers/hosting. |
| Spatial range/contact | Default distance metric Manhattan with inclusive integer min/max. `beside` means cardinal edge-adjacent; `contact` means same-cell overlap or shared edge; `on_top` means directly above and supported by the target; `above`/`below` are positional relations without support requirement. Diagonals require Chebyshev selection. | **Material:** changes attack/hazard reach. Confirm occupancy/overlap and whether “beside” should include diagonals. |
| Nested dice effects | FIFO child-action queue. Finish the parent action's mutations and event evaluation before applying child dice changes. Detect repeated `(ruleId, sourceInstanceId, action signature, dice snapshot)` in one root chain. Recommend at most 64 child actions per root action; if exceeded, stop enqueueing children, keep already committed mutations, and surface a diagnostic. Never silently truncate. | **Material at pathological limits:** a numeric budget and overflow behavior can affect intentionally long chains; approve or revise the proposed 64-action limit. |

Other material decisions include whether blocked interactions pay time, whether a level's rules can override global die maxima, which item IDs are equippable, and how current Snake/Lock behavior is scheduled relative to the new post-payment event pipeline.

## 8. Validation Requirements

### Registry and Capabilities

- Accept only the declared registry format/version; IDs are unique positive safe integers and `nextTileId` exceeds active/reserved IDs.
- Validate category against exactly the seven labels, but never infer capability from category/name/ID.
- Validate `capabilities` as an object. Unknown keys/properties round-trip unchanged.
- Validate collision modes, grid-shape restrictions, movement costs as nonnegative integers, and optional configured gravity/forced costs.
- Validate dice maximums as positive integers, including values above six; current die values must not exceed their configured maximum.
- Validate health, defense, damage amounts, rule references, distance bounds/metric, and transition targets with field-specific diagnostics.
- Validate item ID references resolve to catalog entries with an item capability. Stack quantities are positive integers; stateful instance data contains only permitted mutable fields. Statistics are not stored as inventory counts.
- Validate `item.onUse` as typed, supported action data; reject unknown executable action types instead of treating arbitrary fields as behavior.
- Validate `itemId` rewards, unique stable `rewardId`s per source definition, valid reward quantities, and source-scoped claim references.
- Validate SVG with the current sanitizer, preserve source artwork, and never derive collision from it.

### Maps, Rules, and Saves

- Require rectangular `cells`, `variants`, and `instanceIds` grids with identical dimensions; preserve null variants and IDs correctly.
- Require stable unique placement IDs in the declared scope for stateful/reward-capable cells; diagnose missing/duplicate IDs and migration-manifest conflicts.
- Validate rule IDs, integer priority, unique author order within scope, supported trigger/condition/action types, nonnegative integer action costs, valid Item/state references, and non-executable expressions.
- Verify each die event contains immutable before/after pairs, monotonically increasing sequence per action, unique event ID, root/parent action IDs, roll ID, operation, and value-change indicator.
- Validate current/after dice values are within configured maxima. A reroll operation must remain representable when before and after values match.
- Validate rule idempotency keys, per-action activation scope, and the independent per-attacker/per-player-roll guard.
- Decode old registry/map/save/link versions without changing their meaning; preserve unknown compatible properties through import/edit/export and migration round trips.
- Emit migration diagnostics for ambiguous variants, unknown cells, missing item references, missing reward history, and unprojectable legacy content. Do not silently drop data.

## 9. Phase 1 Acceptance Tests

Phase 1 is schema, validator, codec, and migration-preview work only, after this contract is approved. Its acceptance gate validates representations and compatibility; it must not execute gameplay rules, movement, inventory transactions, or editor workflows.

1. Registry v1 fixtures convert to the proposed v2 representation without changing existing IDs, role references, aliases, variants, SVG, or unknown properties; allocation metadata remains above every active/reserved ID.
2. All seven examples validate against one generic record contract. The schema accepts the same capability fields under any allowed category and preserves them if name/category metadata changes; this checks structural independence, not runtime interpretation.
3. Invalid categories, duplicate IDs, invalid capability shapes, negative/fractional movement costs, invalid dice maxima, unresolved Item-ID references, bad rule references, and malformed transitions produce precise validation errors.
4. Unknown fields at registry, tile, capability, map, rule, save, and item-instance levels survive schema decode/encode or editor-document round trips unchanged.
5. Numeric map v1 round-trips cells, variants, spawn, and metadata. Proposed map v2 round-trips cells, variants, instance IDs, spawn, and metadata; migration manifests produce stable representations on repeated conversion.
6. Inventory representations validate stack quantities, Item-ID references, optional per-item instance state, equipment references, and separation from player statistics. This is serialization/validation only; it does not execute item use.
7. Rule and event representations validate unique IDs, event sequence fields, immutable before/after snapshot shapes, action/parent IDs, source references, and same-value reroll records. Codec tests preserve supplied event ordering; they do not execute the dispatcher.
8. Legacy v2 save conversion preserves known fields and existing checkpoint reset semantics. It does not synthesize claimed/unclaimed placement history or infer claims from inventory. Old resume hash forms remain readable in compatibility fixtures.
9. Migration preview reports unknown legacy map codes and ambiguous Snake/Lock variants without writing source files. Existing `tiles2.json`, `levels.json`, legacy backups, and save formats remain byte-for-byte untouched by Phase 1 tests.

## 10. Phase 2 Engine Acceptance Tests (Not Part of Phase 1)

These tests require gameplay/runtime implementation approval and belong to the subsequent engine phase, not the Phase 1 schema-only gate.

1. A cost-3 spend from Die 1 = 2 and Die 2 = 4 with Die 1 selected actually yields `die1: 2->0`, then `die2: 4->3`, sequences 1 then 2, immutable snapshots `(0,4)` and `(0,3)`, and remaining time 3. Selecting Die 2 reverses actual debit order.
2. Every actual dice mutation from spending, receiving, item use, reroll, replacement, or event effect produces an observable event. A same-value reroll remains observable. Conditions read each event's immutable snapshot after the originating action's mutations; a multi-match consequence fires once per action/rule/source, and child dice actions wait until the parent batch finishes.
3. Item use preflight/commit is atomic: success consumes inventory and applies configured time/effects together before publishing ordered events; failure leaves inventory and dice unchanged and emits no committed `item_used`/`die_changed` event.
4. Automatic attack limits are keyed by attacker instance and player roll, and cannot be bypassed by multiple actions/events in that roll.
5. Nested dice effects process FIFO, preserve event snapshots, detect cycles, and report the approved queue-limit overflow without silently dropping work.
6. A voluntary early reroll while time remains discards both remaining pools, consumes one player roll under the existing roll-limit mechanic, and emits both per-die reroll events even if values are unchanged. Regression tests preserve existing roll-limit accounting, persistence, and death conditions. Damage and other consequences apply after their triggering action resolves and before the next player action. Configured maximum die values, gravity, and forced movement follow the defaults approved from Section 7.
7. Spatial detection uses only the authoritative rule trigger relation; no duplicate tile-level range can override it. Boundary and contact behavior match the approved spatial semantics.

## 11. Decisions Requested Before Phase 1

Approve or revise:

- Registry/map/save version names and boundaries, and whether Item IDs share the tile namespace as proposed.
- Capability vocabulary and common rule condition/action forms sufficient for the seven examples without special entity schemas.
- Gravity/forced movement action boundaries and when their rules evaluate.
- UUID placement identity, move/copy behavior, and migration-manifest scope.
- Priority direction and global author-order scope.
- Unknown legacy reward-history policy and accepted replay/loss tradeoff.
- Resume URL size/fallback behavior.
- Manhattan default, inclusive ranges, beside/contact/on-top definitions, and diagonal semantics.
- Event sequence/snapshot contract and the child-action queue limit/overflow policy (proposed default: 64 child actions per root action).

Until these are approved, this document remains a review proposal. Phase 1 and all gameplay/editor implementation remain unstarted.