const path = require('path');
const dotenv = require('dotenv');

// Always load the monorepo root .env, regardless of Jest's cwd
const rootEnv = path.resolve(__dirname, '../../.env');
dotenv.config({ path: rootEnv });
