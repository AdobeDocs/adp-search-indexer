export class TaskQueue {
  private _concurrency: number;
  private running: number;
  private queue: (() => Promise<void>)[];

  constructor(concurrency: number) {
    this._concurrency = concurrency;
    this.running = 0;
    this.queue = [];
  }

  async add<T>(task: () => Promise<T>): Promise<T> {
    if (this.running >= this._concurrency) {
      await new Promise<void>(resolve => {
        this.queue.push(async () => {
          resolve();
        });
      });
    }

    this.running++;
    try {
      return await task();
    } finally {
      this.running--;
      if (this.queue.length > 0) {
        const next = this.queue.shift();
        if (next) next();
      }
    }
  }

  async addBatch(tasks: (() => Promise<void>)[]): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const task of tasks) {
      promises.push(this.add(task));
    }
    await Promise.all(promises);
  }

  get concurrency(): number {
    return this._concurrency;
  }

  get active(): number {
    return this.running;
  }

  get pending(): number {
    return this.queue.length;
  }

  get isIdle(): boolean {
    return this.running === 0 && this.queue.length === 0;
  }
} 