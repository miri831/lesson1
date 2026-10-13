// Test processor: approves every card except ones ending in 0002 (simulated decline).

import { randomInt } from 'node:crypto';

export function createMockPayments() {
  return {
    name: 'mock',
    async charge({ card }) {
      await new Promise((r) => setTimeout(r, 50));
      if (card.number.endsWith('0002')) {
        return { approved: false, responseCode: '004', message: 'סירוב (בדיקה)' };
      }
      return { approved: true, responseCode: '000', confirmation: String(randomInt(1000000, 9999999)) };
    },
  };
}
