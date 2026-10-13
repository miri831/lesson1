import { createServer } from 'node:http';
import { config } from './config.js';
import { openDb } from './db.js';
import { createApp } from './app.js';

if (!config.adminPassword) {
  console.error('ADMIN_PASSWORD is not set. Copy .env.example to .env and set a password.');
  process.exit(1);
}
if (config.appSecretIsEphemeral) {
  console.warn('APP_SECRET is not set: logins and the Yemot IVR link will change on every restart.');
}

const db = openDb(config.dbPath);
const app = createApp({ config, db });
app.dialer.start(config.calling.intervalSeconds);

createServer(app.handle).listen(config.port, () => {
  console.log(`קופת גן פועלת: http://localhost:${config.port}`);
  console.log(`טלפוניה: ${config.phoneProvider} | סליקה: ${config.paymentProvider}`);
  if (config.phoneProvider === 'yemot') console.log(`api_link לימות המשיח: ${config.publicUrl}/ivr/yemot/${app.ivrToken}`);
});
