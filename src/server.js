import { createApp } from './app.js';
import { loadConfig } from './config/env.js';
import { openVehicleStore } from './modules/vehicles/vehicle.repository.js';

const config = loadConfig();
let vehicleStore;
try { vehicleStore = await openVehicleStore(config.databaseUrl); }
catch {
  console.error('Database initialization failed. Verify DATABASE_URL and run npm run db:migrate.');
  process.exit(1);
}
const app = createApp({ vehicleStore, adminApiKey: config.adminApiKey, trustProxy: config.trustProxy });
const server = app.listen(config.port, config.host, () => console.info('Maxicab API listening on port ' + config.port));
server.requestTimeout = 15000;
server.headersTimeout = 10000;
let stopping = false;
function shutdown(exitCode = 0) {
  if (stopping) {return;}
  stopping = true;
  const deadline = setTimeout(() => process.exit(1), 10000).unref();
  server.close(async () => {
    try { await vehicleStore.close(); } catch { exitCode = 1; }
    clearTimeout(deadline);
    process.exit(exitCode);
  });
  server.closeIdleConnections();
}
server.on('error', () => shutdown(1));
for (const signal of ['SIGTERM', 'SIGINT']) {process.once(signal, () => shutdown());}
