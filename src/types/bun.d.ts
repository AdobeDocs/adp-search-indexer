declare module "bun" {
  export interface TaskQueue {
    add(task: () => Promise<void>): void;
    finished: Promise<void>;
  }

  interface Bun {
    TaskQueue: {
      new (maxConcurrency: number): TaskQueue;
    };
  }

  declare global {
    const Bun: Bun;
  }
} 