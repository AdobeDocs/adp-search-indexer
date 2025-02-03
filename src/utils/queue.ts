export class TaskQueue {
  private concurrency: number;
  private running: number;
  private queue: (() => Promise<void>)[];

  constructor(concurrency: number) {
    this.concurrency = concurrency;
    this.running = 0;
    this.queue = [];
  }

  async add<T>(task: () => Promise<T>): Promise<T> {
    if (this.running >= this.concurrency) {
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