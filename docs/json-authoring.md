# Runner JSON Authoring Guide

This guide explains the three main JSON files in plain language:

- `tiles2.json` defines what each tile is and what it does.
- `levels.json` defines the playable maps and how exits connect them.
- `achievements.json` defines achievements, tutorial nudges, and stat rewards.

The big idea is: gameplay code should provide facts, and JSON should describe content and rules.

## Quick Mental Model

A map is made of one-character tile codes.

For example:

- `P` means stone platform.
- `W` means water.
- `D` means diamond.
- `E` means exit.
- `R` means runner starting position.

`tiles2.json` explains what those letters mean. `levels.json` places those letters into maps. `achievements.json` watches runner facts like movement, counters, stats, XP, pickups, and damage.

## `tiles2.json`

`tiles2.json` is the tile catalog.

Each top-level key is one tile code:

```json
{
  "W": {
    "solid": false,
    "gravity": false,
    "tags": ["water"],
    "grantStats": {
      "in_water": 1
    },
    "moveCost": 1,
    "insideMoveCost": 1,
    "hint": "It's dungeon water."
  }
}
```

### Common Tile Fields

`solid`
: Whether the runner can pass through the tile. Walls, floors, locks, monsters, and spikes are usually solid.

`gravity`
: Whether gravity applies inside that tile. Water has `gravity: false`, so it behaves differently from air.

`moveCost`
: How many movement points it costs to move onto or across this tile in normal cases.

`insideMoveCost`
: How many movement points it costs when moving while already inside a fluid-like tile.

`tags`
: Labels for generic systems. For example, water has `"tags": ["water"]`. Moving through a tagged tile can increment generic counters like `move_in_water`.

`grantStats`
: Stats granted directly when the runner enters or interacts with that tile. Example: water grants `in_water`.

`pickupType`
: Marks a pickup tile. Current examples include `diamond`, `turbo`, `heart`, and `dead`.

`effects`
: Generic pickup-style effects. Supported effect types are `counter`, `xp`, `heart`, `score`, `message`, and `setFlag`.

`insideDamage`
: Damage taken while inside the tile. Lava uses this kind of idea.

`topDamage`
: Damage taken from standing on or landing on top of the tile. Spikes use this kind of idea.

`fallDamageThreshold`
: How far the runner must fall before this tile causes fall damage on landing.

`fallDamageMultiplier`
: How much fall damage the landing tile causes.

`fallDamageCancel`
: If true, landing here cancels fall damage. Fluids usually cancel fall damage.

`exit`
: If true, this tile is an exit/portal.

`hint`
: Text shown when inspecting or interacting with the tile.

`svg`
: The tile image as inline SVG.

### Pickups

A simple pickup looks like this:

```json
{
  "D": {
    "solid": false,
    "gravity": true,
    "pickupType": "diamond",
    "moveCost": 1,
    "deathMessage": "My precious!<br> +1 Diamond"
  }
}
```

The current code has built-in behavior for known pickup types:

- `diamond` increases score.
- `turbo` turns on turbo.
- `heart` increases hearts.
- `dead` increases kills.

For more generic behavior, use `effects`.

Example:

```json
{
  "effects": [
    { "type": "xp", "amount": 5 },
    { "type": "setFlag", "flag": "found_secret_room" },
    { "type": "message", "text": "You found something strange." }
  ]
}
```

### Stats From Tiles

Use `grantStats` when entering a tile should increase a runner stat.

Example:

```json
{
  "W": {
    "tags": ["water"],
    "grantStats": {
      "in_water": 1
    }
  }
}
```

This means every time the runner enters water, their `in_water` stat increases by 1.

### Variants

Some tiles can have variants. In a map, variants are written with braces:

```text
E{a}
```

That means: exit tile `E`, variant `a`.

Variants let one tile type behave differently in different places. Examples include:

- different exits: `E{a}`, `E{b}`
- different signs: `I{a}`, `I{b}`
- different locks: `K{a}`, `K{b}`
- different monsters: `M{a}`, `M{b}`

Variant names should be simple sanitized strings: letters, numbers, underscores, and similar safe identifiers.

## `levels.json`

`levels.json` is the level list.

Example:

```json
{
  "schemaVersion": 1,
  "defaultLevel": "default",
  "levels": {
    "default": {
      "id": "default",
      "name": "Dungeon Entrance",
      "map": "P2A1P22~...",
      "exits": {
        "a": "a",
        "b": "b"
      },
      "narrative": ["level1_intro"]
    }
  }
}
```

### Level Fields

`id`
: The level id. It should match the key in the `levels` object.

`name`
: Human-readable level name.

`map`
: The encoded map string.

`exits`
: Which exit variants lead to which level ids.

`narrative`
: Narrative event ids associated with the level.

### Exits

If the map contains `E{a}`, the game looks for exit variant `a`.

In `levels.json`, this means:

```json
"exits": {
  "a": "waterworks"
}
```

So stepping on `E{a}` sends the runner to level `waterworks`.

If an exit has no variant, it uses `default`.

## Map Strings

Maps are compressed strings.

Rows are separated by `~`.

Numbers mean repeat the previous tile code.

Example:

```text
P3A2D1
```

Means:

```text
P P P A A D
```

Variants use braces:

```text
E{a}1
```

Means one exit tile with variant `a`.

The current standard map size is 25 columns by 15 rows.

## `achievements.json`

`achievements.json` defines achievements and tutorial messages.

Example:

```json
{
  "id": "first_diamond",
  "title": "You found your first diamond.",
  "body": "The dungeon notices shiny habits.",
  "when": {
    "stat": "score",
    "atLeast": 1
  },
  "grantStats": {
    "diamond": 1
  }
}
```

### Achievement Fields

`id`
: Unique id. Do not reuse ids.

`title`
: Bold achievement title shown to the player.

`body`
: Regular message text shown below the title.

`when`
: The condition that unlocks the achievement.

`grantStats`
: Stats granted when the achievement unlocks for the first time.

## Counters vs Stats

This distinction matters.

`runner.counters`
: What the runner has done. Examples: moved right, jumped, rolled dice, moved through water.

`runner.stats`
: What the runner has earned or become. Achievements and tiles can grant stats.

Example:

- Counter: `dice_roll: 10` means the runner has rolled dice 10 times.
- Stat: `dice_master: 1` means the runner earned a dice-related accomplishment.

Achievements usually watch counters or live values, then grant stats.

## Simple Achievement Conditions

Use this format when watching a stat or counter:

```json
{
  "when": {
    "stat": "jump",
    "atLeast": 1
  }
}
```

Supported comparisons:

- `atLeast`
- `lessThan`
- `equals`

Examples:

```json
{ "stat": "score", "atLeast": 1 }
{ "stat": "dice_roll", "atLeast": 10 }
{ "stat": "hearts", "lessThan": 2 }
```

## Live Value Conditions

Achievements can also compare one live value to another live value.

Example:

```json
{
  "when": {
    "left": "movementPoints",
    "operator": "lessThan",
    "right": "target.moveCost"
  }
}
```

This means: unlock when the runner's available movement points are less than the target tile's movement cost.

Supported operators:

- `lessThan`
- `atMost`
- `equals`
- `notEquals`
- `greaterThan`
- `atLeast`

Use `{ "literal": value }` when the right side should be a fixed value:

```json
{
  "left": "damage.amount",
  "operator": "greaterThan",
  "right": { "literal": 0 }
}
```

## Combining Conditions

Use `all` when every condition must be true.

Example: the roll-before-moving tutorial achievement.

```json
{
  "id": "roll_before_moving",
  "title": "Roll before you move.",
  "body": "Movement comes from the dice. Roll first, then spend those points to move.",
  "when": {
    "all": [
      {
        "left": "movement.attempted",
        "operator": "equals",
        "right": { "literal": true }
      },
      {
        "left": "movementPoints",
        "operator": "lessThan",
        "right": "target.moveCost"
      },
      {
        "left": "dice.rollCount",
        "operator": "equals",
        "right": { "literal": 0 }
      }
    ]
  }
}
```

Use `any` when at least one condition must be true.

```json
{
  "when": {
    "any": [
      { "stat": "left", "atLeast": 1 },
      { "stat": "right", "atLeast": 1 }
    ]
  }
}
```

## Common Live Values

These are examples of values achievements can read when the game provides that context:

`movementPoints`
: Current available movement points.

`target.moveCost`
: Movement cost of the tile the runner is trying to enter.

`movement.attempted`
: True when the runner attempted movement.

`movement.diagonal`
: True when the movement attempt is diagonal.

`dice.rollCount`
: How many times the player has rolled.

`pickup.type`
: Pickup type, such as `diamond`, `turbo`, or `heart`.

`landing.type`
: Landing type, such as `fall`.

`landing.fallDistance`
: How far the runner fell before landing.

`damage.amount`
: Amount of damage taken.

`damage.source`
: Source of damage, such as `fall`.

`runner`
: Top-level runner values.

`counters`
: Runner counters.

`stats`
: Runner stats.

`storyFlags`
: Story flags.

## Current Movement Achievements

The project currently treats these as different things:

`jump`
: Any upward jump.

`diagonal_jump`
: A jump that moves up and sideways.

`double_jump`
: A vertical jump using the second jump credit.

This is intentional. Diagonal jump is about direction. Double jump is about using the second jump.

## Adding A New Achievement

1. Pick a unique `id`.
2. Write a clear `title`.
3. Write a short `body`.
4. Decide what condition should unlock it.
5. Optionally add `grantStats`.
6. Run validation/tests.

Example:

```json
{
  "id": "first_diagonal_jump",
  "title": "You jumped diagonally.",
  "body": "A little sideways, a little upward.",
  "when": {
    "stat": "diagonal_jump",
    "atLeast": 1
  },
  "grantStats": {
    "diagonal_jump": 1
  }
}
```

## Adding A New Tile

1. Choose a one-character code.
2. Add it to `tiles2.json`.
3. Decide whether it is solid.
4. Decide whether gravity applies.
5. Set movement cost.
6. Add damage, pickup, effects, tags, or stat grants if needed.
7. Add the tile to a map in `levels.json` or with the editor.

Example:

```json
{
  "Q": {
    "solid": false,
    "gravity": true,
    "moveCost": 1,
    "pickupType": "diamond",
    "hint": "A strange shiny thing."
  }
}
```

## Important Rules To Preserve

- Do not hardcode tile ids into achievement logic.
- Do not create special-purpose counters when the game already knows the value.
- Use `tiles2.json` as the source of truth for tile behavior like `moveCost`.
- Use `levels.json` as the source of truth for maps and exit routing.
- Use `achievements.json` as the source of truth for achievement conditions and stat rewards.
- Keep counters and stats separate.
- Let gameplay provide context; let achievement JSON describe the rule.

