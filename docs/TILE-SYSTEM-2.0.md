# Runner Tile System 2.0: Approved Design

**Status:** Approved design decisions; not an implementation specification.

This document records the approved direction for the Runner Tile System 2.0 redesign. It does not authorize implementation. The architecture audit in [TILE-SYSTEM-2.0-AUDIT.md](TILE-SYSTEM-2.0-AUDIT.md) describes current compatibility and proposes implementation options; proposals there are not approved by this document.

## Checkpoint 1: Foundations

- Runner is a roll-and-write, 2D side-scrolling dungeon crawler.
- The two dice are independently spendable pools of time.
- The selected die determines where movement spending begins.
- Items, abilities, and events may modify dice and time.

## Checkpoint 2: Spatial System

- Gameplay uses grid-based position and collision.
- SVG artwork is visual and does not determine collision.
- Spatial relationships include inside, above, on top, below, beside, contact, and configurable distance.

## Checkpoint 3: Movement

- Blocked movement costs no time by default.
- Gravity and forced movement are free unless configured.
- Movement costs may combine both dice.
- Movement costs are nonnegative whole numbers.

## Checkpoint 4: Dice and Time

- Spend from the selected die first, then the other die.
- Dice maximums are configurable and may exceed six.
- Movement-triggered encounters evaluate after movement and time payment.
- Both dice exhausted requires a new player roll.
- Voluntary early rerolls are allowed while unused time remains. A reroll discards the remaining time on both dice, replaces both die values, and consumes exactly one player roll under the existing roll-limit mechanic.
- Each die emits an observable reroll event, including when its resulting numeric value is unchanged. Existing roll-limit behavior, persistence, and death conditions are preserved.

## Checkpoint 5: Combat

- Attacks use Runner's current remaining dice by default.
- Automatic attacks occur at most once per attacker instance per player roll by default.
- Damage applies immediately after the triggering action resolves.
- Runner attacks using current dice and configurable conditions.
- Independent enemy rolls remain an optional advanced capability.

## Checkpoint 6: Inventory

- Items are collected automatically upon entering their cells by default.
- Item use costs zero time by default, configurable per item.
- Inventory is unlimited by default, with optional limits.
- Items persist between levels by default, with exceptions.
- Item rewards reference reusable catalog definitions.

## Checkpoint 7: States and Events

- Custom named states with optional templates.
- Placed-instance states persist within the current level, including save and resume.
- Rewards activate once per placed instance by default.
- Simultaneous rules execute by priority, then author-defined order.

## Checkpoint 8: Tile Builder Interface

- The seven categories are Environment, Items, Creatures, Mechanisms, Hazards, Interactables, and Effects.
- Categories organize the catalog but do not restrict capabilities.
- Any tile can use any combination of capabilities.
- Gameplay capabilities must not be selected by tile name, category, or numeric ID.
- The layout is Catalog and Inspector, with an expandable Rule Builder.
- Show only enabled capabilities.
- Preserve guided tile creation.
- Use a focused editor for complex rules.
- Preserve SVG thumbnails and editing without a large Artwork Preview.

## Checkpoint 9: Dice Events, Inventory, and Reward Identity

- Every change to either die is observable as a gameplay event and can trigger conditions. This includes time spending or receipt, item use, rerolls, value replacement, and other configured dice modifications. Encounter evaluation is not limited to completed movement.
- A reroll action emits an observable event even if either die's resulting numeric value is unchanged.
- Spending always starts with the selected die. If that die cannot cover the full cost, spend its remaining points, then spend the rest from the other die. For Die 1 = 2, Die 2 = 4, Die 1 selected, and cost = 3, Die 1 changes 2 to 0, then Die 2 changes 4 to 3; remaining time is 3.
- Dice-change events follow the actual mutation order. A spend uses selected die first and then the other die; other multi-die actions use their explicitly deterministic action order. Each actual die change emits an event with a unique event ID, shared action/transaction ID, sequence number, changed die, before/after values, and an immutable snapshot of both dice immediately after that change.
- The dispatcher records all die-change events caused by an action before dispatching consequences, then evaluates their conditions in event-sequence order against each event's immutable dice snapshot, not the later live dice values. A reroll event is also evaluated against its final snapshot, even when the numeric values are unchanged.
- A rule consequence is applied at most once per action, rule, and source instance, even if the rule matches multiple events from that action; the first matching event in sequence claims that consequence. Consequence-triggered dice modifications are queued as subsequent actions, not interleaved into the originating action's mutation sequence. Event identity and the action/rule/source key make processing idempotent.
- Automatic attacks retain the stricter approved limit of at most once per attacker instance per player roll, across separate actions and all dice-change events.
- Inventory is structured internal data referencing numeric catalog Item IDs. It supports quantities for stackable items and individual instance records when durability, charges, or other instance-specific state is needed.
- Player statistics are separate from inventory quantities. Inventory records reference item definitions and do not duplicate an item's name or gameplay behavior.
- Inventory may use compact serialization in resume links where useful.
- One-time rewards are tracked by stable placed-instance identity or an equivalent scoped marker. Possessing an Item ID does not establish that a particular chest or other source has already been collected; multiple sources may award the same Item ID.
- The seven tile categories remain catalog metadata only. Every gameplay capability remains available regardless of tile name, category, or numeric ID.

## Boundaries and Open Questions

The decisions above define the approved product direction, not every data field or runtime algorithm. In particular, they do not yet specify:

- The exact meanings and coordinate conventions for each spatial relationship, or how configurable distance is measured.
- The exact event type names and how action-defined ordering for non-spending multi-die changes is represented in the eventual schema. Per-change conditions, per-action consequence deduplication, queued consequence actions, and attack-per-roll limits are defined above.
- Whether all player-triggered combat interactions count as encounters for the post-payment timing rule.
- The stable identity scheme for placed instances across map edits, copies, level resets, and save migration.
- How legacy saves without placed-instance reward state are migrated when prior midlevel collection cannot be recovered.
- The named-state/template data model, state transition semantics, or the scope of reward-once ledgers.
- How rule priority values are assigned or tie-broken beyond the approved priority-then-author-order sequence.
- The compact resume-link encoding and size policy for inventory, if compact serialization is used.
- The capability vocabulary, JSON schema/version, or migration representation.

These are design and architecture questions for review. No additional mechanics should be treated as approved by implication. Tile names, catalog categories, and numeric IDs are organizational/identity data and must not be used as gameplay dispatch rules.