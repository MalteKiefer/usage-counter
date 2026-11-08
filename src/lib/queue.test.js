import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serial } from './queue.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('tasks finish in the order they were queued', async () => {
  const queue = serial();
  const order = [];
  await Promise.all([
    queue(async () => {
      await wait(30);
      order.push('first');
    }),
    queue(async () => order.push('second')),
  ]);
  assert.deepEqual(order, ['first', 'second']);
});

test('a failed task does not block the next one', async () => {
  const queue = serial();
  const failed = queue(async () => {
    throw new Error('offline');
  });
  await assert.rejects(failed, /offline/);
  assert.equal(await queue(async () => 'next'), 'next');
});
