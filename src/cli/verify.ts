import { verifyIndices } from '../utils/verify-indices.js';

// Execute the verification
verifyIndices().catch((error) => {
  console.error('Error running verification:', error);
  process.exit(1);
});
