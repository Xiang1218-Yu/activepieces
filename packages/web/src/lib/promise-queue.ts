import { Mutex } from 'async-mutex';

export class PromiseQueue {
  private queue: (() => Promise<unknown>)[] = [];
  private lock: Mutex = new Mutex();
  private halted = false;

  add(promise: () => Promise<unknown>) {
    this.queue.push(promise);
    this.run();
  }

  addAndWait<T>(promise: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.add(async () => {
        try {
          resolve(await promise());
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  halt() {
    this.halted = true;
  }
  size() {
    return this.queue.length;
  }

  private run() {
    this.lock.runExclusive(async () => {
      const promise = this.queue.shift()!;
      if (this.halted) {
        return;
      }
      await promise();
    });
  }
}
