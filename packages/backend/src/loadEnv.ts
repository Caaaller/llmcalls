import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

const candidates = [
  path.resolve(__dirname, '../../../.env'),
  path.resolve(process.cwd(), '../../.env'),
  path.resolve(process.cwd(), '.env'),
];
const envPath = candidates.find(p => fs.existsSync(p)) ?? candidates[0];
const result = dotenv.config({ path: envPath });
if (!process.env.OPENAI_API_KEY) {
  const loaded = result.parsed ? Object.keys(result.parsed).length : 0;
  console.error(
    `[loadEnv] OPENAI_API_KEY not set. Loaded ${loaded} vars from ${envPath}. ` +
      'Use OPENAI_API_KEY=sk-... in .env (no "export" prefix).'
  );
}
