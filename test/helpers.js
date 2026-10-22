import assert from 'node:assert/strict';
import { BackoffPlanError } from '../src/index.js';

export function assertPlanError(fn, code, message) {
  assert.throws(fn, (error) => {
    assert.equal(error instanceof BackoffPlanError, true);
    assert.equal(error instanceof Error, true);
    assert.equal(error.name, 'BackoffPlanError');
    assert.equal(error.code, code);
    assert.equal(error.message, message);
    return true;
  });
}

export function assertSuccess(plan, delayMs, attempt) {
  assert.deepEqual(plan, {
    delayMs,
    state: { attempt },
    giveUp: false,
    reason: null,
  });
  assert.equal(Object.is(plan.delayMs, -0), false);
  assert.equal(Object.is(plan.state.attempt, -0), false);
}

export function assertGiveUp(plan, attempt, reason) {
  assert.deepEqual(plan, {
    delayMs: null,
    state: { attempt },
    giveUp: true,
    reason,
  });
  assert.equal(Object.is(plan.state.attempt, -0), false);
}

export function label(value) {
  if (typeof value === 'bigint') {
    return `${value}n`;
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'number' && Number.isNaN(value)) {
    return 'NaN';
  }
  if (typeof value === 'function') {
    return 'function';
  }
  if (Array.isArray(value)) {
    return `array(${value.length})`;
  }
  if (value instanceof Date) {
    return 'Date';
  }
  if (value instanceof Map) {
    return 'Map';
  }
  return String(value);
}
