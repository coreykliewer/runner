# Property Rules 2.0: Phase B checkpoint and replay policy

Safety review before adapter implementation: ordinary checkpoints suppress writes
during roll transactions and catch storage errors. Native entry effects must use
a strict checkpoint that bypasses that suppression and propagates write failure.

Before each native call, persist the consumed run ID/entry sequence, preceding
property prefix, and pending effect identity. A failed pre-action write prevents
the native call. After success, persist resulting Runner state and effect status
before advancing. Lethal damage uses the existing death handler and its checkpoint;
the entry guard and reset preceding the damage are already committed at that point.

If a handler throws after a possible side effect, stop the sequence, preserve
preceding state and any native changes already made, and checkpoint an uncertain
outcome with diagnostics. Do not retry. An expected terminal acknowledgement is
distinct from an exception, even if the exception happened during lethal damage.
If the post-action write fails, the previous durable pending marker still consumes
the entry. Restore converts pending to uncertain and never resumes that sequence.

This provides at-most-once native attempts per consumed entry, not a distributed
transaction with exactly-once visible delivery. A crash after the action but before
the post-action write can lose its latest state/log output. A log cannot be reliably
replayed without risking duplicate delivery. Storage failure diagnostics remain in
the development trace and memory when persistence itself is unavailable. Save links
carry the same entry guard and outcome metadata; achievement IDs remain one-time
unlocks through the existing progression mechanism.

The sequence is driven by the Phase A iterator inside the existing tile-entry
dispatcher effect. It does not add another evaluator or dispatcher. Version 1 keeps
its existing integration. Native effects do not consume encounter attack guards.
Narrative instructions deliver authored plain text through existing narrative
actions and logging, once per legitimate entry; they do not introduce independent
named narrative definitions. Re-entry is a new event and may narrate again.
