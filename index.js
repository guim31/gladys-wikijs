// -----------------------------------------------------------------------------
// Entry point: wires the Gladys SDK to the Wiki.js hub (src/app.js). No
// Wiki.js logic here. Handlers are registered before connect().
//
// Environment provided by the Gladys supervisor: GLADYS_HOST_API_URL,
// GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR (read by the SDK).
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { registerHandlers } from './src/app.js';
import { Store } from './src/store.js';

const gladys = new GladysIntegration();
const app = registerHandlers(gladys, { store: new Store() });

gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal}, stopping`);
  return app.stop(); // stops the timers, finishes the pending write
});

logger.info('Starting the Wiki.js integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
