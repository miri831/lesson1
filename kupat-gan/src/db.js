import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  teacher_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS children (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  parent_name TEXT NOT NULL DEFAULT '',
  phone1 TEXT NOT NULL,
  phone2 TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS children_phone1 ON children(phone1);
CREATE INDEX IF NOT EXISTS children_phone2 ON children(phone2);

-- A collection: "משלוח מנות לגננת", "מתנת סוף שנה"...
CREATE TABLE IF NOT EXISTS collections (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  amount_agorot INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft', -- draft | active | paused | closed
  max_attempts INTEGER NOT NULL DEFAULT 3,
  retry_hours INTEGER NOT NULL DEFAULT 24,
  due_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- What each child owes for each collection.
CREATE TABLE IF NOT EXISTS charges (
  id INTEGER PRIMARY KEY,
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | paid | cash | exempt | claimed_cash
  payment_id INTEGER REFERENCES payments(id),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_call_at TEXT,
  snooze_until TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (collection_id, child_id)
);

-- Card transactions. Card numbers are never stored - only the last 4 digits.
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  phone TEXT NOT NULL,
  amount_agorot INTEGER NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL, -- approved | declined | error
  response_code TEXT,
  confirmation TEXT,
  card_last4 TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS calls (
  id INTEGER PRIMARY KEY,
  provider TEXT NOT NULL,
  direction TEXT NOT NULL, -- outbound | inbound
  phone TEXT NOT NULL,
  call_ref TEXT,
  result TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return createRepo(db);
}

function createRepo(db) {
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);

  function tx(fn) {
    db.exec('BEGIN');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  // ---- groups ----
  const listGroups = () =>
    all(`SELECT g.*,
           (SELECT COUNT(*) FROM children c WHERE c.group_id = g.id) AS children_count,
           (SELECT COUNT(*) FROM collections k WHERE k.group_id = g.id AND k.status IN ('active','paused')) AS open_collections
         FROM groups g ORDER BY g.name`);
  const getGroup = (id) => get('SELECT * FROM groups WHERE id = ?', id);
  const createGroup = ({ name, teacherName = '' }) =>
    getGroup(Number(run('INSERT INTO groups (name, teacher_name) VALUES (?, ?)', name, teacherName).lastInsertRowid));
  const updateGroup = (id, { name, teacherName = '' }) => {
    run('UPDATE groups SET name = ?, teacher_name = ? WHERE id = ?', name, teacherName, id);
    return getGroup(id);
  };
  const deleteGroup = (id) => run('DELETE FROM groups WHERE id = ?', id);

  // ---- children ----
  const listChildren = (groupId) => all('SELECT * FROM children WHERE group_id = ? ORDER BY name', groupId);
  const getChild = (id) => get('SELECT * FROM children WHERE id = ?', id);

  function addChildren(groupId, rows) {
    return tx(() => {
      const insert = db.prepare(
        'INSERT INTO children (group_id, name, parent_name, phone1, phone2) VALUES (?, ?, ?, ?, ?)',
      );
      const openCollections = all(
        "SELECT id FROM collections WHERE group_id = ? AND status IN ('draft','active','paused')",
        groupId,
      );
      const addCharge = db.prepare('INSERT OR IGNORE INTO charges (collection_id, child_id) VALUES (?, ?)');
      const ids = [];
      for (const r of rows) {
        const id = Number(insert.run(groupId, r.name, r.parentName || '', r.phone1, r.phone2 || null).lastInsertRowid);
        // A child who joins mid-way also owes for collections still running.
        for (const c of openCollections) addCharge.run(c.id, id);
        ids.push(id);
      }
      return ids;
    });
  }

  const updateChild = (id, { name, parentName = '', phone1, phone2 = null }) => {
    run(
      'UPDATE children SET name = ?, parent_name = ?, phone1 = ?, phone2 = ? WHERE id = ?',
      name,
      parentName,
      phone1,
      phone2,
      id,
    );
    return getChild(id);
  };
  const deleteChild = (id) => run('DELETE FROM children WHERE id = ?', id);

  // ---- collections ----
  const collectionSummarySql = `
    SELECT k.*,
      COUNT(ch.id) AS total_children,
      SUM(ch.status = 'paid') AS paid_card,
      SUM(ch.status = 'cash') AS paid_cash,
      SUM(ch.status = 'exempt') AS exempt,
      SUM(ch.status = 'claimed_cash') AS claimed_cash,
      SUM(ch.status = 'pending') AS pending
    FROM collections k LEFT JOIN charges ch ON ch.collection_id = k.id`;

  const listCollections = (groupId) =>
    all(`${collectionSummarySql} WHERE k.group_id = ? GROUP BY k.id ORDER BY k.created_at DESC`, groupId);
  const getCollection = (id) => get(`${collectionSummarySql} WHERE k.id = ? GROUP BY k.id`, id);

  function createCollection(groupId, { title, amountAgorot, maxAttempts = 3, retryHours = 24, dueDate = null }) {
    return tx(() => {
      const id = Number(
        run(
          `INSERT INTO collections (group_id, title, amount_agorot, max_attempts, retry_hours, due_date)
           VALUES (?, ?, ?, ?, ?, ?)`,
          groupId,
          title,
          amountAgorot,
          maxAttempts,
          retryHours,
          dueDate,
        ).lastInsertRowid,
      );
      run('INSERT INTO charges (collection_id, child_id) SELECT ?, id FROM children WHERE group_id = ?', id, groupId);
      return getCollection(id);
    });
  }

  function updateCollection(id, fields) {
    const map = {
      title: 'title',
      amountAgorot: 'amount_agorot',
      maxAttempts: 'max_attempts',
      retryHours: 'retry_hours',
      dueDate: 'due_date',
      status: 'status',
    };
    const sets = [];
    const vals = [];
    for (const [k, col] of Object.entries(map)) {
      if (fields[k] !== undefined) {
        sets.push(`${col} = ?`);
        vals.push(fields[k]);
      }
    }
    if (sets.length) run(`UPDATE collections SET ${sets.join(', ')} WHERE id = ?`, ...vals, id);
    return getCollection(id);
  }
  const deleteCollection = (id) => run('DELETE FROM collections WHERE id = ?', id);

  // ---- charges ----
  const listCharges = (collectionId) =>
    all(
      `SELECT ch.*, c.name AS child_name, c.parent_name, c.phone1, c.phone2,
              p.confirmation, p.card_last4, p.created_at AS paid_at
       FROM charges ch
       JOIN children c ON c.id = ch.child_id
       LEFT JOIN payments p ON p.id = ch.payment_id
       WHERE ch.collection_id = ?
       ORDER BY c.name`,
      collectionId,
    );
  const getCharge = (id) => get('SELECT * FROM charges WHERE id = ?', id);

  function setChargeStatus(id, status) {
    run("UPDATE charges SET status = ?, updated_at = datetime('now') WHERE id = ?", status, id);
    return getCharge(id);
  }

  // Resetting attempts lets the dialer call this family again.
  function resetChargeAttempts(id) {
    run("UPDATE charges SET attempts = 0, last_call_at = NULL, snooze_until = NULL, updated_at = datetime('now') WHERE id = ?", id);
    return getCharge(id);
  }

  // Everything a phone number still owes, across all active collections.
  const openChargesForPhone = (phone) =>
    all(
      `SELECT ch.id, ch.collection_id, k.title, k.amount_agorot, c.name AS child_name, g.name AS group_name
       FROM charges ch
       JOIN children c ON c.id = ch.child_id
       JOIN collections k ON k.id = ch.collection_id
       JOIN groups g ON g.id = k.group_id
       WHERE ch.status = 'pending' AND k.status IN ('active','paused')
         AND (c.phone1 = ? OR c.phone2 = ?)
       ORDER BY k.created_at, c.name`,
      phone,
      phone,
    );

  const isKnownPhone = (phone) => !!get('SELECT 1 FROM children WHERE phone1 = ? OR phone2 = ?', phone, phone);

  // Families the dialer should call now. One parent with twins gets one call.
  function chargesDueForCall(now = new Date()) {
    const nowStr = now.toISOString();
    return all(
      `SELECT ch.id, ch.attempts, k.id AS collection_id, k.retry_hours, c.phone1, c.phone2
       FROM charges ch
       JOIN collections k ON k.id = ch.collection_id
       JOIN children c ON c.id = ch.child_id
       WHERE k.status = 'active' AND ch.status = 'pending'
         AND ch.attempts < k.max_attempts
         AND (ch.snooze_until IS NULL OR ch.snooze_until <= ?)
         AND (ch.last_call_at IS NULL
              OR datetime(ch.last_call_at, '+' || k.retry_hours || ' hours') <= datetime(?))`,
      nowStr,
      nowStr,
    );
  }

  function markCalled(chargeIds, at = new Date()) {
    const stmt = db.prepare(
      "UPDATE charges SET attempts = attempts + 1, last_call_at = ?, updated_at = datetime('now') WHERE id = ?",
    );
    tx(() => chargeIds.forEach((id) => stmt.run(at.toISOString(), id)));
  }

  function snoozePhone(phone, until) {
    run(
      `UPDATE charges SET snooze_until = ?
       WHERE status = 'pending' AND child_id IN (SELECT id FROM children WHERE phone1 = ? OR phone2 = ?)`,
      until.toISOString(),
      phone,
      phone,
    );
  }

  function markClaimedCash(chargeIds) {
    const stmt = db.prepare(
      "UPDATE charges SET status = 'claimed_cash', updated_at = datetime('now') WHERE id = ? AND status = 'pending'",
    );
    tx(() => chargeIds.forEach((id) => stmt.run(id)));
  }

  // ---- payments ----
  function recordPayment({ phone, amountAgorot, provider, status, responseCode, confirmation, cardLast4, chargeIds }) {
    return tx(() => {
      const id = Number(
        run(
          `INSERT INTO payments (phone, amount_agorot, provider, status, response_code, confirmation, card_last4)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          phone,
          amountAgorot,
          provider,
          status,
          responseCode ?? null,
          confirmation ?? null,
          cardLast4 ?? null,
        ).lastInsertRowid,
      );
      if (status === 'approved') {
        const stmt = db.prepare(
          "UPDATE charges SET status = 'paid', payment_id = ?, updated_at = datetime('now') WHERE id = ?",
        );
        chargeIds.forEach((cid) => stmt.run(id, cid));
      }
      return id;
    });
  }

  const listPayments = (limit = 200) => all('SELECT * FROM payments ORDER BY id DESC LIMIT ?', limit);

  // ---- calls ----
  const logCall = ({ provider, direction, phone, callRef = null, result = null }) =>
    run(
      'INSERT INTO calls (provider, direction, phone, call_ref, result) VALUES (?, ?, ?, ?, ?)',
      provider,
      direction,
      phone,
      callRef,
      result,
    );
  const listCalls = (limit = 200) => all('SELECT * FROM calls ORDER BY id DESC LIMIT ?', limit);

  return {
    raw: db,
    listGroups,
    getGroup,
    createGroup,
    updateGroup,
    deleteGroup,
    listChildren,
    getChild,
    addChildren,
    updateChild,
    deleteChild,
    listCollections,
    getCollection,
    createCollection,
    updateCollection,
    deleteCollection,
    listCharges,
    getCharge,
    setChargeStatus,
    resetChargeAttempts,
    openChargesForPhone,
    isKnownPhone,
    chargesDueForCall,
    markCalled,
    snoozePhone,
    markClaimedCash,
    recordPayment,
    listPayments,
    logCall,
    listCalls,
  };
}
