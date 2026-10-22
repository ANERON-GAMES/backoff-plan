# @aneron/backoff-plan

Plan capped exponential backoff delays, apply jitter, and decide when to give up.
The package is a pure function: it does not sleep, draw random numbers, read a clock, or perform I/O.

## Purpose

`nextRetry` answers one question: given how many retries have already been planned, the current time, and the caller's limits, what delay should precede the next retry, or should the caller stop?

The delay grows exponentially from a base, is capped, and can be jittered. The caller supplies `nowMs` and, when a sample is needed, `random`, so a test can reproduce every result. Applying the delay is intentionally left to the caller.

There are no runtime dependencies.

## Install

```sh
npm install github:ANERON-GAMES/backoff-plan
```

The package name is `@aneron/backoff-plan`. It is ESM and requires Node.js 20 or newer.

## Usage

```js
import { initialState, nextRetry, JITTER_NONE } from '@aneron/backoff-plan';

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

let plan = nextRetry(state, options, nowMs);
plans.push(plan);

while (!plan.giveUp) {
  nowMs += plan.delayMs;
  state = plan.state;
  plan = nextRetry(state, options, nowMs);
  plans.push(plan);
}
```

With those inputs the plans are:

```js
[
  { delayMs: 200, state: { attempt: 1 }, giveUp: false, reason: null },
  { delayMs: 400, state: { attempt: 2 }, giveUp: false, reason: null },
  { delayMs: 800, state: { attempt: 3 }, giveUp: false, reason: null },
  { delayMs: 1000, state: { attempt: 4 }, giveUp: false, reason: null },
  { delayMs: null, state: { attempt: 4 }, giveUp: true, reason: 'deadline' },
];
```

The fourth delay is capped at `1000`. The fifth call stops because `2400 + 1000` is after the deadline. `state.attempt` does not advance when the call gives up.

Jitter uses the injected sample. A constant `random` makes the sequence deterministic:

```js
import { initialState, nextRetry, JITTER_FULL, JITTER_EQUAL } from '@aneron/backoff-plan';

const shared = {
  baseDelayMs: 100,
  multiplier: 2,
  maxDelayMs: 1000,
  maxAttempts: 4,
};

nextRetry(initialState(), { ...shared, jitter: JITTER_FULL }, 0, () => 0.25);
// { delayMs: 25, state: { attempt: 1 }, giveUp: false, reason: null }

nextRetry(initialState(), { ...shared, jitter: JITTER_EQUAL }, 0, () => 0);
// { delayMs: 50, state: { attempt: 1 }, giveUp: false, reason: null }
```

`delayMs` is how long the caller waits before the next retry. `0` means the next retry can run immediately. `null` means there is no delay because the call gave up. This package does not wait.

Invalid input throws `BackoffPlanError`:

```js
import { BackoffPlanError, initialState, nextRetry } from '@aneron/backoff-plan';

try {
  nextRetry(initialState(), { jitter: 'sometimes' }, 0);
} catch (error) {
  if (error instanceof BackoffPlanError) {
    error.code; // "invalid_jitter"
    error.message; // jitter must be "none", "full", or "equal"
  } else {
    throw error;
  }
}
```

## API

### `nextRetry(state, options, nowMs, random)`

Returns the plan for one retry.

| Argument  | Required                       | Meaning                                                                              |
| --------- | ------------------------------ | ------------------------------------------------------------------------------------ |
| `state`   | yes                            | Plain object `{ attempt }`. `attempt` is how many retries have already been planned. |
| `options` | yes                            | Plain object of limits. Omitted fields use the named defaults.                       |
| `nowMs`   | yes                            | Current time in milliseconds on a timeline chosen by the caller.                     |
| `random`  | only when a sample is required | Function returning a number in `[0, 1)`. Called at most once.                        |

`initialState()` is the usual first `state`. Any plain object with a valid `attempt` is accepted, including one restored from JSON.

On success the result is:

```js
{ delayMs: 200, state: { attempt: 1 }, giveUp: false, reason: null }
```

On give-up the result is:

```js
{ delayMs: null, state: { attempt: 4 }, giveUp: true, reason: 'deadline' }
```

| Field     | Type                                      | Meaning                                                                        |
| --------- | ----------------------------------------- | ------------------------------------------------------------------------------ |
| `delayMs` | non-negative safe integer, or `null`      | Wait before the next retry. `null` when `giveUp` is true. `0` is a real delay. |
| `state`   | `{ attempt }`                             | Next state. A new object on every call.                                        |
| `giveUp`  | boolean                                   | Whether the caller should stop.                                                |
| `reason`  | `'max_attempts'`, `'deadline'`, or `null` | Why the caller should stop. `null` when `giveUp` is false.                     |

`reason` is `null` on success. The strings are also exported as `REASON_MAX_ATTEMPTS` and `REASON_DEADLINE`.

The result and the next state are plain objects owned by the caller. Inputs are not mutated. The same arguments and the same random sequence always produce the same result.

### `initialState()`

Returns a new `{ attempt: 0 }`. Each call returns a distinct object.

`attempt` `0` means no retry has been planned yet. A successful call returns `attempt + 1`.

### `BackoffPlanError`

```js
new BackoffPlanError(code, message);
```

Thrown for invalid input and when a successful plan would push `attempt` past `Number.MAX_SAFE_INTEGER`. It extends `Error`. `name` is `'BackoffPlanError'`. `code` is a stable string. `message` is a stable description.

An exception thrown by `random` is not wrapped.

### Constants

| Export                  | Value            |
| ----------------------- | ---------------- |
| `DEFAULT_BASE_DELAY_MS` | `100`            |
| `DEFAULT_MULTIPLIER`    | `2`              |
| `DEFAULT_MAX_DELAY_MS`  | `30000`          |
| `DEFAULT_MAX_ATTEMPTS`  | `8`              |
| `DEFAULT_JITTER`        | `'none'`         |
| `JITTER_NONE`           | `'none'`         |
| `JITTER_FULL`           | `'full'`         |
| `JITTER_EQUAL`          | `'equal'`        |
| `REASON_MAX_ATTEMPTS`   | `'max_attempts'` |
| `REASON_DEADLINE`       | `'deadline'`     |

`DEFAULTS` is a frozen object:

```js
{
  baseDelayMs: 100,
  multiplier: 2,
  maxDelayMs: 30000,
  maxAttempts: 8,
  jitter: 'none',
}
```

There is no default deadline. There is no default `random` and no default clock.

### Options

All option keys are optional. An omitted key, or a key whose value is `undefined`, uses the default. `null` is never a default. Unknown keys, including symbol keys and non-enumerable keys, are rejected. Only own properties are read. The object must be a plain object: its prototype is `Object.prototype` or `null`.

| Option        | Default  | Accepted values                                                                    |
| ------------- | -------- | ---------------------------------------------------------------------------------- |
| `baseDelayMs` | `100`    | Non-negative safe integer.                                                         |
| `multiplier`  | `2`      | Finite number greater than or equal to `1`. Integers and fractions are both valid. |
| `maxDelayMs`  | `30000`  | Non-negative safe integer. May be smaller than `baseDelayMs`; the cap wins.        |
| `maxAttempts` | `8`      | Non-negative safe integer, or `Infinity`.                                          |
| `deadlineMs`  | none     | Safe integer, including negative values. Omit it to disable the deadline.          |
| `jitter`      | `'none'` | `'none'`, `'full'`, or `'equal'`.                                                  |

`maxAttempts` is the number of successful plans allowed. `0` gives up immediately. After `maxAttempts` successful calls, the next call gives up with `max_attempts`. `Infinity` removes the attempt limit.

`nowMs` and `deadlineMs` are absolute milliseconds on the same timeline. Any origin is fine. The package does not treat them as a particular epoch.

### State

| Field     | Accepted values                      |
| --------- | ------------------------------------ |
| `attempt` | Non-negative safe integer. Required. |

Negative zero is accepted and treated as zero. Unknown fields are rejected. The next state contains only `attempt`.

### Jitter

The pre-jitter delay `capped` is an integer millisecond value:

```text
if maxDelayMs is 0 or baseDelayMs is 0:
  capped = 0
else if baseDelayMs >= maxDelayMs, or attempt is 0, or multiplier is 1:
  capped = min(baseDelayMs, maxDelayMs)
else:
  raw = baseDelayMs * multiplier ** attempt
  if raw is not finite or raw >= maxDelayMs:
    capped = maxDelayMs
  else:
    capped = floor(raw)
```

`**` and `floor` are IEEE-754 `Math` operations. Fractional multipliers can therefore land just below an integer; the delay uses the floor of that product. The cap is applied before jitter, so a jittered delay never exceeds `maxDelayMs` or `capped`.

The inclusive integer range is:

| Mode    | Range                                |
| ------- | ------------------------------------ |
| `none`  | `capped` only                        |
| `full`  | `0` through `capped`                 |
| `equal` | `floor(capped / 2)` through `capped` |

`none` returns `capped`. For `full` and `equal`, when the range contains more than one integer, one sample `s` in `[0, 1)` is mapped with:

```text
width = upper - lower
offset = floor(s * (width + 1))
if offset is not finite or offset > width:
  delay = upper
else if offset <= 0:
  delay = lower
else:
  delay = lower + offset
```

`full` uses `lower = 0` and `upper = capped`. `equal` uses `lower = floor(capped / 2)` and `upper = capped`. Values in the range are reachable, including both ends, for ordinary retry delays. The mapping is clamped into the range so float rounding cannot emit a delay outside it.

`random` is called only when that range contains more than one integer and the smallest delay can still meet the deadline. It is not called for `none`, for a range that has only one integer, after `max_attempts`, or when even the smallest delay is already past the deadline. When it is called, it must be a function and its return value must be a finite number in `[0, 1)`. The package never calls `Math.random`.

### Give-up rules

Checks run in this order. The first match wins, and later steps do not run.

1. Validate `state`, then `options`, then `nowMs`.
2. If `attempt >= maxAttempts`, give up with `max_attempts`. `random` is not called.
3. If `attempt` is `Number.MAX_SAFE_INTEGER`, throw `attempt_overflow`. This is only reachable when `maxAttempts` is `Infinity`.
4. Compute `capped` and the jitter range.
5. If a deadline is set and `nowMs + lower > deadlineMs`, give up with `deadline` without sampling. `lower` is the smallest delay in the jitter range.
6. If the range has more than one integer, draw one sample and map it. An invalid sample throws. An exception from `random` propagates.
7. If a deadline is set and `nowMs + delayMs > deadlineMs`, give up with `deadline`. The sample has been consumed.
8. Otherwise return `delayMs` and `{ attempt: attempt + 1 }`.

The addition uses exact integer arithmetic. A planned time equal to the deadline is allowed. A delay of `0` at `nowMs === deadlineMs` is a success. If `nowMs` is already greater than `deadlineMs`, every non-negative delay is late, so the call gives up with `deadline` and does not sample.

Each call is independent. Previous delays are not stored. To move the clock forward, the caller adds the returned delay to its own `nowMs` and passes that value on the next call. Passing the same `nowMs` again compares every delay with the same instant.

### Errors

Validation reports the first problem in the order above. Option fields are checked in the order `baseDelayMs`, `multiplier`, `maxDelayMs`, `maxAttempts`, `deadlineMs`, `jitter`. Unknown keys are reported before field values. When several unknown keys are present, the lexicographically first string key is the one named in the message.

| `code`                 | `message`                                                       |
| ---------------------- | --------------------------------------------------------------- |
| `invalid_state`        | `state must be a plain object`                                  |
| `invalid_state`        | `unknown state field "<name>"`                                  |
| `invalid_state`        | `state must not contain symbol keys`                            |
| `invalid_attempt`      | `state.attempt must be a non-negative safe integer`             |
| `invalid_options`      | `options must be a plain object`                                |
| `unknown_option`       | `unknown option "<name>"`                                       |
| `unknown_option`       | `options must not contain symbol keys`                          |
| `invalid_base_delay`   | `baseDelayMs must be a non-negative safe integer`               |
| `invalid_multiplier`   | `multiplier must be a finite number greater than or equal to 1` |
| `invalid_max_delay`    | `maxDelayMs must be a non-negative safe integer`                |
| `invalid_max_attempts` | `maxAttempts must be a non-negative safe integer or Infinity`   |
| `invalid_deadline`     | `deadlineMs must be a safe integer`                             |
| `invalid_jitter`       | `jitter must be "none", "full", or "equal"`                     |
| `invalid_now`          | `nowMs must be a safe integer`                                  |
| `invalid_random`       | `random must be a function`                                     |
| `invalid_sample`       | `random must return a finite number in [0, 1)`                  |
| `attempt_overflow`     | `state.attempt cannot advance past Number.MAX_SAFE_INTEGER`     |

## Behavior and limits

- Delays are integer milliseconds. The return value on success is a safe integer in the jitter range.
- The attempt counter, the base, the cap, `nowMs`, and `deadlineMs` must be safe integers so the deadline comparison is exact.
- `multiplier` must be finite and at least `1`, so the uncapped sequence does not shrink. `1` keeps the delay flat at the base until the cap.
- Exponentiation follows IEEE-754 and does not loop. A multiplier such as `2` reaches the cap quickly. A multiplier only slightly above `1` can grow slowly, and the computed power can be far from the real number; the delay is the floor of that product, then the cap.
- Negative zero is treated as zero for `attempt` and for delays.
- `giveUp: true` uses `delayMs: null`. It is not the same as a delay of `0`.
- The package does not schedule work, retry an operation, log, read the environment, or touch the network or the filesystem.
- `random` must return a number synchronously. A returned promise is an invalid sample.
- `Math.random` and `Date.now` are never called.
- Node.js 20 or newer is required. The package is ESM and has no runtime dependencies.
- Continuous integration runs lint, a format check, and the test suite on Node 20 and Node 22.

## Design notes

The plan is separate from the wait. A scheduler needs a clock and a timer; a test needs neither inside the planner. Injecting `nowMs` and `random` keeps every branch reproducible, including give-up.

The cap is applied before jitter so spreading the delay cannot break `maxDelayMs`. Full jitter includes `0`, which allows an immediate retry. Equal jitter keeps `floor(capped / 2)` as its minimum, so a grown delay does not collapse all the way to zero unless the capped delay itself is `0` or `1`.

`max_attempts` is checked before the deadline. When both apply, the reason stays `max_attempts`. The minimum of the jitter range is checked before sampling, so a call that cannot meet the deadline does not consume a random value. A sampled delay that misses the deadline does consume that one value; the function never draws a second sample to hunt for a shorter delay.

State is only an attempt count. It is easy to store, including as JSON. Elapsed time stays with the caller because only the caller knows whether the clock moved.

Giving up does not increment `attempt`. The counter remains the number of retries that were actually planned.

## License

MIT License

Copyright (c) 2026 Vadim Gubin

The complete terms are in the LICENSE file.
