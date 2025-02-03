import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Ensures that a directory exists, creating it if necessary.
 * Note: We use Node.js fs APIs here as Bun implements the Node.js fs module,
 * and these APIs are currently the recommended way to handle directory operations in Bun.
 * 
 * @param dir The directory path to ensure exists
 */
export async function ensureDir(dir: string): Promise<void> {
  try {
    await mkdir(dir, { recursive: true });
  } catch (error) {
    // If directory already exists, that's fine
    if ((error as { code?: string }).code !== 'EEXIST') {
      throw error;
    }
  }
} 