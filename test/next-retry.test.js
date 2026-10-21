import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  DEFAULT_BASE_DELAY_MS,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_MAX_DELAY_MS,
  JITTER_EQUAL,
  JITTER_FULL,
  JITTER_NONE,
  REASON_DEADLINE,
  REASON_MAX_ATTEMPTS,
  initialState,
  nextRetry,
} from '../src/index.js';
import { assertGiveUp, assertPlanError, assertSuccess } from './helpers.js';

const GROWTH = {
  baseDelayMs: 100,
  multiplier: 2,
  maxDelayMs: 1000,
  maxAttempts: 20,
};

function plan(state, options, nowMs = 0, random) {
  return nextRetry(state, options, nowMs, random);
}

describe('capped exponential delay', () => {
  test('defaults plan eight uncapped doublings and then stop', () => {
    let state = initialState();
    const delays = [];
    for (let attempt = 0; attempt < DEFAULT_MAX_ATTEMPTS; attempt += 1) {
      const result = plan(state, {});
      delays.push(result.delayMs);
      assert.equal(result.giveUp, false);
      assert.equal(result.reason, null);
      state = result.state;
    }
    assert.deepEqual(delays, [100, 200, 400, 800, 1600, 3200, 6400, 12800]);
    assert.equal(state.attempt, DEFAULT_MAX_ATTEMPTS);
    assertGiveUp(plan(state, {}), DEFAULT_MAX_ATTEMPTS, REASON_MAX_ATTEMPTS);
  });

  test('default cap and multiplier are the values that produce the default sequence', () => {
    assertSuccess(plan({ attempt: 8 }, { maxAttempts: 20 }), 25600, 9);
    assertSuccess(plan({ attempt: 9 }, { maxAttempts: 20 }), DEFAULT_MAX_DELAY_MS, 10);
    assertSuccess(plan({ attempt: 40 }, { maxAttempts: 100 }), DEFAULT_MAX_DELAY_MS, 41);
    assert.equal(DEFAULT_BASE_DELAY_MS, 100);
  });

  test('undefined option fields use defaults and an undefined deadline is absent', () => {
    assertSuccess(
      plan(
        { attempt: 3 },
        {
          baseDelayMs: undefined,
          multiplier: undefined,
          maxDelayMs: undefined,
          maxAttempts: undefined,
          deadlineMs: undefined,
          jitter: undefined,
        },
      ),
      800,
      4,
    );
  });

  test('a deadline of zero is present', () => {
    assertGiveUp(plan({ attempt: 3 }, { deadlineMs: 0 }), 3, REASON_DEADLINE);
  });

  test('numeric table', () => {
    const rows = [
      [{ baseDelayMs: 100, multiplier: 2, maxDelayMs: 30000, attempt: 0 }, 100],
      [{ baseDelayMs: 100, multiplier: 2, maxDelayMs: 30000, attempt: 8 }, 25600],
      [{ baseDelayMs: 100, multiplier: 2, maxDelayMs: 30000, attempt: 9 }, 30000],
      [{ baseDelayMs: 10, multiplier: 1.5, maxDelayMs: 100000, attempt: 0 }, 10],
      [{ baseDelayMs: 10, multiplier: 1.5, maxDelayMs: 100000, attempt: 1 }, 15],
      [{ baseDelayMs: 10, multiplier: 1.5, maxDelayMs: 100000, attempt: 2 }, 22],
      [{ baseDelayMs: 10, multiplier: 1.5, maxDelayMs: 100000, attempt: 3 }, 33],
      [{ baseDelayMs: 10, multiplier: 1.5, maxDelayMs: 100000, attempt: 4 }, 50],
      [{ baseDelayMs: 10, multiplier: 1.5, maxDelayMs: 100000, attempt: 5 }, 75],
      [{ baseDelayMs: 10, multiplier: 1.5, maxDelayMs: 100000, attempt: 6 }, 113],
      [{ baseDelayMs: 1, multiplier: 1.25, maxDelayMs: 100000, attempt: 8 }, 5],
      [{ baseDelayMs: 3, multiplier: 1.1, maxDelayMs: 1000, attempt: 40 }, 135],
      [{ baseDelayMs: 0, multiplier: 9, maxDelayMs: 1000, attempt: 6 }, 0],
      [{ baseDelayMs: 80, multiplier: 9, maxDelayMs: 0, attempt: 2 }, 0],
      [{ baseDelayMs: 500, multiplier: 2, maxDelayMs: 120, attempt: 0 }, 120],
      [{ baseDelayMs: 500, multiplier: 2, maxDelayMs: 120, attempt: 4 }, 120],
      [{ baseDelayMs: 42, multiplier: 1, maxDelayMs: 1000, attempt: 100000 }, 42],
      [{ baseDelayMs: 10, multiplier: 1e308, maxDelayMs: 1000, attempt: 0 }, 10],
      [{ baseDelayMs: 10, multiplier: 1e308, maxDelayMs: 1000, attempt: 1 }, 1000],
      [{ baseDelayMs: 100, multiplier: 1.0000001, maxDelayMs: 1000, attempt: 100000 }, 101],
      [{ baseDelayMs: 100, multiplier: 1.001, maxDelayMs: 1000, attempt: 10000 }, 1000],
    ];
    for (const [options, expected] of rows) {
      const { attempt, ...rest } = options;
      const result = plan({ attempt }, { ...rest, maxAttempts: attempt + 1, jitter: JITTER_NONE });
      assert.equal(result.delayMs, expected, JSON.stringify(options));
      assert.equal(result.giveUp, false);
    }
  });

  test('powers of two stay exact until the cap', () => {
    const delays = [];
    for (let attempt = 0; attempt <= 12; attempt += 1) {
      delays.push(
        plan({ attempt }, { baseDelayMs: 100, multiplier: 2, maxDelayMs: 30000, maxAttempts: 30 })
          .delayMs,
      );
    }
    assert.deepEqual(
      delays,
      [100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600, 30000, 30000, 30000, 30000],
    );
  });
});

describe('jitter', () => {
  test('none ignores random', () => {
    assertSuccess(
      plan(initialState(), { ...GROWTH, jitter: JITTER_NONE }, 0, () => {
        throw new Error('random should not be called');
      }),
      100,
      1,
    );
  });

  test('default jitter is none', () => {
    assertSuccess(
      plan(initialState(), {}, 0, () => {
        throw new Error('random should not be called');
      }),
      100,
      1,
    );
  });

  test('a single-value range does not sample', () => {
    const random = () => {
      throw new Error('random should not be called');
    };
    assertSuccess(
      plan(initialState(), { baseDelayMs: 0, jitter: JITTER_FULL, maxAttempts: 2 }, 0, random),
      0,
      1,
    );
    assertSuccess(
      plan(initialState(), { baseDelayMs: 0, jitter: JITTER_EQUAL, maxAttempts: 2 }, 0, random),
      0,
      1,
    );
    assertSuccess(
      plan(
        initialState(),
        { baseDelayMs: 8, maxDelayMs: 0, jitter: JITTER_FULL, maxAttempts: 2 },
        0,
        random,
      ),
      0,
      1,
    );
  });

  test('exact full and equal samples', () => {
    const rows = [
      [JITTER_FULL, 100, 0, 0],
      [JITTER_FULL, 100, 0.25, 25],
      [JITTER_FULL, 100, 0.5, 50],
      [JITTER_FULL, 100, 1 - Number.EPSILON, 100],
      [JITTER_EQUAL, 100, 0, 50],
      [JITTER_EQUAL, 100, 0.5, 75],
      [JITTER_EQUAL, 100, 1 - Number.EPSILON, 100],
      [JITTER_EQUAL, 1, 0, 0],
      [JITTER_EQUAL, 1, 0.5, 1],
      [JITTER_EQUAL, 7, 0, 3],
      [JITTER_FULL, 7, 0.5, 4],
      [JITTER_NONE, 100, 0.5, 100],
    ];
    for (const [jitter, capped, sample, expected] of rows) {
      const result = plan(
        initialState(),
        { baseDelayMs: capped, maxDelayMs: capped, multiplier: 1, maxAttempts: 2, jitter },
        0,
        () => sample,
      );
      assert.equal(result.delayMs, expected, `${jitter} ${capped} ${sample}`);
    }
  });

  test('successive full and equal sequences are deterministic', () => {
    function sequence(jitter, sample) {
      const random = () => sample;
      let state = initialState();
      const delays = [];
      for (let i = 0; i < 4; i += 1) {
        const result = plan(
          state,
          { jitter, baseDelayMs: 100, multiplier: 2, maxDelayMs: 10000, maxAttempts: 10 },
          0,
          random,
        );
        delays.push(result.delayMs);
        state = result.state;
      }
      return delays;
    }
    assert.deepEqual(sequence(JITTER_NONE, 0.25), [100, 200, 400, 800]);
    assert.deepEqual(sequence(JITTER_FULL, 0.25), [25, 50, 100, 200]);
    assert.deepEqual(sequence(JITTER_EQUAL, 0), [50, 100, 200, 400]);
    assert.deepEqual(sequence(JITTER_FULL, 0.25), sequence(JITTER_FULL, 0.25));
  });

  test('sampled delays stay inside the integer range', () => {
    const samples = [0, Number.MIN_VALUE, 0.25, 0.5, 0.75, 1 - Number.EPSILON];
    const random = mulberry32(0x12345678);
    for (let i = 0; i < 40; i += 1) {
      samples.push(random());
    }
    const optionSets = [
      { baseDelayMs: 1, multiplier: 2, maxDelayMs: 1000 },
      { baseDelayMs: 10, multiplier: 1.5, maxDelayMs: 500 },
      { baseDelayMs: 100, multiplier: 2, maxDelayMs: 30000 },
      { baseDelayMs: 7, multiplier: 1.1, maxDelayMs: 40 },
      { baseDelayMs: 0, multiplier: 2, maxDelayMs: 100 },
      { baseDelayMs: 5, multiplier: 3, maxDelayMs: 5 },
      { baseDelayMs: Number.MAX_SAFE_INTEGER, multiplier: 2, maxDelayMs: Number.MAX_SAFE_INTEGER },
    ];
    for (const partial of optionSets) {
      for (const attempt of [0, 1, 2, 3, 6]) {
        const capped = plan(
          { attempt },
          { ...partial, jitter: JITTER_NONE, maxAttempts: 100 },
        ).delayMs;
        const lower = Math.floor(capped / 2);
        for (const sample of samples) {
          const full = plan(
            { attempt },
            { ...partial, jitter: JITTER_FULL, maxAttempts: 100 },
            0,
            () => sample,
          );
          assert.equal(full.giveUp, false);
          assert.equal(Number.isSafeInteger(full.delayMs), true, `full ${sample} ${capped}`);
          assert.ok(
            full.delayMs >= 0 && full.delayMs <= capped && full.delayMs <= partial.maxDelayMs,
            `full ${JSON.stringify(partial)} attempt ${attempt} sample ${sample} -> ${full.delayMs}`,
          );
          const equal = plan(
            { attempt },
            { ...partial, jitter: JITTER_EQUAL, maxAttempts: 100 },
            0,
            () => sample,
          );
          assert.equal(equal.giveUp, false);
          assert.equal(Number.isSafeInteger(equal.delayMs), true);
          assert.ok(
            equal.delayMs >= lower && equal.delayMs <= capped,
            `equal ${JSON.stringify(partial)} attempt ${attempt} sample ${sample} -> ${equal.delayMs}`,
          );
          assert.equal(full.state.attempt, attempt + 1);
          assert.equal(equal.state.attempt, attempt + 1);
        }
      }
    }
  });

  test('each sampled call consumes one random value', () => {
    const values = [0, 0.5, 0.25];
    let index = 0;
    const random = () => {
      const value = values[index];
      index += 1;
      return value;
    };
    const options = {
      jitter: JITTER_FULL,
      baseDelayMs: 100,
      multiplier: 1,
      maxDelayMs: 100,
      maxAttempts: 5,
    };
    assertSuccess(plan(initialState(), options, 0, random), 0, 1);
    assertSuccess(plan({ attempt: 1 }, options, 0, random), 50, 2);
    assertSuccess(plan({ attempt: 2 }, options, 0, random), 25, 3);
    assert.equal(index, 3);
  });
});

describe('give up', () => {
  test('maxAttempts zero gives up before a deadline or a sample', () => {
    let calls = 0;
    assertGiveUp(
      plan({ attempt: 0 }, { maxAttempts: 0, deadlineMs: -1, jitter: JITTER_FULL }, 0, () => {
        calls += 1;
        return 0;
      }),
      0,
      REASON_MAX_ATTEMPTS,
    );
    assert.equal(calls, 0);
  });

  test('negative zero maxAttempts allows no retries', () => {
    assertGiveUp(plan(initialState(), { maxAttempts: -0 }), 0, REASON_MAX_ATTEMPTS);
  });

  test('one attempt is planned and the next call stops', () => {
    const options = { maxAttempts: 1, jitter: JITTER_NONE, baseDelayMs: 15 };
    const first = plan(initialState(), options);
    assertSuccess(first, 15, 1);
    assertGiveUp(plan(first.state, options), 1, REASON_MAX_ATTEMPTS);
  });

  test('max_attempts wins when the deadline has also passed', () => {
    let calls = 0;
    const result = plan(
      { attempt: 3 },
      { maxAttempts: 3, deadlineMs: -1, jitter: JITTER_FULL },
      0,
      () => {
        calls += 1;
        return 0;
      },
    );
    assertGiveUp(result, 3, REASON_MAX_ATTEMPTS);
    assert.equal(calls, 0);
    assert.equal(result.reason, 'max_attempts');
  });

  test('the attempt limit keeps the counter unchanged', () => {
    const state = { attempt: 8 };
    const result = plan(state, {});
    assertGiveUp(result, 8, 'max_attempts');
    assert.equal(state.attempt, 8);
    assert.notEqual(result.state, state);
  });

  test('a time already past the deadline does not sample', () => {
    for (const jitter of [JITTER_NONE, JITTER_FULL, JITTER_EQUAL]) {
      let calls = 0;
      const result = plan(
        initialState(),
        { jitter, deadlineMs: 9, maxAttempts: 4, baseDelayMs: 100 },
        10,
        () => {
          calls += 1;
          return 0;
        },
      );
      assertGiveUp(result, 0, REASON_DEADLINE);
      assert.equal(calls, 0, jitter);
    }
  });

  test('full jitter can still fit inside a short remaining window', () => {
    const options = {
      baseDelayMs: 1000,
      maxDelayMs: 1000,
      multiplier: 1,
      maxAttempts: 3,
      jitter: JITTER_FULL,
      deadlineMs: 10,
    };
    let calls = 0;
    assertSuccess(
      plan(initialState(), options, 0, () => {
        calls += 1;
        return 0;
      }),
      0,
      1,
    );
    assertSuccess(
      plan(initialState(), options, 0, () => {
        calls += 1;
        return 10 / 1001;
      }),
      10,
      1,
    );
    assertGiveUp(
      plan(initialState(), options, 0, () => {
        calls += 1;
        return 11 / 1001;
      }),
      0,
      REASON_DEADLINE,
    );
    assert.equal(calls, 3);
  });

  test('equal jitter gives up without sampling when the lower half is already late', () => {
    let calls = 0;
    const options = {
      baseDelayMs: 100,
      maxDelayMs: 100,
      multiplier: 1,
      jitter: JITTER_EQUAL,
      deadlineMs: 49,
      maxAttempts: 3,
    };
    assertGiveUp(
      plan(initialState(), options, 0, () => {
        calls += 1;
        return 0;
      }),
      0,
      REASON_DEADLINE,
    );
    assert.equal(calls, 0);
    assertSuccess(
      plan(initialState(), { ...options, deadlineMs: 50 }, 0, () => 0),
      50,
      1,
    );
    let sampled = 0;
    assertGiveUp(
      plan(initialState(), { ...options, deadlineMs: 50 }, 0, () => {
        sampled += 1;
        return 1 - Number.EPSILON;
      }),
      0,
      REASON_DEADLINE,
    );
    assert.equal(sampled, 1);
  });

  test('the same sample is kept only when it lands on or before the deadline', () => {
    const samples = [0, 0.25, 0.5, 0.75, 1 - Number.EPSILON];
    const nowMs = 5000;
    for (const jitter of [JITTER_NONE, JITTER_FULL, JITTER_EQUAL]) {
      for (const sample of samples) {
        const baseOptions = {
          baseDelayMs: 100,
          multiplier: 2,
          maxDelayMs: 1000,
          maxAttempts: 5,
          jitter,
        };
        const open = plan(initialState(), baseOptions, nowMs, () => sample);
        const delay = open.delayMs;
        const onTime = plan(
          initialState(),
          { ...baseOptions, deadlineMs: nowMs + delay },
          nowMs,
          () => sample,
        );
        assert.equal(onTime.giveUp, false, `${jitter} ${sample}`);
        assert.equal(onTime.delayMs, delay);
        const late = plan(
          initialState(),
          { ...baseOptions, deadlineMs: nowMs + delay - 1 },
          nowMs,
          () => sample,
        );
        assertGiveUp(late, 0, REASON_DEADLINE);
      }
    }
  });

  test('zero delay is allowed at the deadline instant', () => {
    assertSuccess(
      plan(
        initialState(),
        { baseDelayMs: 0, maxDelayMs: 0, jitter: JITTER_NONE, deadlineMs: 20, maxAttempts: 3 },
        20,
      ),
      0,
      1,
    );
    assertGiveUp(
      plan(
        initialState(),
        { baseDelayMs: 0, maxDelayMs: 0, jitter: JITTER_NONE, deadlineMs: 20, maxAttempts: 3 },
        21,
      ),
      0,
      REASON_DEADLINE,
    );
    assertSuccess(
      plan(
        initialState(),
        { baseDelayMs: 100, jitter: JITTER_FULL, deadlineMs: 50, maxAttempts: 3 },
        50,
        () => 0,
      ),
      0,
      1,
    );
    assertGiveUp(
      plan(
        initialState(),
        { baseDelayMs: 100, jitter: JITTER_FULL, deadlineMs: 50, maxAttempts: 3 },
        50,
        () => 0.5,
      ),
      0,
      REASON_DEADLINE,
    );
  });

  test('negative timestamps use the same inclusive deadline', () => {
    assertSuccess(
      plan(
        initialState(),
        { baseDelayMs: 25, jitter: JITTER_NONE, deadlineMs: -15, maxAttempts: 3, multiplier: 1 },
        -40,
      ),
      25,
      1,
    );
    assertGiveUp(
      plan(
        initialState(),
        { baseDelayMs: 25, jitter: JITTER_NONE, deadlineMs: -20, maxAttempts: 3, multiplier: 1 },
        -40,
      ),
      0,
      REASON_DEADLINE,
    );
  });

  test('safe integer boundaries do not overflow the comparison', () => {
    const max = Number.MAX_SAFE_INTEGER;
    assertSuccess(
      plan(
        initialState(),
        { baseDelayMs: 100, jitter: JITTER_NONE, deadlineMs: max, maxAttempts: 2 },
        max - 100,
      ),
      100,
      1,
    );
    assertGiveUp(
      plan(
        initialState(),
        { baseDelayMs: 100, jitter: JITTER_NONE, deadlineMs: max, maxAttempts: 2 },
        max - 10,
      ),
      0,
      REASON_DEADLINE,
    );
    assertSuccess(
      plan(
        initialState(),
        {
          baseDelayMs: 0,
          jitter: JITTER_NONE,
          deadlineMs: Number.MIN_SAFE_INTEGER,
          maxAttempts: 2,
        },
        Number.MIN_SAFE_INTEGER,
      ),
      0,
      1,
    );
    assertGiveUp(
      plan(
        initialState(),
        {
          baseDelayMs: 100,
          jitter: JITTER_NONE,
          deadlineMs: Number.MIN_SAFE_INTEGER,
          maxAttempts: 2,
        },
        Number.MIN_SAFE_INTEGER,
      ),
      0,
      REASON_DEADLINE,
    );
  });

  test('documented caller loop caps and then hits the deadline', () => {
    const options = {
      baseDelayMs: 200,
      multiplier: 2,
      maxDelayMs: 1000,
      maxAttempts: 8,
      deadlineMs: 3000,
      jitter: JITTER_NONE,
    };
    let state = initialState();
    let nowMs = 0;
    const plans = [];
    let current = plan(state, options, nowMs);
    plans.push(current);
    while (!current.giveUp) {
      nowMs += current.delayMs;
      state = current.state;
      current = plan(state, options, nowMs);
      plans.push(current);
    }
    assert.deepEqual(plans, [
      { delayMs: 200, state: { attempt: 1 }, giveUp: false, reason: null },
      { delayMs: 400, state: { attempt: 2 }, giveUp: false, reason: null },
      { delayMs: 800, state: { attempt: 3 }, giveUp: false, reason: null },
      { delayMs: 1000, state: { attempt: 4 }, giveUp: false, reason: null },
      { delayMs: null, state: { attempt: 4 }, giveUp: true, reason: 'deadline' },
    ]);
    assert.equal(nowMs, 2400);
  });
});

describe('purity and state', () => {
  test('repeated calls with the same inputs match and do not share result objects', () => {
    const state = initialState();
    const options = {
      jitter: JITTER_FULL,
      baseDelayMs: 100,
      maxAttempts: 4,
      maxDelayMs: 100,
      multiplier: 1,
    };
    const random = () => 0.5;
    const first = plan(state, options, 10, random);
    const second = plan(state, options, 10, random);
    assert.deepEqual(first, second);
    assert.notEqual(first, second);
    assert.notEqual(first.state, second.state);
    assertSuccess(first, 50, 1);
    first.delayMs = 999;
    first.state.attempt = 99;
    assertSuccess(plan(state, options, 10, random), 50, 1);
    assert.equal(state.attempt, 0);
  });

  test('give-up results are equal and distinct', () => {
    const state = { attempt: 4 };
    const options = { maxAttempts: 4 };
    const first = plan(state, options);
    const second = plan(state, options);
    assert.deepEqual(first, second);
    assert.notEqual(first, second);
    assert.notEqual(first.state, second.state);
    assert.equal(state.attempt, 4);
  });

  test('frozen inputs are not mutated', () => {
    const state = { attempt: 2 };
    const options = {
      baseDelayMs: 100,
      multiplier: 2,
      maxDelayMs: 1000,
      maxAttempts: 10,
      jitter: JITTER_FULL,
      deadlineMs: 10000,
    };
    Object.freeze(state);
    Object.freeze(options);
    const result = plan(state, options, 0, () => 0.5);
    assertSuccess(result, Math.floor(0.5 * 401), 3);
    assert.equal(state.attempt, 2);
  });

  test('mutation during sampling does not change values already read', () => {
    const state = { attempt: 1 };
    const options = {
      jitter: JITTER_FULL,
      baseDelayMs: 80,
      maxDelayMs: 80,
      multiplier: 1,
      maxAttempts: 5,
    };
    const result = plan(state, options, 0, () => {
      state.attempt = 4;
      options.baseDelayMs = 1;
      options.maxDelayMs = 1;
      return 0.5;
    });
    assertSuccess(result, 40, 2);
    assert.equal(state.attempt, 4);
  });

  test('null-prototype records and a non-enumerable attempt are accepted', () => {
    const state = Object.create(null);
    Object.defineProperty(state, 'attempt', { value: 2, enumerable: false });
    const options = Object.create(null);
    options.baseDelayMs = 40;
    options.maxAttempts = 5;
    options.jitter = JITTER_NONE;
    assertSuccess(plan(state, options), 160, 3);
  });

  test('negative zero attempt and base delay become zero', () => {
    const state = { attempt: -0 };
    assertSuccess(plan(state, { baseDelayMs: -0, maxAttempts: 2, jitter: JITTER_NONE }), 0, 1);
    assert.equal(Object.is(state.attempt, -0), true);
  });

  test('state survives a JSON round trip', () => {
    const first = plan(initialState(), {});
    const restored = JSON.parse(JSON.stringify(first.state));
    assertSuccess(plan(restored, {}), 200, 2);
    const stopped = plan({ attempt: 8 }, {});
    assert.equal(JSON.parse(JSON.stringify(stopped)).delayMs, null);
    assert.equal(JSON.parse(JSON.stringify(stopped)).reason, 'max_attempts');
  });

  test('a huge attempt still returns the cap', () => {
    assertSuccess(
      plan(
        { attempt: Number.MAX_SAFE_INTEGER - 1 },
        {
          maxAttempts: Infinity,
          baseDelayMs: 100,
          multiplier: 2,
          maxDelayMs: 1000,
          jitter: JITTER_NONE,
        },
      ),
      1000,
      Number.MAX_SAFE_INTEGER,
    );
  });

  test('a flat multiplier stays fast at the end of the safe integer range', () => {
    assertSuccess(
      plan(
        { attempt: Number.MAX_SAFE_INTEGER - 1 },
        {
          maxAttempts: Infinity,
          baseDelayMs: 42,
          multiplier: 1,
          maxDelayMs: 1000,
          jitter: JITTER_NONE,
        },
      ),
      42,
      Number.MAX_SAFE_INTEGER,
    );
  });

  test('the attempt counter cannot advance past the safe integer range', () => {
    let calls = 0;
    assertPlanError(
      () =>
        plan(
          { attempt: Number.MAX_SAFE_INTEGER },
          { maxAttempts: Infinity, jitter: JITTER_FULL },
          0,
          () => {
            calls += 1;
            return 0;
          },
        ),
      'attempt_overflow',
      'state.attempt cannot advance past Number.MAX_SAFE_INTEGER',
    );
    assert.equal(calls, 0);
    assertGiveUp(
      plan(
        { attempt: Number.MAX_SAFE_INTEGER },
        { maxAttempts: Number.MAX_SAFE_INTEGER, jitter: JITTER_FULL },
        0,
        () => {
          throw new Error('random should not be called');
        },
      ),
      Number.MAX_SAFE_INTEGER,
      REASON_MAX_ATTEMPTS,
    );
  });

  test('Infinity maxAttempts plans the first delay', () => {
    assertSuccess(plan(initialState(), { maxAttempts: Infinity }), 100, 1);
  });

  test('the same now is compared independently on every call', () => {
    const options = {
      baseDelayMs: 100,
      multiplier: 2,
      maxDelayMs: 1000,
      maxAttempts: 5,
      deadlineMs: 150,
    };
    const first = plan(initialState(), options, 0);
    assertSuccess(first, 100, 1);
    assertGiveUp(plan(first.state, options, 0), 1, REASON_DEADLINE);
  });
});

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) | 0;
    let mixed = Math.imul(value ^ (value >>> 15), 1 | value);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}
