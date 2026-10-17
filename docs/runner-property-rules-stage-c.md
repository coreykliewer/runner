# Runner Property Rules 1.0 — Stage C visual authoring

Baseline: `d3154ef`. Studio now visually edits the existing `propertyRules.version = 1`
contract. No gameplay mechanics, production tiles, levels, save formats, or
encounter-rule semantics change in this milestone.

## Inspector and execution order

Select a base tile or variant, expand **Capabilities**, and find **Property Rules**.
Choose **Add override** for a base tile without rules. The initial empty block list
is a valid no-op. Add blocks, optionally enable IF, then enter property IDs,
comparisons and numeric operands. Each block must contain at least one THEN effect.
The final effect's Delete button is disabled; delete its block to remove it.

Blocks and effects each have explicitly numbered positions, Duplicate/Delete
controls, and accessible Up/Down buttons. Their array order is the saved execution
order. There is no drag-and-drop dependency. All six comparisons and Set, Add,
Subtract come from the Stage A contract. Fractional and negative operands are
supported; the evaluator clamps each resulting property value to zero.

The inspector explains the Stage B trigger: every successful grid-cell entry,
including walking, jumps, gravity, turbo and forced movement. Spawn, resume,
blocked movement and stationary dice changes are not entries. Every IF reads the
same entry snapshot; effects operate top to bottom on working values.

Property ID fields are searchable native datalist inputs. Suggestions are discovered
from the loaded numeric catalog's authored base/variant tile JSON, plus the current
draft. They are suggestions, not a catalog of allowed IDs. Any new Stage A-valid
property ID can be authored. IDs remain case-sensitive.

## Validation and preservation

The visual editor calls the Stage A validator for inline field errors and marks
invalid controls with `aria-invalid` and associated error text. Typed empty numeric
fields remain invalid drafts rather than silently becoming zero. The existing
catalog validation path also validates base and variant property-rule documents,
so Save cannot overwrite a valid file with an invalid draft. Correct the fields
and save again. Export retains the existing ability to preserve an invalid draft.

Unsupported versions, operations, comparison forms, structures or unknown fields
make the property-rule form read-only. Original JSON remains available in an
explicit preserved-JSON disclosure and survives export without reconstruction.
Imported numeric strings are not silently converted into numbers. Supported field
errors such as invalid IDs or cleared numbers can be repaired in place.

The existing tile-property commit path preserves SVG, numeric IDs, variants,
encounter definitions and other unknown tile fields. Property Rules are registered
as one additional capability, so existing tile duplication/copy and validation
continue to use their established paths. No production documents are rewritten on
opening the inspector.

## Variants

A variant without its own `propertyRules` inherits the complete base document.
Inherited rules are visible in a disabled builder and can be previewed. Choose
**Override inherited value** to clone and edit the inherited document independently.
**Remove override** deletes only the variant's override and restores inheritance.
An explicit empty block list overrides the base with no effects; it is different
from removing the override. Base and variant blocks are not concatenated.

## One-entry preview

**Test tile entry** uses `evaluatePropertyRules()` directly. It does not contain
another interpreter, call gameplay handlers, or modify the authored tile.

Preview sample rows support arbitrary property IDs and numeric values. An unchecked
**Acquired** box means missing; a checked box with value 0 means acquired zero.
Property IDs referenced by rules receive initial missing sample rows automatically.
Additional unrelated sample properties can be added, and duplicate/invalid samples
are rejected before preview application.

**Run preview** displays a Before entry / After entry table, block match results,
and ordered effect changes including clamping. Missing properties are labeled
**Missing**, rather than displayed as zero. Changes to rules or samples invalidate
the previous preview. Sample edits and previews do not dirty or save the tile.

## Manual acceptance walkthrough

1. Run `npm run dev` and open `http://localhost:8000/editor.html`. Work in a copy of
   the catalog or a new numeric catalog; export to a new filename instead of
   overwriting production content.
2. Create Water, Air and Fire test tiles. Expand Capabilities → Property Rules →
   Add override on each. Create these blocks visually:
   - Water: unconditional Set `wet` to 5.
   - Air: IF `wet > 0`, THEN Subtract 1 from `wet`.
   - Fire block 1: unconditional Set `burning` to 1.
   - Fire block 2: IF `wet >= 2`, THEN Subtract 1 from `burning`, then Subtract 2
     from `wet`.
3. Preview Fire with `wet` acquired at 1: final `wet = 1`, `burning = 1`. At 2,
   final `wet = 0`, `burning = 0`. Uncheck wet to see Missing; check it at 0 to see
   Acquired: 0. There is no partial protection at 1.
4. Move Fire's conditional block above its unconditional block, preview at wet 2,
   and observe final burning 1. Reorder effects with Up/Down, duplicate/delete a
   block or effect, then save/export, reopen/import and confirm the exact order.
5. Enter an invalid ID with spaces or clear a numeric operand. Check its inline
   error and blocked Save, then correct it. Verify the previously saved file is
   unchanged until a valid save occurs.
6. Select a tile variant. Preview inherited rules, override and edit them, then
   remove the override and verify that the base rules reappear. Existing artwork
   and encounter fields should remain intact.

## Boundaries

The preview evaluates one entry rather than a complete level or movement/gravity
sequence. It does not preview native damage/death, replay guards, dice consequences
or interactions with encounters. Native browser datalist presentation varies.
Unsupported future JSON requires source editing/import rather than a lossy form.
The current Stage A grammar and numeric limitations remain unchanged. This milestone
does not migrate production content or redesign Studio.

Verification passed: **26 focused unit tests**, **6 focused browser tests**, and a
fresh `npm run check` with **166 unit tests, 2 smoke tests, 106 browser tests**.
The final exported staged snapshot independently passed the focused unit and
browser checks without the excluded uncommitted files. Staged whitespace checks
passed. Visual review confirmed the missing/acquired preview table. A real-keystroke
regression verifies that unfinished property IDs do not create partial-name sample
rows; sample rows synchronize when the property field is completed.
