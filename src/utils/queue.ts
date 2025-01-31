export class TaskQueue {
  private running = 0;
  private queue: (() => Promise<void>)[] = [];
  private readonly maxConcurrency: number;

  constructor(maxConcurrency: number) {
    this.maxConcurrency = maxConcurrency;
  }

  async add(task: () => Promise<void>): Promise<void> {
    if (this.running >= this.maxConcurrency) {
      // Queue the task if we're at max concurrency
      return new Promise<void>((resolve) => {
        this.queue.push(async () => {
          await task();
          resolve();
        });
      });
    }

    // Run the task immediately if we're under max concurrency
    this.running++;
    try {
      await task();
    } finally {
      this.running--;
      this.runNext();
    }
  }

  private runNext(): void {
    if (this.queue.length > 0 && this.running < this.maxConcurrency) {
      const task = this.queue.shift();
      if (task) {
        this.running++;
        task().finally(() => {
          this.running--;
          this.runNext();
        });
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