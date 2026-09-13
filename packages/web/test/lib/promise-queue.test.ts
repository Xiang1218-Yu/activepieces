import { describe, expect, it, vi } from 'vitest';

import { PromiseQueue } from '@/lib/promise-queue';

describe('PromiseQueue', () => {
  it('keeps processing tasks queued after a failed task', async () => {
    const queue = new PromiseQueue();
    const failingTask = vi.fn(async () => {
      throw new Error('save failed');
    });
    const nextTask = vi.fn(async () => undefined);

    queue.add(failingTask);
    queue.add(nextTask);

    await vi.waitFor(() => expect(nextTask).toHaveBeenCalledTimes(1));
    expect(failingTask).toHaveBeenCalledTimes(1);
    expect(queue.size()).toBe(0);
  });

  it('runs tasks in insertion order', async () => {
    const queue = new PromiseQueue();
    const order: number[] = [];

    queue.add(async () => {
      await Promise.resolve();
      order.push(1);
    });
    queue.add(async () => {
      order.push(2);
    });
    queue.add(async () => {
      order.push(3);
    });

    await vi.waitFor(() => expect(queue.size()).toBe(0));
    expect(order).toEqual([1, 2, 3]);
  });
});
