const path = require('path');
const dotenv = require('dotenv');

// Load .env from monorepo root (worktree or main checkout), then backend-level as fallback
const candidates = [
  path.resolve(__dirname, '../../.env'),
  path.resolve(__dirname, '.env'),
  path.resolve(__dirname, '../../packages/backend/.env'),
];

for (const envPath of candidates) {
  const result = dotenv.config({ path: envPath });
  if (!result.error) break;
}

// Ensure Telnyx credentials have a placeholder so telnyxService can initialize in tests
// (actual API calls are mocked in individual tests)
process.env.TELNYX_API_KEY = process.env.TELNYX_API_KEY || 'test-api-key-for-jest';
process.env.TELNYX_CONNECTION_ID = process.env.TELNYX_CONNECTION_ID || 'test-connection-id';
