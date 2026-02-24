const path = require('path');
const dotenv = require('dotenv');

const rootEnv = path.resolve(process.cwd(), '../../.env');
dotenv.config({ path: rootEnv });
