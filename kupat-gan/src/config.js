import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

if (existsSync('.env')) process.loadEnvFile('.env');

const env = process.env;

function list(value) {
  return (value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export const config = {
  port: Number(env.PORT || 3000),
  publicUrl: (env.PUBLIC_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, ''),
  adminPassword: env.ADMIN_PASSWORD || '',
  // Without a configured secret, sessions and IVR links only live until restart.
  appSecret: env.APP_SECRET || randomBytes(24).toString('hex'),
  appSecretIsEphemeral: !env.APP_SECRET,
  dbPath: env.DB_PATH || './data/kupat-gan.db',

  calling: {
    start: env.CALL_HOURS_START || '09:30',
    end: env.CALL_HOURS_END || '20:30',
    erevCutoff: env.EREV_CUTOFF || '12:00',
    blockedDates: list(env.BLOCKED_DATES),
    intervalSeconds: Number(env.DIALER_INTERVAL_SECONDS || 60),
  },

  phoneProvider: env.PHONE_PROVIDER || 'mock',
  yemot: {
    number: env.YEMOT_NUMBER || '',
    password: env.YEMOT_PASSWORD || '',
    templateId: env.YEMOT_TEMPLATE_ID || '',
    callerId: env.YEMOT_CALLER_ID || '',
  },
  twilio: {
    accountSid: env.TWILIO_ACCOUNT_SID || '',
    authToken: env.TWILIO_AUTH_TOKEN || '',
    from: env.TWILIO_FROM || '',
  },

  paymentProvider: env.PAYMENT_PROVIDER || 'mock',
  tranzila: {
    supplier: env.TRANZILA_SUPPLIER || '',
    password: env.TRANZILA_PASSWORD || '',
  },
};
