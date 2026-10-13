import { createMockPayments } from './mock.js';
import { createTranzilaPayments } from './tranzila.js';

export function createPayments(config) {
  switch (config.paymentProvider) {
    case 'tranzila':
      return createTranzilaPayments(config.tranzila);
    case 'mock':
      return createMockPayments();
    default:
      throw new Error(`Unknown PAYMENT_PROVIDER: ${config.paymentProvider}`);
  }
}
