import { createPropertyRuleExecution } from "../propertyRules.js";
import { applyNarrativeAction } from "../events.js";

// Studio-only simulation. No gameplay adapters, storage, logs or Runner objects.
export function previewPropertyRuleEntry(rules, properties, { hearts = 3, achievements = [] } = {}) {
  let state = { runner: { hearts, achievements: JSON.parse(JSON.stringify(achievements)) }, world: {} };
  const native = [];
  if (!Number.isFinite(hearts) || hearts <= 0) return { simulated: true,
    evaluation: { ok: false, diagnostics: [{ path: "sample.hearts", message: "Sample hearts must be a positive finite number." }] } };
  const execution = createPropertyRuleExecution(rules, properties);
  let step = execution.next();
  while (!step.done) {
    const request = step.value.effect;
    const effect = request.effect;
    let description;
    if (effect.type === "lose_hearts") {
      // Simulate only the native numeric health change; real damage remains in takeDamage().
      const before = state.runner.hearts;
      state = { ...state, runner: { ...state.runner, hearts: before - effect.amount } };
      description = `Lose ${effect.amount} hearts: ${before} → ${state.runner.hearts}`;
    } else {
      const before = state;
      state = applyNarrativeAction(effect.type === "narrative"
        ? { type: "message", text: effect.text, html: false } : effect, state).state;
      description = effect.type === "narrative" ? `Narrative: ${effect.text}`
        : state === before ? `Achievement already unlocked: ${effect.title}` : `Unlock achievement: ${effect.title}`;
    }
    const terminal = state.runner.hearts <= 0;
    native.push({ effectKey: request.effectKey, description, terminal });
    step = execution.next({ status: terminal ? "terminal" : "applied" });
  }
  return { simulated: true, evaluation: step.value, hearts: state.runner.hearts,
    achievements: state.runner.achievements, native };
}
