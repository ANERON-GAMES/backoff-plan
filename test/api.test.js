import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as api from '../src/index.js';
import {
  BackoffPlanError,
  DEFAULTS,
  DEFAULT_BASE_DELAY_MS,
  DEFAULT_JITTER,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_MAX_DELAY_MS,
  DEFAULT_MULTIPLIER,
  JITTER_EQUAL,
  JITTER_FULL,
  JITTER_NONE,
  REASON_DEADLINE,
  REASON_MAX_ATTEMPTS,
  initialState,
  nextRetry,
} from '../src/index.js';
import { assertSuccess } from './helpers.js';

test('public exports', () => {
  assert.deepEqual(Object.keys(api).sort(), [
    'BackoffPlanError',
    'DEFAULTS',
    'DEFAULT_BASE_DELAY_MS',
    'DEFAULT_JITTER',
    'DEFAULT_MAX_ATTEMPTS',
    'DEFAULT_MAX_DELAY_MS',
    'DEFAULT_MULTIPLIER',
    'JITTER_EQUAL',
    'JITTER_FULL',
    'JITTER_NONE',
    'REASON_DEADLINE',
    'REASON_MAX_ATTEMPTS',
    'initialState',
    'nextRetry',
  ]);
});

test('named defaults', () => {
  assert.equal(DEFAULT_BASE_DELAY_MS, 100);
  assert.equal(DEFAULT_MULTIPLIER, 2);
  assert.equal(DEFAULT_MAX_DELAY_MS, 30000);
  assert.equal(DEFAULT_MAX_ATTEMPTS, 8);
  assert.equal(DEFAULT_JITTER, 'none');
  assert.equal(DEFAULT_JITTER, JITTER_NONE);
  assert.equal(JITTER_NONE, 'none');
  assert.equal(JITTER_FULL, 'full');
  assert.equal(JITTER_EQUAL, 'equal');
  assert.equal(REASON_MAX_ATTEMPTS, 'max_attempts');
  assert.equal(REASON_DEADLINE, 'deadline');
  assert.deepEqual(DEFAULTS, {
    baseDelayMs: 100,
    multiplier: 2,
    maxDelayMs: 30000,
    maxAttempts: 8,
    jitter: 'none',
  });
  assert.equal(Object.isFrozen(DEFAULTS), true);
  assert.throws(() => {
    DEFAULTS.baseDelayMs = 1;
  }, TypeError);
});

test('initialState returns an independent attempt counter', () => {
  const first = initialState();
  const second = initialState();
  assert.deepEqual(first, { attempt: 0 });
  assert.deepEqual(Object.keys(first), ['attempt']);
  assert.notEqual(first, second);
  first.attempt = 5;
  assert.deepEqual(second, { attempt: 0 });
  assert.deepEqual(initialState(), { attempt: 0 });
});

test('BackoffPlanError exposes code, name, and stack', () => {
  const error = new BackoffPlanError('invalid_now', 'nowMs must be a safe integer');
  assert.equal(error instanceof Error, true);
  assert.equal(error instanceof BackoffPlanError, true);
  assert.equal(error.name, 'BackoffPlanError');
  assert.equal(error.code, 'invalid_now');
  assert.equal(error.message, 'nowMs must be a safe integer');
  assert.equal(typeof error.stack, 'string');
  assert.match(error.stack, /BackoffPlanError/);
});

test('package metadata', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.name, '@aneron/backoff-plan');
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.license, 'MIT');
  assert.equal(pkg.exports['.'], './src/index.js');
  assert.equal(pkg.dependencies, undefined);
  assert.deepEqual(pkg.engines, { node: '>=20' });
});

test('license copyright line', () => {
  const license = readFileSync(new URL('../LICENSE', import.meta.url), 'utf8');
  assert.match(license, /^MIT License/);
  assert.match(license, /Copyright \(c\) 2026 Vadim Gubin/);
});

test('library source has no timers, clock, random, I/O, or comments', () => {
  const source = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  const banned = [
    'setTimeout',
    'setInterval',
    'setImmediate',
    'Date.now',
    'Math.random',
    'fetch(',
    'node:fs',
    'node:net',
    'node:http',
    'node:https',
    'node:child_process',
    'process.env',
    'require(',
    '//',
    '/*',
  ];
  for (const token of banned) {
    assert.equal(source.includes(token), false, token);
  }
});

test('calls do not use Math.random or Date.now', () => {
  const originalRandom = Math.random;
  const originalNow = Date.now;
  let randomCalls = 0;
  let nowCalls = 0;
  Math.random = () => {
    randomCalls += 1;
    return 0.5;
  };
  Date.now = () => {
    nowCalls += 1;
    return 0;
  };
  try {
    const plan = nextRetry(initialState(), { jitter: JITTER_FULL, maxAttempts: 3 }, 0, () => 0.25);
    assertSuccess(plan, 25, 1);
    assert.equal(randomCalls, 0);
    assert.equal(nowCalls, 0);
  } finally {
    Math.random = originalRandom;
    Date.now = originalNow;
  }
});
