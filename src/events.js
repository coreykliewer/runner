import { addXp, setStoryFlag, unlockAchievement } from "./progression.js";

export function runNarrativeEvents(events, context, state) {
  const actions = [];
  let nextState = state;

  for (const event of events || []) {
    if (!eventMatches(event, context, nextState)) continue;

    for (const action of event.actions || []) {
      const result = applyNarrativeAction(action, nextState);
      nextState = result.state;
      if (result.output) actions.push({ eventId: event.id, ...result.output });
    }

    if (event.once) {
      nextState = markEventSeen(nextState, event.id);
    }
  }

  return { state: nextState, actions };
}

export function eventMatches(event, context, state) {
  if (!event || !event.trigger) return false;
  if (event.once && hasEventBeenSeen(state, event.id)) return false;

  const trigger = event.trigger;
  if (trigger.type && trigger.type !== context.type) return false;
  if (trigger.level && trigger.level !== context.level) return false;
  if (trigger.tile && trigger.tile !== context.tile) return false;
  if (trigger.variant && trigger.variant !== context.variant) return false;
  if (trigger.pickupType && trigger.pickupType !== context.pickupType) return false;

  if (trigger.storyFlag) {
    const current = state.runner?.storyFlags?.[trigger.storyFlag];
    if (current !== trigger.value) return false;
  }

  return true;
}

export function applyNarrativeAction(action, state) {
  if (!action || !action.type) return { state };

  if (action.type === "message") {
    return {
      state,
      output: {
        type: "message",
        text: action.text || "",
        html: action.html === true
      }
    };
  }

  if (action.type === "xp") {
    return { state: addXp(state, action.amount || 0) };
  }

  if (action.type === "achievement") {
    return {
      state: unlockAchievement(state, action),
      output: {
        type: "achievement",
        title: action.title || action.id || "Achievement unlocked",
        body: action.body || action.message || ""
      }
    };
  }

  if (action.type === "story_flag") {
    return { state: setStoryFlag(state, action.flag, action.value) };
  }

  return { state };
}

export function hasEventBeenSeen(state, id) {
  return (state.world?.narrativeEventsSeen || []).includes(id);
}

export function markEventSeen(state, id) {
  if (!id || hasEventBeenSeen(state, id)) return state;

  return {
    ...state,
    world: {
      ...state.world,
      narrativeEventsSeen: [...(state.world?.narrativeEventsSeen || []), id]
    }
  };
}
