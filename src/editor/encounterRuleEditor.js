import {
  ENCOUNTER_CONDITION_TYPES,
  ENCOUNTER_DISTANCE_MODES,
  ENCOUNTER_POSITIONS,
  ENCOUNTER_REPEAT_MODES,
  ENCOUNTER_RESOLUTIONS,
  createDefaultEncounterRule,
  createDefaultEncounterRules,
  encounterConditionMatches,
  evaluateEncounterExpression,
  inferEncounterExpressionType,
  validateEncounterRules
} from "../encounterRules.js";

const CONDITION_LABELS = {
  sum_comparison: "Combined dice value",
  parity: "Dice parity",
  exact_dice: "Exact dice",
  expression: "Expression"
};

const DISTANCE_LABELS = { manhattan: "Orthogonal", chebyshev: "Diagonal-inclusive" };
const POSITION_LABELS = {
  any: "Any side",
  player_above: "Player directly above",
  player_below: "Player directly below",
  player_left: "Player directly left",
  player_right: "Player directly right"
};

const EVENT_LABELS = { after_move: "after movement", after_roll: "after dice roll",
  dice_changed: "when dice change (runtime only)", turn_ended: "when the turn ends (runtime only)" };

function readOnlyReason(rule) {
  if (rule.trigger.events.some(event => !["after_move", "after_roll"].includes(event))) return "This event has no Studio controls.";
  const unknown = (value, keys) => Object.keys(value).some(key => !keys.includes(key));
  if (unknown(rule, ["id", "order", "priority", "activation", "trigger", "conditions", "actions"]) ||
      unknown(rule.trigger, ["events", "minDistance", "maxDistance", "distance", "position", "repeat"]) ||
      rule.conditions.some(condition => unknown(condition, Object.keys(defaultCondition(condition.type)))) ||
      rule.actions.some(action => unknown(action, ["type", "amount", "amountExpression", "message"]))) {
    return "This rule contains fields Studio cannot safely edit.";
  }
  return null;
}

function preservedJson(value, reason) {
  const panel = document.createElement("div");
  panel.className = "encounter-preserved";
  const message = document.createElement("p");
  message.textContent = `${reason} Read-only: original JSON is preserved. Edit the source JSON to change this data.`;
  const details = document.createElement("details");
  const heading = document.createElement("summary");
  heading.textContent = "Preserved encounter JSON";
  const json = document.createElement("pre");
  json.textContent = JSON.stringify(value, null, 2);
  details.append(heading, json);
  panel.append(message, details);
  return panel;
}

export function renderEncounterRuleEditor(container, { value, onChange = () => {} } = {}) {
  let state = clone(value === undefined ? createDefaultEncounterRules() : value);

  const commit = (mutate, render = false) => {
    const next = clone(state);
    mutate(next);
    state = next;
    onChange(clone(state), render);
    if (render) draw();
  };

  const draw = () => {
    container.replaceChildren();
    const root = document.createElement("div");
    root.className = "encounter-rule-editor";
    const help = document.createElement("p");
    help.className = "encounter-rule-help";
    help.textContent = "Studio edits after-movement and after-roll damage rules. Runtime-only settings: turn_ended, dice_changed, priorities and activation settings. These are preserved; lifecycle rules are read-only here. Gameplay uses priority and attacker guards, not the stored match-policy selector. Automatic damage remains limited per attacker per roll regardless of the authored repeat setting. Test Dice checks conditions and damage only, not timing, spatial eligibility or attack guards.";
    root.append(help);
    let issues;
    try { issues = validateEncounterRules(state); }
    catch { issues = [{ message: "Malformed encounter structure." }]; }
    if (issues.length) {
      root.append(preservedJson(state, `Invalid or unrecognized encounter data: ${issues.map(issue => issue.message).join(" ")}`));
      if (Array.isArray(state?.rules)) {
        for (const rule of state.rules) {
          const summary = document.createElement("p");
          summary.className = "encounter-rule-summary";
          summary.textContent = summarizeRule(rule);
          root.append(summary);
        }
      }
      container.append(root);
      return;
    }
    const enabled = checkbox("Enable encounter rules", state.enabled === true);
    enabled.addEventListener("change", () => commit(next => { next.enabled = enabled.checked; }));
    root.append(fieldRow("Run these rules", enabled));

    const resolution = selectControl("Stored match policy (read-only)", state.resolution, ENCOUNTER_RESOLUTIONS.map(value => [
      value,
      value === "all_matches" ? "Run all matching rules" : "Run first matching rule per tile"
    ]), () => {});
    resolution.querySelector("select").disabled = true;
    root.append(resolution);

    const rules = document.createElement("div");
    rules.className = "encounter-rule-list";
    const orderedRules = state.rules.slice().sort((left, right) => left.order - right.order);
    orderedRules.forEach((rule, index) => rules.append(renderRule(rule, index, orderedRules.length)));
    root.append(rules);

    const addRule = button("Add rule", "+ Add Rule");
    addRule.addEventListener("click", () => commit(next => {
      const maximumOrder = next.rules.reduce((maximum, rule) => Math.max(maximum, Number(rule.order) || 0), 0);
      let serial = maximumOrder + 1;
      const existingIds = new Set(next.rules.map(rule => rule.id));
      let id = `rule-${serial}`;
      while (existingIds.has(id)) id = `rule-${++serial}`;
      next.rules.push(createDefaultEncounterRule(maximumOrder + 1));
      next.rules.at(-1).id = id;
    }, true));
    root.append(addRule);
    container.append(root);
  };

  function renderRule(rule, index, count) {
    const card = document.createElement("section");
    card.className = "encounter-rule-card";
    const heading = document.createElement("div");
    heading.className = "encounter-rule-heading";
    const title = document.createElement("h4");
    title.textContent = `Rule ${index + 1}`;
    const reason = readOnlyReason(rule);
    if (reason) {
      const summary = document.createElement("p");
      summary.className = "encounter-rule-summary";
      summary.textContent = summarizeRule(rule);
      card.append(title, summary, preservedJson(rule, reason));
      return card;
    }
    const canReorder = state.rules.every(candidate => !readOnlyReason(candidate));
    const orderControls = document.createElement("div");
    orderControls.className = "encounter-rule-order";
    const moveUp = button(`Move rule ${index + 1} up`, "Move up");
    moveUp.disabled = index === 0 || !canReorder;
    moveUp.addEventListener("click", () => reorderRule(index, index - 1));
    const moveDown = button(`Move rule ${index + 1} down`, "Move down");
    moveDown.disabled = index === count - 1 || !canReorder;
    moveDown.addEventListener("click", () => reorderRule(index, index + 1));
    const removeRule = button(`Remove rule ${index + 1}`, "Remove rule");
    removeRule.addEventListener("click", () => commit(next => {
      next.rules = next.rules.filter(candidate => candidate.id !== rule.id);
    }, true));
    const duplicate = button(`Duplicate rule ${index + 1}`, "Duplicate rule");
    duplicate.addEventListener("click", () => commit(next => {
      const copy = clone(next.rules.find(candidate => candidate.id === rule.id));
      copy.order = Math.max(...next.rules.map(candidate => candidate.order)) + 1;
      let serial = copy.order;
      while (next.rules.some(candidate => candidate.id === `rule-${serial}`)) serial++;
      copy.id = `rule-${serial}`;
      next.rules.push(copy);
    }, true));
    orderControls.append(moveUp, moveDown, duplicate, removeRule);
    heading.append(title, orderControls);

    const summary = document.createElement("p");
    summary.className = "encounter-rule-summary";
    summary.textContent = summarizeRule(rule);
    card.append(heading, summary);
    if (!canReorder || rule.priority != null || rule.activation != null) {
      const notice = document.createElement("p");
      notice.className = "encounter-rule-help";
      notice.textContent = `Priority: ${rule.priority ?? 0}. Activation: ${rule.activation?.scope ?? "default attacker-per-player-roll guard"}. Preserved without controls.${canReorder ? "" : " Reordering is disabled while read-only rules are present."}`;
      card.append(notice);
    }

    const trigger = document.createElement("fieldset");
    trigger.className = "encounter-rule-block";
    trigger.append(legend("Trigger"));
    const eventControls = document.createElement("div");
    eventControls.className = "encounter-inline-options";
    for (const [event, label] of [["after_move", "After movement"], ["after_roll", "After dice roll"]]) {
      const input = checkbox(label, rule.trigger.events.includes(event));
      input.addEventListener("change", () => updateRule(rule.id, current => {
        current.trigger.events = input.checked
          ? [...new Set([...current.trigger.events, event])]
          : current.trigger.events.filter(value => value !== event);
      }, summary));
      eventControls.append(input.closest("label"));
    }
    trigger.append(eventControls);

    const range = document.createElement("div");
    range.className = "encounter-rule-grid encounter-range-grid";
    range.append(
      numberControl("Minimum distance", rule.trigger.minDistance, 0, 100, value => updateRule(rule.id, current => { current.trigger.minDistance = value; }, summary)),
      numberControl("Maximum distance", rule.trigger.maxDistance, 0, 100, value => updateRule(rule.id, current => { current.trigger.maxDistance = value; }, summary)),
      selectControl("Distance measurement", rule.trigger.distance, ENCOUNTER_DISTANCE_MODES.map(value => [value, DISTANCE_LABELS[value]]), value => updateRule(rule.id, current => { current.trigger.distance = value; }, summary)),
      selectControl("Player position", rule.trigger.position, ENCOUNTER_POSITIONS.map(value => [value, POSITION_LABELS[value]]), value => updateRule(rule.id, current => { current.trigger.position = value; }, summary)),
      selectControl("Repeat behavior", rule.trigger.repeat, ENCOUNTER_REPEAT_MODES.map(value => [value, value === "every_event" ? "Every matching event" : "Once per dice roll"]), value => updateRule(rule.id, current => { current.trigger.repeat = value; }, summary))
    );
    trigger.append(range);
    card.append(trigger);

    const conditions = document.createElement("fieldset");
    conditions.className = "encounter-rule-block";
    conditions.append(legend("Conditions"));
    const conditionHelp = document.createElement("p");
    conditionHelp.className = "encounter-rule-help";
    conditionHelp.textContent = "All conditions must match. Use d1 and d2 for the current two dice.";
    conditions.append(conditionHelp);
    for (const [conditionIndex, condition] of rule.conditions.entries()) {
      conditions.append(renderCondition(rule.id, conditionIndex, condition, summary));
    }
    const addCondition = button(`Add condition to rule ${index + 1}`, "+ Add Condition");
    addCondition.addEventListener("click", () => updateRule(rule.id, current => {
      current.conditions.push({ type: "sum_comparison", operator: "<=", value: 2 });
    }, summary, true));
    conditions.append(addCondition);
    card.append(conditions);

    const actions = document.createElement("fieldset");
    actions.className = "encounter-rule-block";
    actions.append(legend("Actions"));
    for (const [actionIndex, action] of rule.actions.entries()) {
      actions.append(renderAction(rule.id, actionIndex, action, summary));
    }
    const addAction = button(`Add action to rule ${index + 1}`, "+ Add Action");
    addAction.addEventListener("click", () => updateRule(rule.id, current => {
      current.actions.push({ type: "damage", amount: 1, message: "" });
    }, summary, true));
    actions.append(addAction);
    card.append(actions);

    card.append(renderDiceTest(rule.id));
    return card;
  }

  function renderCondition(ruleId, conditionIndex, condition, summary) {
    const row = document.createElement("div");
    row.className = "encounter-condition-row";
    const header = document.createElement("div");
    header.className = "encounter-condition-heading";
    const type = selectControl(`Condition ${conditionIndex + 1} type`, condition.type,
      ENCOUNTER_CONDITION_TYPES.map(value => [value, CONDITION_LABELS[value]]), value => updateRule(ruleId, current => {
        const previous = current.conditions[conditionIndex];
        const conditionFields = new Set(["operator", "value", "dice", "parity", "die1", "die2", "ordered", "expression"]);
        const customFields = Object.fromEntries(Object.entries(previous).filter(([key]) => !conditionFields.has(key)));
        current.conditions[conditionIndex] = { ...customFields, ...defaultCondition(value) };
      }, summary, true));
    const remove = button(`Remove condition ${conditionIndex + 1}`, "Remove");
    remove.addEventListener("click", () => updateRule(ruleId, current => {
      current.conditions.splice(conditionIndex, 1);
    }, summary, true));
    header.append(type, remove);
    row.append(header);

    const controls = document.createElement("div");
    controls.className = "encounter-condition-controls";
    if (condition.type === "sum_comparison") {
      controls.append(
        selectControl(`Condition ${conditionIndex + 1} operator`, condition.operator, [["<", "less than"], ["<=", "less than or equal"], ["==", "equal"], ["!=", "not equal"], [">=", "greater than or equal"], [">", "greater than"]], value => updateRule(ruleId, current => { current.conditions[conditionIndex].operator = value; }, summary)),
        numberControl(`Condition ${conditionIndex + 1} total`, condition.value, -1000, 1000, value => updateRule(ruleId, current => { current.conditions[conditionIndex].value = value; }, summary))
      );
    } else if (condition.type === "parity") {
      controls.append(
        selectControl(`Condition ${conditionIndex + 1} dice`, condition.dice, [["sum", "Combined dice"], ["d1", "Die 1"], ["d2", "Die 2"]], value => updateRule(ruleId, current => { current.conditions[conditionIndex].dice = value; }, summary)),
        selectControl(`Condition ${conditionIndex + 1} parity`, condition.parity, [["even", "Even"], ["odd", "Odd"]], value => updateRule(ruleId, current => { current.conditions[conditionIndex].parity = value; }, summary))
      );
    } else if (condition.type === "exact_dice") {
      const unordered = checkbox(`Condition ${conditionIndex + 1} accept either order`, condition.ordered !== true);
      unordered.addEventListener("change", () => updateRule(ruleId, current => { current.conditions[conditionIndex].ordered = !unordered.checked; }, summary));
      controls.append(
        numberControl(`Condition ${conditionIndex + 1} die 1`, condition.die1, 1, 6, value => updateRule(ruleId, current => { current.conditions[conditionIndex].die1 = value; }, summary)),
        numberControl(`Condition ${conditionIndex + 1} die 2`, condition.die2, 1, 6, value => updateRule(ruleId, current => { current.conditions[conditionIndex].die2 = value; }, summary)),
        unordered.closest("label")
      );
    } else {
      const expression = textControl(`Condition ${conditionIndex + 1} expression`, condition.expression || "d1 + d2 <= 2");
      const expressionStatus = document.createElement("small");
      expressionStatus.className = "encounter-expression-status";
      const updateExpressionStatus = () => {
        try {
          const resultType = inferEncounterExpressionType(expression.value);
          expressionStatus.textContent = resultType === "boolean" ? "Valid condition expression" : "Expression must return true or false";
          expressionStatus.classList.toggle("is-invalid", resultType !== "boolean");
        } catch (error) {
          expressionStatus.textContent = error.message;
          expressionStatus.classList.add("is-invalid");
        }
      };
      expression.addEventListener("input", () => {
        updateRule(ruleId, current => { current.conditions[conditionIndex].expression = expression.value; }, summary);
        updateExpressionStatus();
      });
      updateExpressionStatus();
      controls.append(fieldRow("Condition expression", expression), expressionStatus);
    }
    row.append(controls);
    return row;
  }

  function renderAction(ruleId, actionIndex, action, summary) {
    const row = document.createElement("div");
    row.className = "encounter-action-row";
    const header = document.createElement("div");
    header.className = "encounter-condition-heading";
    const title = document.createElement("strong");
    title.textContent = `Deal damage ${actionIndex + 1}`;
    const mode = selectControl(`Action ${actionIndex + 1} damage amount mode`, action.amountExpression == null ? "fixed" : "expression", [["fixed", "Fixed damage"], ["expression", "Expression-based damage"]], value => updateRule(ruleId, current => {
      const target = current.actions[actionIndex];
      delete target.amount;
      delete target.amountExpression;
      if (value === "fixed") target.amount = 1;
      else target.amountExpression = "1";
    }, summary, true));
    header.append(title, mode);
    row.append(header);
    const amountField = action.amountExpression == null
      ? numberControl(`Action ${actionIndex + 1} damage`, action.amount, 0, 999, value => updateRule(ruleId, current => { current.actions[actionIndex].amount = value; }, summary))
      : textControl(`Action ${actionIndex + 1} damage expression`, action.amountExpression);
    if (action.amountExpression != null) amountField.addEventListener("input", () => updateRule(ruleId, current => { current.actions[actionIndex].amountExpression = amountField.value; }, summary));
    const message = textControl(`Action ${actionIndex + 1} result message`, action.message || "");
    message.addEventListener("input", () => updateRule(ruleId, current => { current.actions[actionIndex].message = message.value; }, summary));
    const fields = document.createElement("div");
    fields.className = "encounter-action-controls";
    fields.append(fieldRow(action.amountExpression == null ? "Damage" : "Damage expression", amountField), fieldRow("Result message", message));
    row.append(fields);
    const remove = button(`Remove damage action ${actionIndex + 1}`, "Remove action");
    remove.addEventListener("click", () => updateRule(ruleId, current => { current.actions.splice(actionIndex, 1); }, summary, true));
    row.append(remove);
    return row;
  }

  function renderDiceTest(ruleId) {
    const panel = document.createElement("section");
    panel.className = "encounter-dice-test";
    const heading = document.createElement("h5");
    heading.textContent = "Test this rule with dice";
    const values = document.createElement("div");
    values.className = "encounter-dice-test-inputs";
    const die1Field = numberControl("Test die 1", 1, 1, 6, () => {});
    const die2Field = numberControl("Test die 2", 1, 1, 6, () => {});
    const die1Input = die1Field.querySelector("input");
    const die2Input = die2Field.querySelector("input");
    const result = document.createElement("output");
    result.className = "encounter-dice-test-result";
    result.textContent = "Enter dice values and choose Test Dice.";
    const test = button("Test Dice", "Test Dice");
    test.addEventListener("click", () => {
      const currentRule = state.rules.find(candidate => candidate.id === ruleId);
      if (!currentRule) return;
      const dice = { d1: Number(die1Input.value), d2: Number(die2Input.value) };
      try {
        const matches = currentRule.conditions.length > 0 && currentRule.conditions.every(condition => encounterConditionMatches(condition, dice));
        const actionPreview = matches ? currentRule.actions.map(action => {
          const amount = action.amountExpression == null ? action.amount : evaluateEncounterExpression(action.amountExpression, dice);
          if (!Number.isFinite(amount) || amount < 0) throw new Error("Damage must resolve to a non-negative number.");
          return `${amount} damage`;
        }).join(", ") : "No action";
        result.textContent = `${matches ? "Conditions pass" : "Conditions do not pass"} · ${actionPreview || "No actions"}`;
        result.classList.toggle("is-match", matches);
        result.classList.toggle("is-invalid", false);
      } catch (error) {
        result.textContent = error.message;
        result.classList.remove("is-match");
        result.classList.add("is-invalid");
      }
    });
    values.append(die1Field, die2Field, test);
    panel.append(heading, values, result);
    return panel;
  }

  function updateRule(ruleId, mutate, summary, render = false) {
    commit(next => {
      const rule = next.rules.find(candidate => candidate.id === ruleId);
      if (rule) mutate(rule);
    }, render);
    if (!render && summary?.isConnected) {
      const current = state.rules.find(candidate => candidate.id === ruleId);
      summary.textContent = summarizeRule(current);
    }
  }

  function reorderRule(index, targetIndex) {
    commit(next => {
      const ordered = next.rules.slice().sort((left, right) => left.order - right.order);
      [ordered[index], ordered[targetIndex]] = [ordered[targetIndex], ordered[index]];
      ordered.forEach((rule, ruleIndex) => { rule.order = ruleIndex + 1; });
      next.rules = ordered;
    }, true);
  }

  draw();
}

function summarizeRule(rule) {
  if (!rule) return "Rule data unavailable.";
  const trigger = rule.trigger || {};
  const eventNames = (Array.isArray(trigger.events) ? trigger.events : []).map(event => EVENT_LABELS[event] || `Unrecognized event: ${String(event)}`).join(" and ") || "no event";
  const conditions = (Array.isArray(rule.conditions) ? rule.conditions : []).map(condition => {
    if (!condition) return "unrecognized condition";
    if (condition.type === "expression") return condition.expression || "invalid expression";
    if (condition.type === "sum_comparison") return `d1 + d2 ${condition.operator} ${condition.value}`;
    if (condition.type === "parity") return `${condition.dice === "sum" ? "d1 + d2" : condition.dice} is ${condition.parity}`;
    if (condition.type === "exact_dice") return `dice ${condition.die1} and ${condition.die2}`;
    return "condition";
  }).join(" AND ") || "no conditions";
  const actions = (Array.isArray(rule.actions) ? rule.actions : []).map(action => action?.type === "damage" ? `${action.amountExpression ?? action.amount} damage` : "unrecognized action").join(", ") || "no actions";
  const repeat = trigger.repeat === "once_per_roll" ? "once per roll" : "every event";
  return `${eventNames} · ${trigger.minDistance ?? "?"}–${trigger.maxDistance ?? "?"} ${DISTANCE_LABELS[trigger.distance] || "cells"} · ${POSITION_LABELS[trigger.position] || "any side"} · if ${conditions} · ${actions} · ${repeat}`;
}

function defaultCondition(type) {
  if (type === "parity") return { type, dice: "sum", parity: "even" };
  if (type === "exact_dice") return { type, die1: 1, die2: 1, ordered: false };
  if (type === "expression") return { type, expression: "d1 + d2 <= 2" };
  return { type: "sum_comparison", operator: "<=", value: 2 };
}

function legend(text) {
  const element = document.createElement("legend");
  element.textContent = text;
  return element;
}

function fieldRow(labelText, control) {
  const row = document.createElement("label");
  row.className = "encounter-field-row";
  const label = document.createElement("span");
  label.textContent = labelText;
  row.append(label, control);
  return row;
}

function selectControl(labelText, value, options, onChange) {
  const select = document.createElement("select");
  select.setAttribute("aria-label", labelText);
  for (const [optionValue, label] of options) select.append(new Option(label, optionValue));
  select.value = value;
  select.addEventListener("change", () => onChange(select.value));
  return fieldRow(labelText, select);
}

function numberControl(labelText, value, min, max, onChange) {
  const input = document.createElement("input");
  input.type = "number";
  input.min = String(min);
  input.max = String(max);
  input.step = "1";
  input.value = String(value ?? min);
  input.setAttribute("aria-label", labelText);
  input.addEventListener("change", () => {
    const number = Number(input.value);
    if (Number.isFinite(number)) onChange(number);
  });
  return fieldRow(labelText, input);
}

function textControl(labelText, value) {
  const input = document.createElement("input");
  input.type = "text";
  input.value = value ?? "";
  input.setAttribute("aria-label", labelText);
  return input;
}

function checkbox(labelText, checked, onChange = null) {
  const label = document.createElement("label");
  label.className = "encounter-checkbox";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.setAttribute("aria-label", labelText);
  const caption = document.createElement("span");
  caption.textContent = labelText;
  if (onChange) input.addEventListener("change", () => onChange(input.checked));
  label.append(input, caption);
  return input;
}

function button(label, text) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "quiet-button encounter-control-button";
  element.setAttribute("aria-label", label);
  element.textContent = text;
  return element;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
