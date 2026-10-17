export const ENCOUNTER_EVENTS = ["after_move", "after_roll"];
export const ENCOUNTER_DISTANCE_MODES = ["manhattan", "chebyshev"];
export const ENCOUNTER_POSITIONS = ["any", "player_above", "player_below", "player_left", "player_right"];
export const ENCOUNTER_REPEAT_MODES = ["every_event", "once_per_roll"];
export const ENCOUNTER_RESOLUTIONS = ["all_matches", "first_match_per_tile"];
export const ENCOUNTER_CONDITION_TYPES = ["sum_comparison", "parity", "exact_dice", "expression"];

const COMPARISON_OPERATORS = new Set(["<", "<=", "==", "!=", ">=", ">"]);
const RULE_LIMIT = 50;
const CONDITION_LIMIT = 20;
const MESSAGE_LIMIT = 300;
const EXPRESSION_LIMIT = 200;

export function createDefaultEncounterRules() {
  return {
    enabled: false,
    resolution: "all_matches",
    rules: [createDefaultEncounterRule(1)]
  };
}

export function createDefaultEncounterRule(order = 1) {
  return {
    id: `rule-${order}`,
    order,
    trigger: {
      events: ["after_move"],
      minDistance: 1,
      maxDistance: 1,
      distance: "manhattan",
      position: "any",
      repeat: "every_event"
    },
    conditions: [{ type: "sum_comparison", operator: "<=", value: 2 }],
    actions: [{ type: "damage", amount: 1, message: "" }]
  };
}

export function parseEncounterExpression(expression) {
  if (typeof expression !== "string" || !expression.trim()) throw new SyntaxError("Enter an expression.");
  if (expression.length > EXPRESSION_LIMIT) throw new SyntaxError(`Expression must be ${EXPRESSION_LIMIT} characters or fewer.`);

  const tokens = tokenize(expression);
  let index = 0;
  const peek = () => tokens[index] ?? null;
  const consume = () => tokens[index++];

  const parsePrimary = () => {
    const token = consume();
    if (token === "(") {
      const nested = parseOr();
      if (consume() !== ")") throw new SyntaxError("Missing closing parenthesis.");
      return nested;
    }
    if (token === "d1" || token === "d2") return { kind: "variable", name: token };
    if (typeof token === "number") return { kind: "number", value: token };
    throw new SyntaxError(`Unexpected token '${token ?? "end of expression"}'.`);
  };

  const parseUnary = () => {
    const token = peek();
    if (["!", "+", "-"].includes(token)) {
      consume();
      return { kind: "unary", operator: token, value: parseUnary() };
    }
    return parsePrimary();
  };

  const parseBinary = (next, operators) => {
    let left = next();
    while (operators.has(peek())) {
      const operator = consume();
      left = { kind: "binary", operator, left, right: next() };
    }
    return left;
  };

  const parseMultiplicative = () => parseBinary(parseUnary, new Set(["*", "/", "%"]));
  const parseAdditive = () => parseBinary(parseMultiplicative, new Set(["+", "-"]));
  const parseComparison = () => parseBinary(parseAdditive, new Set(["<", "<=", ">", ">="]));
  const parseEquality = () => parseBinary(parseComparison, new Set(["==", "!="]));
  const parseAnd = () => parseBinary(parseEquality, new Set(["&&"]));
  const parseOr = () => parseBinary(parseAnd, new Set(["||"]));

  const ast = parseOr();
  if (peek() !== null) throw new SyntaxError(`Unexpected token '${peek()}'.`);
  inferType(ast);
  return ast;
}

export function evaluateEncounterExpression(expression, dice) {
  const ast = typeof expression === "string" ? parseEncounterExpression(expression) : expression;
  const values = { d1: dice?.d1, d2: dice?.d2 };
  if (![values.d1, values.d2].every(value => Number.isFinite(value))) {
    throw new TypeError("Dice values d1 and d2 must be finite numbers.");
  }
  return evaluateNode(ast, values);
}

export function encounterConditionMatches(condition, dice) {
  if (condition?.type === "expression") {
    const result = evaluateEncounterExpression(condition.expression, dice);
    if (typeof result !== "boolean") throw new TypeError("A condition expression must produce true or false.");
    return result;
  }
  if (condition?.type === "sum_comparison") {
    return compare(dice.d1 + dice.d2, condition.operator, condition.value);
  }
  if (condition?.type === "parity") {
    const value = condition.dice === "d1" ? dice.d1 : condition.dice === "d2" ? dice.d2 : dice.d1 + dice.d2;
    return value % 2 === (condition.parity === "even" ? 0 : 1);
  }
  if (condition?.type === "exact_dice") {
    const matches = dice.d1 === condition.die1 && dice.d2 === condition.die2;
    return condition.ordered === false
      ? matches || (dice.d1 === condition.die2 && dice.d2 === condition.die1)
      : matches;
  }
  throw new TypeError(`Unsupported encounter condition '${condition?.type}'.`);
}

export function calculateEncounterDistance(dx, dy, mode = "manhattan") {
  const xDistance = Math.abs(dx);
  const yDistance = Math.abs(dy);
  if (mode === "manhattan") return xDistance + yDistance;
  if (mode === "chebyshev") return Math.max(xDistance, yDistance);
  throw new TypeError(`Unsupported encounter distance '${mode}'.`);
}

export function encounterPositionMatches(dx, dy, position = "any") {
  if (position === "any") return true;
  if (position === "player_above") return dx === 0 && dy < 0;
  if (position === "player_below") return dx === 0 && dy > 0;
  if (position === "player_left") return dy === 0 && dx < 0;
  if (position === "player_right") return dy === 0 && dx > 0;
  return false;
}

export function validateEncounterRules(value, path = "encounterRules") {
  const issues = [];
  const add = (issuePath, message) => issues.push({ path: issuePath, message });
  if (!isPlainObject(value)) return [{ path, message: "Encounter rules must be an object." }];
  if (typeof value.enabled !== "boolean") add(`${path}.enabled`, "enabled must be boolean.");
  if (!ENCOUNTER_RESOLUTIONS.includes(value.resolution)) add(`${path}.resolution`, `resolution must be one of: ${ENCOUNTER_RESOLUTIONS.join(", ")}.`);
  if (!Array.isArray(value.rules)) return [...issues, { path: `${path}.rules`, message: "rules must be an array." }];
  if (value.rules.length > RULE_LIMIT) add(`${path}.rules`, `rules must contain ${RULE_LIMIT} or fewer entries.`);

  const ids = new Set();
  const orders = new Set();
  for (const [index, rule] of value.rules.entries()) {
    const rulePath = `${path}.rules[${index}]`;
    if (!isPlainObject(rule)) {
      add(rulePath, "Rule must be an object.");
      continue;
    }
    if (typeof rule.id !== "string" || !rule.id.trim()) add(`${rulePath}.id`, "Rule id is required.");
    else if (ids.has(rule.id)) add(`${rulePath}.id`, "Rule id must be unique.");
    else ids.add(rule.id);
    if (rule.priority != null && !Number.isSafeInteger(rule.priority)) add(`${rulePath}.priority`, "Rule priority must be an integer.");
    if (!Number.isSafeInteger(rule.order) || rule.order < 1) add(`${rulePath}.order`, "Rule order must be a positive integer.");
    else if (orders.has(rule.order)) add(`${rulePath}.order`, "Rule order must be unique.");
    else orders.add(rule.order);

    const triggerPath = `${rulePath}.trigger`;
    const trigger = rule.trigger;
    if (!isPlainObject(trigger)) {
      add(triggerPath, "trigger must be an object.");
    } else {
      if (!Array.isArray(trigger.events) || !trigger.events.length || trigger.events.some(event => !ENCOUNTER_EVENTS.includes(event))) {
        add(`${triggerPath}.events`, `events must include one or more of: ${ENCOUNTER_EVENTS.join(", ")}.`);
      }
      for (const field of ["minDistance", "maxDistance"]) {
        if (!Number.isSafeInteger(trigger[field]) || trigger[field] < 0 || trigger[field] > 100) {
          add(`${triggerPath}.${field}`, `${field} must be an integer from 0 to 100.`);
        }
      }
      if (Number.isSafeInteger(trigger.minDistance) && Number.isSafeInteger(trigger.maxDistance) && trigger.maxDistance < trigger.minDistance) {
        add(`${triggerPath}.maxDistance`, "maxDistance must be at least minDistance.");
      }
      if (!ENCOUNTER_DISTANCE_MODES.includes(trigger.distance)) add(`${triggerPath}.distance`, `distance must be one of: ${ENCOUNTER_DISTANCE_MODES.join(", ")}.`);
      if (!ENCOUNTER_POSITIONS.includes(trigger.position)) add(`${triggerPath}.position`, `position must be one of: ${ENCOUNTER_POSITIONS.join(", ")}.`);
      if (!ENCOUNTER_REPEAT_MODES.includes(trigger.repeat)) add(`${triggerPath}.repeat`, `repeat must be one of: ${ENCOUNTER_REPEAT_MODES.join(", ")}.`);
    }

    if (!Array.isArray(rule.conditions) || !rule.conditions.length) {
      add(`${rulePath}.conditions`, "Each rule must have at least one condition.");
    } else {
      if (rule.conditions.length > CONDITION_LIMIT) add(`${rulePath}.conditions`, `conditions must contain ${CONDITION_LIMIT} or fewer entries.`);
      for (const [conditionIndex, condition] of rule.conditions.entries()) {
        validateCondition(condition, `${rulePath}.conditions[${conditionIndex}]`, add);
      }
    }

    if (!Array.isArray(rule.actions) || !rule.actions.length) {
      add(`${rulePath}.actions`, "Each rule must have at least one action.");
    } else {
      for (const [actionIndex, action] of rule.actions.entries()) {
        validateAction(action, `${rulePath}.actions[${actionIndex}]`, add);
      }
    }
  }
  return issues;
}

function validateCondition(condition, path, addIssue) {
  if (!isPlainObject(condition)) return addIssue(path, "Condition must be an object.");
  if (!ENCOUNTER_CONDITION_TYPES.includes(condition.type)) return addIssue(`${path}.type`, `type must be one of: ${ENCOUNTER_CONDITION_TYPES.join(", ")}.`);
  if (condition.type === "expression") {
    try {
      if (inferEncounterExpressionType(condition.expression) !== "boolean") addIssue(`${path}.expression`, "Condition expression must produce true or false.");
    } catch (error) {
      addIssue(`${path}.expression`, error.message);
    }
  } else if (condition.type === "sum_comparison") {
    if (!COMPARISON_OPERATORS.has(condition.operator)) addIssue(`${path}.operator`, "operator must be a comparison operator.");
    if (!Number.isFinite(condition.value)) addIssue(`${path}.value`, "value must be a finite number.");
  } else if (condition.type === "parity") {
    if (!["sum", "d1", "d2"].includes(condition.dice)) addIssue(`${path}.dice`, "dice must be sum, d1, or d2.");
    if (!["even", "odd"].includes(condition.parity)) addIssue(`${path}.parity`, "parity must be even or odd.");
  } else if (condition.type === "exact_dice") {
    for (const field of ["die1", "die2"]) {
      if (!Number.isInteger(condition[field]) || condition[field] < 1 || condition[field] > 6) addIssue(`${path}.${field}`, `${field} must be an integer from 1 to 6.`);
    }
    if (condition.ordered != null && typeof condition.ordered !== "boolean") addIssue(`${path}.ordered`, "ordered must be boolean.");
  }
}

function validateAction(action, path, addIssue) {
  if (!isPlainObject(action)) return addIssue(path, "Action must be an object.");
  if (action.type !== "damage") return addIssue(`${path}.type`, "Only the damage action is currently supported.");
  const hasAmount = Object.hasOwn(action, "amount");
  const hasExpression = Object.hasOwn(action, "amountExpression");
  if (hasAmount === hasExpression) addIssue(path, "Provide exactly one of amount or amountExpression.");
  if (hasAmount && (!Number.isFinite(action.amount) || action.amount < 0)) addIssue(`${path}.amount`, "amount must be a finite non-negative number.");
  if (hasExpression) {
    try {
      if (inferEncounterExpressionType(action.amountExpression) !== "number") addIssue(`${path}.amountExpression`, "amountExpression must produce a number.");
    } catch (error) {
      addIssue(`${path}.amountExpression`, error.message);
    }
  }
  if (action.message != null && (typeof action.message !== "string" || action.message.length > MESSAGE_LIMIT)) addIssue(`${path}.message`, `message must be text of ${MESSAGE_LIMIT} characters or fewer.`);
}

export function inferEncounterExpressionType(expression) {
  return inferType(parseEncounterExpression(expression));
}

function tokenize(expression) {
  const source = expression.trim();
  const pattern = /\s*(?:(\d+(?:\.\d+)?|\.\d+)|(d1|d2)\b|(<=|>=|==|!=|&&|\|\||[()+\-*/%!<>]))/y;
  const tokens = [];
  let offset = 0;
  while (offset < source.length) {
    pattern.lastIndex = offset;
    const match = pattern.exec(source);
    if (!match) throw new SyntaxError(`Unexpected character at position ${offset + 1}.`);
    offset = pattern.lastIndex;
    if (match[1] != null) tokens.push(Number(match[1]));
    else tokens.push(match[2] || match[3]);
  }
  return tokens;
}

function inferType(node) {
  if (node.kind === "number" || node.kind === "variable") return "number";
  if (node.kind === "unary") {
    const operand = inferType(node.value);
    if (node.operator === "!" && operand === "boolean") return "boolean";
    if (["+", "-"].includes(node.operator) && operand === "number") return "number";
    throw new SyntaxError(`Operator '${node.operator}' has an invalid operand.`);
  }
  const left = inferType(node.left);
  const right = inferType(node.right);
  if (["+", "-", "*", "/", "%"].includes(node.operator) && left === "number" && right === "number") return "number";
  if (["<", "<=", ">", ">="].includes(node.operator) && left === "number" && right === "number") return "boolean";
  if (["==", "!="].includes(node.operator) && left === right) return "boolean";
  if (["&&", "||"].includes(node.operator) && left === "boolean" && right === "boolean") return "boolean";
  throw new SyntaxError(`Operator '${node.operator}' has incompatible operands.`);
}

function evaluateNode(node, dice) {
  if (node.kind === "number") return node.value;
  if (node.kind === "variable") return dice[node.name];
  if (node.kind === "unary") {
    const value = evaluateNode(node.value, dice);
    if (node.operator === "!") return !value;
    return node.operator === "-" ? -value : value;
  }
  const left = evaluateNode(node.left, dice);
  if (node.operator === "&&") return left && evaluateNode(node.right, dice);
  if (node.operator === "||") return left || evaluateNode(node.right, dice);
  const right = evaluateNode(node.right, dice);
  if ((node.operator === "/" || node.operator === "%") && right === 0) throw new RangeError("Division by zero is not allowed.");
  switch (node.operator) {
    case "+": return left + right;
    case "-": return left - right;
    case "*": return left * right;
    case "/": return left / right;
    case "%": return left % right;
    case "<": return left < right;
    case "<=": return left <= right;
    case "==": return left === right;
    case "!=": return left !== right;
    case ">=": return left >= right;
    case ">": return left > right;
    default: throw new SyntaxError(`Unsupported operator '${node.operator}'.`);
  }
}

function compare(left, operator, right) {
  switch (operator) {
    case "<": return left < right;
    case "<=": return left <= right;
    case "==": return left === right;
    case "!=": return left !== right;
    case ">=": return left >= right;
    case ">": return left > right;
    default: return false;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
