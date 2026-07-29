import { loadServerConfig } from '@mediadeck/config';

import { buildApplication } from './app.js';

const config = loadServerConfig();
const app = await buildApplication({ config });
let closing = false;

const closeGracefully = async (signal: NodeJS.Signals): Promise<void> => {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, 'Shutting down MediaDeck');
  try {
    await app.close();
    process.exitCode = 0;
  } catch (error) {
    app.log.error(error, 'MediaDeck shutdown failed');
    process.exitCode = 1;
  }
};

process.once('SIGINT', () => void closeGracefully('SIGINT'));
process.once('SIGTERM', () => void closeGracefully('SIGTERM'));

try {
  await app.listen({
    host: config.host,
    port: config.port,
  });
} catch (error) {
  app.log.error(error, 'MediaDeck failed to start');
  process.exitCode = 1;
  await app.close();
}
