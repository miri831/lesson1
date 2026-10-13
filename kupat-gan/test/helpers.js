import { openDb } from '../src/db.js';

export function seed() {
  const db = openDb(':memory:');
  const group = db.createGroup({ name: 'גן שושנים', teacherName: 'רחל' });
  const [moshe, yosef, sara] = db.addChildren(group.id, [
    { name: 'משה', parentName: 'אברהם', phone1: '0527654321', phone2: '0501234567' },
    { name: 'יוסף', parentName: 'אברהם', phone1: '0527654321' }, // twin - same parent
    { name: 'שרה', parentName: 'יעקב', phone1: '0548888888' },
  ]);
  const collection = db.createCollection(group.id, { title: 'משלוח מנות לגננת', amountAgorot: 2500 });
  db.updateCollection(collection.id, { status: 'active' });
  return { db, group, collection, children: { moshe, yosef, sara } };
}

export const callingConfig = { start: '09:30', end: '20:30', erevCutoff: '12:00', blockedDates: [] };

export const VALID_CARD = { number: '4580000000000000', expiry: '1230', id: '000000018', cvv: '123' };

export const quietLog = { error() {}, log() {} };
