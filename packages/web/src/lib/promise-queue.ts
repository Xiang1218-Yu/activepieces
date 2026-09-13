import { Mutex } from 'async-mutex';

export class PromiseQueue {
  private queue: (() => Promise<unknown>)[] = [];
  private lock: Mutex = new Mutex();
  private running = false;

  add(promise: () => Promise<unknown>) {
    this.queue.push(promise);
    this.run();
  }

  size() {
    return this.queue.length;
  }

  private async run() {
    if (this.running) {
      return;
    }
    this.running = true;
    await this.lock.runExclusive(async () => {
      while (this.queue.length > 0) {
        const promise = this.queue.shift()!;
        try {
          await promise();
        } catch {
          // A failed task must not stop the tasks queued behind it; callers
          // handle their own errors inside the task.
        }
      }
    });
    this.running = false;
    if (this.queue.length > 0) {
      this.run();
    }
  }
}
