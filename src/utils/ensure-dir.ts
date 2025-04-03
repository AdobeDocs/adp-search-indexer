import { mkdir } from 'node:fs/promises';

/**
 * Ensures that a directory exists, creating it if necessary.
 * Uses Node.js fs APIs to handle directory operations.
 *
 * @param dir The directory path to ensure exists
 */
export async function ensureDir(dir: string): Promise<void> {
  try {
    await mkdir(dir, { recursive: true });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code !== 'EEXIST') {
      throw error;
    }
  }
}
