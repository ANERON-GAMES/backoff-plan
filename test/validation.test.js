import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initialState, nextRetry } from '../src/index.js';
import { assertPlanError, label } from './helpers.js';

const BASE_MESSAGE = 'baseDelayMs must be a non-negative safe integer';
const MULTIPLIER_MESSAGE = 'multiplier must be a finite number greater than or equal to 1';
const MAX_DELAY_MESSAGE = 'maxDelayMs must be a non-negative safe integer';
const MAX_ATTEMPTS_MESSAGE = 'maxAttempts must be a non-negative safe integer or Infinity';
const DEADLINE_MESSAGE = 'deadlineMs must be a safe integer';
const JITTER_MESSAGE = 'jitter must be "none", "full", or "equal"';
const NOW_MESSAGE = 'nowMs must be a safe integer';
const ATTEMPT_MESSAGE = 'state.attempt must be a non-negative safe integer';
const SAMPLE_MESSAGE = 'random must return a finite number in [0, 1)';

function rejectBase(value) {
  assertPlanError(
    () => nextRetry(initialState(), { baseDelayMs: value }, 0),
    'invalid_base_delay',
    BASE_MESSAGE,
  );
}

function rejectMultiplier(value) {
  assertPlanError(
    () => nextRetry(initialState(), { multiplier: value }, 0),
    'invalid_multiplier',
    MULTIPLIER_MESSAGE,
  );
}

function rejectMaxDelay(value) {
  assertPlanError(
    () => nextRetry(initialState(), { maxDelayMs: value }, 0),
    'invalid_max_delay',
    MAX_DELAY_MESSAGE,
  );
}

function rejectMaxAttempts(value) {
  assertPlanError(
    () => nextRetry(initialState(), { maxAttempts: value }, 0),
    'invalid_max_attempts',
    MAX_ATTEMPTS_MESSAGE,
  );
}

function rejectDeadline(value) {
  assertPlanError(
    () => nextRetry(initialState(), { deadlineMs: value }, 0),
    'invalid_deadline',
    DEADLINE_MESSAGE,
  );
}

function rejectJitter(value) {
  assertPlanError(
    () => nextRetry(initialState(), { jitter: value }, 0),
    'invalid_jitter',
    JITTER_MESSAGE,
  );
}

function rejectNow(value) {
  assertPlanError(() => nextRetry(initialState(), {}, value), 'invalid_now', NOW_MESSAGE);
}

function rejectAttempt(value) {
  assertPlanError(() => nextRetry({ attempt: value }, {}, 0), 'invalid_attempt', ATTEMPT_MESSAGE);
}

function rejectSample(value) {
  assertPlanError(
    () =>
      nextRetry(
        initialState(),
        { jitter: 'full', baseDelayMs: 10, maxAttempts: 2 },
        0,
        () => value,
      ),
    'invalid_sample',
    SAMPLE_MESSAGE,
  );
}

for (const value of [undefined, null, 0, 'state', [], [0], () => {}, new Date(), 1n, true]) {
  test(`rejects state ${label(value)}`, () => {
    assertPlanError(() => nextRetry(value, {}, 0), 'invalid_state', 'state must be a plain object');
  });
}

test('rejects a state that inherits attempt', () => {
  assertPlanError(
    () => nextRetry(Object.create({ attempt: 0 }), {}, 0),
    'invalid_state',
    'state must be a plain object',
  );
});

test('rejects a missing attempt', () => {
  assertPlanError(() => nextRetry({}, {}, 0), 'invalid_attempt', ATTEMPT_MESSAGE);
});

for (const value of [
  -1,
  1.5,
  Number.NaN,
  Infinity,
  -Infinity,
  '0',
  null,
  true,
  false,
  1n,
  Number.MAX_SAFE_INTEGER + 1,
  undefined,
]) {
  test(`rejects attempt ${label(value)}`, () => {
    rejectAttempt(value);
  });
}

test('reports the lexicographically first unknown state field', () => {
  assertPlanError(
    () => nextRetry({ attempt: 0, zeta: 1, alpha: 2 }, {}, 0),
    'invalid_state',
    'unknown state field "alpha"',
  );
});

test('rejects a non-enumerable unknown state field', () => {
  const state = { attempt: 0 };
  Object.defineProperty(state, 'hidden', { value: 1, enumerable: false });
  assertPlanError(() => nextRetry(state, {}, 0), 'invalid_state', 'unknown state field "hidden"');
});

test('rejects symbol keys on state', () => {
  assertPlanError(
    () => nextRetry({ attempt: 0, [Symbol('x')]: 1 }, {}, 0),
    'invalid_state',
    'state must not contain symbol keys',
  );
});

test('prefers an unknown state field name over a symbol key', () => {
  assertPlanError(
    () => nextRetry({ attempt: 0, extra: 1, [Symbol('x')]: 1 }, {}, 0),
    'invalid_state',
    'unknown state field "extra"',
  );
});

for (const value of [undefined, null, 0, 'options', [], () => {}, new Date(), 1n, new Map()]) {
  test(`rejects options ${label(value)}`, () => {
    assertPlanError(
      () => nextRetry(initialState(), value, 0),
      'invalid_options',
      'options must be a plain object',
    );
  });
}

test('rejects options that inherit fields', () => {
  assertPlanError(
    () => nextRetry(initialState(), Object.create({ baseDelayMs: 5 }), 0),
    'invalid_options',
    'options must be a plain object',
  );
});

test('rejects a class instance as options', () => {
  class Options {
    constructor() {
      this.baseDelayMs = 100;
    }
  }
  assertPlanError(
    () => nextRetry(initialState(), new Options(), 0),
    'invalid_options',
    'options must be a plain object',
  );
});

test('reports the lexicographically first unknown option', () => {
  assertPlanError(
    () => nextRetry(initialState(), { zeta: 1, alpha: 2, baseDelayMs: 1 }, 0),
    'unknown_option',
    'unknown option "alpha"',
  );
});

test('rejects an empty-string option key', () => {
  assertPlanError(
    () => nextRetry(initialState(), { '': 1 }, 0),
    'unknown_option',
    'unknown option ""',
  );
});

test('rejects a non-enumerable unknown option', () => {
  const options = {};
  Object.defineProperty(options, 'extra', { value: 1, enumerable: false });
  assertPlanError(
    () => nextRetry(initialState(), options, 0),
    'unknown_option',
    'unknown option "extra"',
  );
});

test('rejects symbol keys on options', () => {
  assertPlanError(
    () => nextRetry(initialState(), { [Symbol('x')]: 1 }, 0),
    'unknown_option',
    'options must not contain symbol keys',
  );
});

test('prefers an unknown option name over a symbol key', () => {
  assertPlanError(
    () => nextRetry(initialState(), { extra: true, [Symbol('x')]: 1 }, 0),
    'unknown_option',
    'unknown option "extra"',
  );
});

test('rejects an own proto key', () => {
  const options = Object.create(null);
  options.__proto__ = { bad: true };
  options.baseDelayMs = 10;
  assertPlanError(
    () => nextRetry(initialState(), options, 0),
    'unknown_option',
    'unknown option "__proto__"',
  );
  assert.equal(Object.getPrototypeOf(options), null);
});

for (const value of [
  -1,
  1.2,
  Number.NaN,
  Infinity,
  -Infinity,
  '100',
  null,
  true,
  false,
  1n,
  Number.MAX_SAFE_INTEGER + 1,
]) {
  test(`rejects baseDelayMs ${label(value)}`, () => {
    rejectBase(value);
  });
}

for (const value of [0, 0.999999, -1, Number.NaN, Infinity, -Infinity, '2', null, true, 1n]) {
  test(`rejects multiplier ${label(value)}`, () => {
    rejectMultiplier(value);
  });
}

for (const value of [-1, 1.5, Number.NaN, Infinity, -Infinity, null, '1', false, 1n]) {
  test(`rejects maxDelayMs ${label(value)}`, () => {
    rejectMaxDelay(value);
  });
}

for (const value of [-1, 1.5, Number.NaN, -Infinity, null, '1', 1n, Number.MAX_SAFE_INTEGER + 1]) {
  test(`rejects maxAttempts ${label(value)}`, () => {
    rejectMaxAttempts(value);
  });
}

for (const value of [1.5, Number.NaN, Infinity, -Infinity, null, '0', true, 1n]) {
  test(`rejects deadlineMs ${label(value)}`, () => {
    rejectDeadline(value);
  });
}

for (const value of ['NONE', 'Full', 'equal ', '', 'decorrelated', 'nonee', 1, null, true]) {
  test(`rejects jitter ${label(value)}`, () => {
    rejectJitter(value);
  });
}

for (const value of [
  undefined,
  null,
  1.5,
  Number.NaN,
  Infinity,
  -Infinity,
  '0',
  true,
  1n,
  Number.MAX_SAFE_INTEGER + 1,
]) {
  test(`rejects nowMs ${label(value)}`, () => {
    rejectNow(value);
  });
}

test('requires a function when a sample can change the delay', () => {
  assertPlanError(
    () => nextRetry(initialState(), { jitter: 'full', baseDelayMs: 10 }, 0, undefined),
    'invalid_random',
    'random must be a function',
  );
  assertPlanError(
    () => nextRetry(initialState(), { jitter: 'equal', baseDelayMs: 10 }, 0, 0.5),
    'invalid_random',
    'random must be a function',
  );
});

for (const value of [
  1,
  1.0000001,
  -0.0000001,
  Number.NaN,
  Infinity,
  -Infinity,
  '0.1',
  null,
  undefined,
  true,
  {},
]) {
  test(`rejects random sample ${label(value)}`, () => {
    rejectSample(value);
  });
}

test('a thrown random error propagates unchanged', () => {
  assert.throws(
    () =>
      nextRetry(initialState(), { jitter: 'full', baseDelayMs: 10, maxAttempts: 2 }, 0, () => {
        throw new Error('boom');
      }),
    (error) => {
      assert.equal(error instanceof Error, true);
      assert.equal(error.name, 'Error');
      assert.equal(error.message, 'boom');
      return true;
    },
  );
});

test('a promised sample is not a number', () => {
  rejectSample(Promise.resolve(0.2));
});

test('validation stops at the first failing stage', () => {
  let calls = 0;
  assertPlanError(
    () => nextRetry(null, null, Number.NaN),
    'invalid_state',
    'state must be a plain object',
  );
  assertPlanError(
    () => nextRetry({ attempt: -1, extra: 1 }, { jitter: 'nope' }, Number.NaN),
    'invalid_state',
    'unknown state field "extra"',
  );
  assertPlanError(
    () => nextRetry(initialState(), { jitter: 'nope' }, Number.NaN),
    'invalid_jitter',
    JITTER_MESSAGE,
  );
  assertPlanError(
    () => nextRetry(initialState(), { baseDelayMs: -1, multiplier: 0 }, 0),
    'invalid_base_delay',
    BASE_MESSAGE,
  );
  assertPlanError(
    () =>
      nextRetry(initialState(), { jitter: 'full' }, 1.5, () => {
        calls += 1;
        return 0;
      }),
    'invalid_now',
    NOW_MESSAGE,
  );
  assert.equal(calls, 0);
});
