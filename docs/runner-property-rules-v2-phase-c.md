# Property Rules 2.0: Phase C Studio authoring

The existing tile inspector supports both property-rule versions. Version 1 stays
version 1 until the author selects **Use version 2 features**. That explicit upgrade
adds typed property effects and comparison conditions without changing authored
array order, operands, or Entry Values defaults. There is no downgrade button.

Version 2 IF controls expose Numeric comparison, Property Exists, and Property
Does Not Exist. Entry Values is the default; Current Values reads preceding effects.
Each IF is evaluated once before its block. Existence checks distinguish missing
from acquired zero. Numeric comparisons against missing properties fail.

THEN controls support Property Set/Add/Subtract, Lose Hearts, Narrative Event
(plain text), and Achievement (ID/title/optional body). Changing a type deliberately
replaces that effect's fields; merely opening a tile never changes its JSON.
Unknown fields, future versions, unsupported operations, and unsupported structures
remain read-only with preserved JSON. Repairable known fields expose inline errors;
Save remains blocked by the existing validator while a document is invalid.

Every block and effect retains its execution number and accessible Move Up/Move
Down buttons. These update the array order and visual controls immediately,
preserving fields regardless of effect type. Keyboard focus follows the moved
item's ordering buttons. Duplication, deletion and all version 1 controls remain.

## Preview

Version 1 retains its property-only preview. Version 2 uses the same evaluator's
sequential iterator with simulated native acknowledgements. Narrative and
achievement simulation reuse existing narrative actions/progression helpers.
Health simulation models the numeric result only; real damage, death handling,
logging, saves and achievement delivery are never called from Studio previews.

Choose acquired/missing sample properties, sample hearts, and optionally previously
unlocked achievement IDs (comma-separated). The results include ordered block and
effect records, simulated health, narrative/achievement descriptions, and terminal
stopping. Acquired zero remains visible. **Use result for next entry** carries
sample properties, health, and unlocks into another preview. Each Run preview
otherwise starts from the displayed samples. A terminal result cannot be carried
forward as a living Runner. Sample changes never mark authored tile JSON dirty.

## Manual Studio check

1. Open Studio, choose Tile Catalog, create a scratch tile through New Tile, and
   expand Properties → Capabilities → Property Rules. Add its override if absent.
2. Select **Use version 2 features**. Add Block 1, leave IF off, and set its first
   effect to Property/Add with an arbitrary ID such as `charge_x` and value `1`.
3. Add Block 2. Enable IF; select Numeric comparison, Current Values, `charge_x`,
   `>=`, and `3`.
4. Set Block 2 Effect 1 to Property/Set `charge_x` to `0`. Add Effect 2, select
   Lose Hearts, amount `1`. Add Effect 3 as Achievement with a unique ID and title.
   Add Effect 4 as Narrative Event with authored plain text.
5. Preview acquired `charge_x = 2` and sample hearts `3`. Expect `charge_x = 0`,
   hearts `2`, a simulated unlock and narrative. Use the result for the next entry,
   set sample charge to `2`, and preview again: the unlock is already acquired.
6. Set sample hearts to `1`. Reset-before-damage leaves charge at `0` on simulated
   death and stops later effects. Move damage above reset and run again: charge
   remains `3`. Move the conditional block above the increment to see the threshold
   no longer qualify for an entry starting at charge `2`.
7. Exercise both existence condition types with the acquired checkbox unchecked,
   then checked at zero. Check inline errors by entering zero heart loss or blank
   required narrative/achievement text; invalid changes cannot overwrite a saved
   valid catalog.
8. Save the scratch catalog to a chosen file, reopen it, and verify exact mixed
   order. Export/import it and compare order again. On a tile variant, override
   inherited rules, reorder them, save/reopen, then remove the override to restore
   the base rule order. Existing artwork and encounter JSON remain intact.

No gameplay, save-format, schema, production-catalog or level changes are included.
Future native effects and broad Studio layout changes remain outside this phase.
