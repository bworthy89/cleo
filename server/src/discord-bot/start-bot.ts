import { start } from './index';

start().catch((err) => {
  console.error('[bot:bootstrap] fatal', err);
  process.exit(1);
});
