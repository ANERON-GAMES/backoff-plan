export const DEFAULT_BASE_DELAY_MS = 100;
export const DEFAULT_MULTIPLIER = 2;
export const DEFAULT_MAX_DELAY_MS = 30000;
export const DEFAULT_MAX_ATTEMPTS = 8;
export const JITTER_NONE = 'none';
export const JITTER_FULL = 'full';
export const JITTER_EQUAL = 'equal';
export const DEFAULT_JITTER = JITTER_NONE;
export const REASON_MAX_ATTEMPTS = 'max_attempts';
export const REASON_DEADLINE = 'deadline';

export const DEFAULTS = Object.freeze({
  baseDelayMs: DEFAULT_BASE_DELAY_MS,
  multiplier: DEFAULT_MULTIPLIER,
  maxDelayMs: DEFAULT_MAX_DELAY_MS,
  maxAttempts: DEFAULT_MAX_ATTEMPTS,
  jitter: DEFAULT_JITTER,
});

const STATE_KEYS = new Set(['attempt']);
const OPTION_KEYS = new Set([
  'baseDelayMs',
  'multiplier',
  'maxDelayMs',
  'maxAttempts',
  'deadlineMs',
  'jitter',
]);
const JITTER_VALUES = new Set([JITTER_NONE, JITTER_FULL, JITTER_EQUAL]);

export class BackoffPlanError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BackoffPlanError';
    this.code = code;
  }
}

function invalid(code, message) {
  throw new BackoffPlanError(code, message);
}

function isPlainObject(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isNonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isMultiplier(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1;
}

function isMaxAttempts(value) {
  return value === Infinity || isNonNegativeSafeInteger(value);
}

function isJitter(value) {
  return typeof value === 'string' && JITTER_VALUES.has(value);
}

function firstUnknown(object, allowed) {
  const names = [];
  let hasSymbol = false;
  for (const key of Reflect.ownKeys(object)) {
    if (typeof key === 'symbol') {
      hasSymbol = true;
      continue;
    }
    if (!allowed.has(key)) {
      names.push(key);
    }
  }
  names.sort();
  return { name: names[0], hasSymbol };
}

function readOptional(object, key, fallback, validate, code, message) {
  if (!Object.hasOwn(object, key)) {
    return fallback;
  }
  const value = object[key];
  if (value === undefined) {
    return fallback;
  }
  if (!validate(value)) {
    invalid(code, message);
  }
  return value;
}

function validateState(state) {
  if (!isPlainObject(state)) {
    invalid('invalid_state', 'state must be a plain object');
  }
  const unknown = firstUnknown(state, STATE_KEYS);
  if (unknown.name !== undefined) {
    invalid('invalid_state', `unknown state field "${unknown.name}"`);
  }
  if (unknown.hasSymbol) {
    invalid('invalid_state', 'state must not contain symbol keys');
  }
  if (!Object.hasOwn(state, 'attempt')) {
    invalid('invalid_attempt', 'state.attempt must be a non-negative safe integer');
  }
  const attempt = state.attempt;
  if (!isNonNegativeSafeInteger(attempt)) {
    invalid('invalid_attempt', 'state.attempt must be a non-negative safe integer');
  }
  return attempt === 0 ? 0 : attempt;
}

function readDeadline(options) {
  if (!Object.hasOwn(options, 'deadlineMs')) {
    return undefined;
  }
  const deadlineMs = options.deadlineMs;
  if (deadlineMs === undefined) {
    return undefined;
  }
  if (!Number.isSafeInteger(deadlineMs)) {
    invalid('invalid_deadline', 'deadlineMs must be a safe integer');
  }
  return deadlineMs;
}

function resolveOptions(options) {
  if (!isPlainObject(options)) {
    invalid('invalid_options', 'options must be a plain object');
  }
  const unknown = firstUnknown(options, OPTION_KEYS);
  if (unknown.name !== undefined) {
    invalid('unknown_option', `unknown option "${unknown.name}"`);
  }
  if (unknown.hasSymbol) {
    invalid('unknown_option', 'options must not contain symbol keys');
  }
  const baseDelayMs = readOptional(
    options,
    'baseDelayMs',
    DEFAULT_BASE_DELAY_MS,
    isNonNegativeSafeInteger,
    'invalid_base_delay',
    'baseDelayMs must be a non-negative safe integer',
  );
  const multiplier = readOptional(
    options,
    'multiplier',
    DEFAULT_MULTIPLIER,
    isMultiplier,
    'invalid_multiplier',
    'multiplier must be a finite number greater than or equal to 1',
  );
  const maxDelayMs = readOptional(
    options,
    'maxDelayMs',
    DEFAULT_MAX_DELAY_MS,
    isNonNegativeSafeInteger,
    'invalid_max_delay',
    'maxDelayMs must be a non-negative safe integer',
  );
  const maxAttempts = readOptional(
    options,
    'maxAttempts',
    DEFAULT_MAX_ATTEMPTS,
    isMaxAttempts,
    'invalid_max_attempts',
    'maxAttempts must be a non-negative safe integer or Infinity',
  );
  const deadlineMs = readDeadline(options);
  const jitter = readOptional(
    options,
    'jitter',
    DEFAULT_JITTER,
    isJitter,
    'invalid_jitter',
    'jitter must be "none", "full", or "equal"',
  );
  return { baseDelayMs, multiplier, maxDelayMs, maxAttempts, deadlineMs, jitter };
}

function validateNow(nowMs) {
  if (!Number.isSafeInteger(nowMs)) {
    invalid('invalid_now', 'nowMs must be a safe integer');
  }
}

function cappedExponential(baseDelayMs, multiplier, attempt, maxDelayMs) {
  if (maxDelayMs === 0 || baseDelayMs === 0) {
    return 0;
  }
  if (baseDelayMs >= maxDelayMs || attempt === 0 || multiplier === 1) {
    return Math.min(baseDelayMs, maxDelayMs);
  }
  const raw = baseDelayMs * multiplier ** attempt;
  if (!Number.isFinite(raw) || raw >= maxDelayMs) {
    return maxDelayMs;
  }
  return Math.floor(raw);
}

function delayBounds(capped, jitter) {
  if (jitter === JITTER_FULL) {
    return { lower: 0, upper: capped };
  }
  if (jitter === JITTER_EQUAL) {
    return { lower: Math.floor(capped / 2), upper: capped };
  }
  return { lower: capped, upper: capped };
}

function integerInRange(sample, lower, upper) {
  const width = upper - lower;
  const offset = Math.floor(sample * (width + 1));
  if (!Number.isFinite(offset) || offset > width) {
    return upper;
  }
  if (offset <= 0) {
    return lower;
  }
  return lower + offset;
}

function missesDeadline(nowMs, delayMs, deadlineMs) {
  return BigInt(nowMs) + BigInt(delayMs) > BigInt(deadlineMs);
}

function readSample(random) {
  if (typeof random !== 'function') {
    invalid('invalid_random', 'random must be a function');
  }
  const sample = random();
  if (typeof sample !== 'number' || !Number.isFinite(sample) || sample < 0 || sample >= 1) {
    invalid('invalid_sample', 'random must return a finite number in [0, 1)');
  }
  return sample;
}

function giveUp(attempt, reason) {
  return {
    delayMs: null,
    state: { attempt },
    giveUp: true,
    reason,
  };
}

function continuePlan(attempt, delayMs) {
  return {
    delayMs: delayMs === 0 ? 0 : delayMs,
    state: { attempt: attempt + 1 },
    giveUp: false,
    reason: null,
  };
}

export function initialState() {
  return { attempt: 0 };
}

export function nextRetry(state, options, nowMs, random) {
  const attempt = validateState(state);
  const resolved = resolveOptions(options);
  validateNow(nowMs);

  if (attempt >= resolved.maxAttempts) {
    return giveUp(attempt, REASON_MAX_ATTEMPTS);
  }
  if (attempt === Number.MAX_SAFE_INTEGER) {
    invalid('attempt_overflow', 'state.attempt cannot advance past Number.MAX_SAFE_INTEGER');
  }

  const capped = cappedExponential(
    resolved.baseDelayMs,
    resolved.multiplier,
    attempt,
    resolved.maxDelayMs,
  );
  const bounds = delayBounds(capped, resolved.jitter);
  if (
    resolved.deadlineMs !== undefined &&
    missesDeadline(nowMs, bounds.lower, resolved.deadlineMs)
  ) {
    return giveUp(attempt, REASON_DEADLINE);
  }

  const delayMs =
    bounds.lower === bounds.upper
      ? bounds.lower
      : integerInRange(readSample(random), bounds.lower, bounds.upper);

  if (resolved.deadlineMs !== undefined && missesDeadline(nowMs, delayMs, resolved.deadlineMs)) {
    return giveUp(attempt, REASON_DEADLINE);
  }
  return continuePlan(attempt, delayMs);
}
