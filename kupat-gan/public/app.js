// Admin UI for the organizer (vanilla JS, hash routing).

const view = document.getElementById('view');

const STATUS = {
  pending: 'טרם שולם',
  paid: 'שולם באשראי',
  cash: 'שולם במזומן',
  exempt: 'פטור',
  claimed_cash: 'דיווח מזומן - לאימות',
};
const COLLECTION_STATUS = { draft: 'טיוטה', active: 'פעילה - מחייגת', paused: 'מושהית', closed: 'סגורה' };

// ---------- helpers ----------
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
const shekels = (agorot) => `${(agorot / 100).toLocaleString('he-IL', { maximumFractionDigits: 2 })} ₪`;
const fmtPhone = (p) => (p ? (p.length === 10 ? `${p.slice(0, 3)}-${p.slice(3)}` : `${p.slice(0, 2)}-${p.slice(2)}`) : '');
const fmtDate = (s) => (s ? new Date(s.endsWith('Z') || s.includes('T') ? s : s.replace(' ', 'T') + 'Z').toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }) : '');

function toast(msg, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast' + (isError ? ' error' : '');
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.hidden = true), 3500);
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body !== undefined || method !== 'GET' ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : method !== 'GET' ? '{}' : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/login') {
    renderLogin();
    throw new Error(data.error || 'נדרשת התחברות');
  }
  if (!res.ok) throw new Error(data.error || `שגיאה ${res.status}`);
  return data;
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

// Run an async action, show errors as a toast.
async function act(fn, okMsg) {
  try {
    const r = await fn();
    if (okMsg) toast(okMsg);
    return r;
  } catch (err) {
    toast(err.message, true);
  }
}

// ---------- status bar ----------
let appStatus = null;
async function refreshStatus() {
  appStatus = await api('GET', '/api/status');
  const el = document.getElementById('callstatus');
  el.hidden = false;
  el.className = 'callstatus ' + (appStatus.calling.allowed ? 'ok' : 'off');
  el.textContent = appStatus.calling.allowed
    ? 'המחייג פעיל כעת - שיחות יוצאות לפי הגביות הפעילות'
    : `לא מחייגים כעת: ${appStatus.calling.reason}`;
}

// ---------- login ----------
function renderLogin() {
  document.getElementById('nav').hidden = true;
  document.getElementById('callstatus').hidden = true;
  view.innerHTML = `
    <div class="card" style="max-width:360px;margin:40px auto">
      <h1>כניסה</h1>
      <form id="login" class="row">
        <label style="flex:1">סיסמה<input type="password" name="password" required autofocus /></label>
        <button class="primary">כניסה</button>
      </form>
    </div>`;
  document.getElementById('login').onsubmit = async (e) => {
    e.preventDefault();
    await act(async () => {
      await api('POST', '/api/login', formData(e.target));
      route();
    });
  };
}

document.getElementById('logout').onclick = async () => {
  await api('POST', '/api/logout');
  renderLogin();
};

// ---------- groups ----------
async function renderGroups() {
  const groups = await api('GET', '/api/groups');
  view.innerHTML = `
    <h1>הגנים והכיתות שלי</h1>
    <div class="grid">
      ${groups
        .map(
          (g) => `<a class="card" href="#/groups/${g.id}/collections">
            <strong>${esc(g.name)}</strong>
            <div class="muted">${g.teacher_name ? 'הגננת: ' + esc(g.teacher_name) + ' · ' : ''}${g.children_count} ילדים</div>
            ${g.open_collections ? `<div class="chip active" style="margin-top:6px">${g.open_collections} גביות פתוחות</div>` : ''}
          </a>`,
        )
        .join('')}
    </div>
    <h2>הוספת גן / כיתה</h2>
    <form id="newGroup" class="card inline">
      <label>שם הגן<input name="name" required placeholder="גן שושנים" /></label>
      <label>שם הגננת<input name="teacherName" placeholder="הגננת רחל" /></label>
      <button class="primary">הוספה</button>
    </form>`;
  document.getElementById('newGroup').onsubmit = async (e) => {
    e.preventDefault();
    const g = await act(() => api('POST', '/api/groups', formData(e.target)));
    if (g) location.hash = `#/groups/${g.id}/children`;
  };
}

function groupHeader(group, tab) {
  return `
    <div class="muted"><a href="#/">כל הגנים</a></div>
    <h1>${esc(group.name)}</h1>
    <div class="tabs">
      <a href="#/groups/${group.id}/collections" class="${tab === 'collections' ? 'active' : ''}">גביות</a>
      <a href="#/groups/${group.id}/children" class="${tab === 'children' ? 'active' : ''}">ילדים והורים</a>
      <a href="#/groups/${group.id}/edit" class="${tab === 'edit' ? 'active' : ''}">פרטי הגן</a>
    </div>`;
}

async function renderGroupEdit(groupId) {
  const group = await api('GET', `/api/groups/${groupId}`);
  view.innerHTML = `${groupHeader(group, 'edit')}
    <form id="editGroup" class="card inline">
      <label>שם הגן<input name="name" required value="${esc(group.name)}" /></label>
      <label>שם הגננת<input name="teacherName" value="${esc(group.teacher_name)}" /></label>
      <button class="primary">שמירה</button>
    </form>
    <button id="delGroup" class="danger">מחיקת הגן וכל הנתונים שלו</button>`;
  document.getElementById('editGroup').onsubmit = async (e) => {
    e.preventDefault();
    await act(() => api('PUT', `/api/groups/${groupId}`, formData(e.target)), 'נשמר');
    route();
  };
  document.getElementById('delGroup').onclick = async () => {
    if (!confirm(`למחוק את "${group.name}" כולל כל הילדים והגביות?`)) return;
    await act(() => api('DELETE', `/api/groups/${groupId}`), 'נמחק');
    location.hash = '#/';
  };
}

// ---------- children ----------
async function renderChildren(groupId) {
  const [group, children] = await Promise.all([
    api('GET', `/api/groups/${groupId}`),
    api('GET', `/api/groups/${groupId}/children`),
  ]);
  view.innerHTML = `${groupHeader(group, 'children')}
    <div class="card">
      <h2 style="margin-top:0">ייבוא רשימה</h2>
      <p class="muted">הדביקו רשימה מאקסל או מקובץ: בכל שורה שם הילד, שם ההורה (לא חובה), טלפון, וטלפון נוסף (לא חובה). אפשר להפריד בפסיקים או בטאבים.</p>
      <textarea id="importText" placeholder="משה כהן, אברהם כהן, 052-7654321, 050-1234567&#10;שרה לוי, 03-6181234"></textarea>
      <div class="row" style="margin-top:8px">
        <button id="importPreview">בדיקה</button>
        <button id="importDo" class="primary" disabled>ייבוא</button>
        <input type="file" id="importFile" accept=".csv,.txt" />
      </div>
      <div id="importResult"></div>
    </div>

    <h2>${children.length} ילדים</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>שם הילד</th><th>שם ההורה</th><th>טלפון</th><th>טלפון נוסף</th><th></th></tr></thead>
      <tbody>
        ${children
          .map(
            (c) => `<tr data-id="${c.id}">
              <td>${esc(c.name)}</td><td>${esc(c.parent_name)}</td>
              <td class="ltr">${fmtPhone(c.phone1)}</td><td class="ltr">${fmtPhone(c.phone2)}</td>
              <td><button class="link" data-edit>עריכה</button> · <button class="link danger" data-del>מחיקה</button></td>
            </tr>`,
          )
          .join('')}
      </tbody>
    </table></div>

    <h2>הוספת ילד</h2>
    <form id="addChild" class="card inline">
      <label>שם הילד<input name="name" required /></label>
      <label>שם ההורה<input name="parentName" /></label>
      <label>טלפון<input name="phone1" type="tel" required /></label>
      <label>טלפון נוסף<input name="phone2" type="tel" /></label>
      <button class="primary">הוספה</button>
    </form>`;

  const text = document.getElementById('importText');
  const doBtn = document.getElementById('importDo');
  const result = document.getElementById('importResult');
  text.oninput = () => (doBtn.disabled = true);

  document.getElementById('importFile').onchange = async (e) => {
    const file = e.target.files[0];
    if (file) text.value = await file.text();
    doBtn.disabled = true;
  };

  document.getElementById('importPreview').onclick = async () => {
    const r = await act(() => api('POST', `/api/groups/${groupId}/import`, { text: text.value, dryRun: true }));
    if (!r) return;
    doBtn.disabled = r.rows.length === 0;
    result.innerHTML = `
      <p>נמצאו ${r.rows.length} ילדים תקינים.</p>
      ${r.errors.length ? `<ul class="error-list">${r.errors.map((er) => `<li>שורה ${er.line}: ${esc(er.reason)}</li>`).join('')}</ul>` : ''}
      ${
        r.rows.length
          ? `<div class="table-wrap"><table><tbody>${r.rows
              .map((row) => `<tr><td>${esc(row.name)}</td><td>${esc(row.parentName)}</td><td class="ltr">${fmtPhone(row.phone1)}</td><td class="ltr">${fmtPhone(row.phone2)}</td></tr>`)
              .join('')}</tbody></table></div>`
          : ''
      }`;
  };

  doBtn.onclick = async () => {
    const r = await act(() => api('POST', `/api/groups/${groupId}/import`, { text: text.value }));
    if (r) {
      toast(`יובאו ${r.imported} ילדים`);
      route();
    }
  };

  document.getElementById('addChild').onsubmit = async (e) => {
    e.preventDefault();
    if (await act(() => api('POST', `/api/groups/${groupId}/children`, formData(e.target)), 'נוסף')) route();
  };

  view.querySelectorAll('tr[data-id]').forEach((tr) => {
    const child = children.find((c) => c.id === Number(tr.dataset.id));
    tr.querySelector('[data-del]').onclick = async () => {
      if (!confirm(`למחוק את ${child.name}?`)) return;
      if (await act(() => api('DELETE', `/api/children/${child.id}`), 'נמחק')) route();
    };
    tr.querySelector('[data-edit]').onclick = () => {
      tr.innerHTML = `<td colspan="5"><form class="inline">
        <label>שם הילד<input name="name" required value="${esc(child.name)}" /></label>
        <label>שם ההורה<input name="parentName" value="${esc(child.parent_name)}" /></label>
        <label>טלפון<input name="phone1" type="tel" required value="${esc(child.phone1)}" /></label>
        <label>טלפון נוסף<input name="phone2" type="tel" value="${esc(child.phone2 || '')}" /></label>
        <button class="primary">שמירה</button> <button type="button" data-cancel>ביטול</button>
      </form></td>`;
      tr.querySelector('[data-cancel]').onclick = route;
      tr.querySelector('form').onsubmit = async (e) => {
        e.preventDefault();
        if (await act(() => api('PUT', `/api/children/${child.id}`, formData(e.target)), 'נשמר')) route();
      };
    };
  });
}

// ---------- collections ----------
function collected(c) {
  return (c.paid_card + c.paid_cash) * c.amount_agorot;
}
function payable(c) {
  return c.total_children - c.exempt;
}

async function renderCollections(groupId) {
  const [group, collections] = await Promise.all([
    api('GET', `/api/groups/${groupId}`),
    api('GET', `/api/groups/${groupId}/collections`),
  ]);
  view.innerHTML = `${groupHeader(group, 'collections')}
    <div class="grid">
      ${collections
        .map((c) => {
          const done = c.paid_card + c.paid_cash;
          const pct = payable(c) ? Math.round((done / payable(c)) * 100) : 0;
          return `<a class="card" href="#/collections/${c.id}">
            <strong>${esc(c.title)}</strong> <span class="chip ${c.status}">${COLLECTION_STATUS[c.status]}</span>
            <div class="muted">${shekels(c.amount_agorot)} לילד · נאסף ${shekels(collected(c))}</div>
            <div class="progress"><div style="width:${pct}%"></div></div>
            <div class="muted">${done} מתוך ${payable(c)} שילמו</div>
          </a>`;
        })
        .join('')}
    </div>
    <h2>גבייה חדשה</h2>
    <form id="newCollection" class="card inline">
      <label>נושא (כך יוקרא להורים)<input name="title" required placeholder="משלוח מנות לגננת" /></label>
      <label>סכום לילד (₪)<input name="amount" type="number" min="1" step="0.5" required style="width:110px" /></label>
      <label>ניסיונות חיוג<input name="maxAttempts" type="number" min="1" max="10" value="3" style="width:90px" /></label>
      <label>שעות בין ניסיונות<input name="retryHours" type="number" min="1" max="168" value="24" style="width:90px" /></label>
      <label>תאריך יעד<input name="dueDate" type="date" /></label>
      <button class="primary">יצירה</button>
    </form>
    <p class="muted">גבייה נוצרת כטיוטה. החיוג להורים מתחיל רק אחרי לחיצה על "הפעלת חיוג".</p>`;
  document.getElementById('newCollection').onsubmit = async (e) => {
    e.preventDefault();
    const c = await act(() => api('POST', `/api/groups/${groupId}/collections`, formData(e.target)));
    if (c) location.hash = `#/collections/${c.id}`;
  };
}

async function renderCollection(collectionId) {
  const c = await api('GET', `/api/collections/${collectionId}`);
  const [group, charges] = await Promise.all([
    api('GET', `/api/groups/${c.group_id}`),
    api('GET', `/api/collections/${collectionId}/charges`),
  ]);
  const done = c.paid_card + c.paid_cash;
  const pct = payable(c) ? Math.round((done / payable(c)) * 100) : 0;

  const statusButtons = {
    draft: [['active', 'הפעלת חיוג', 'primary']],
    active: [['paused', 'השהיית חיוג'], ['closed', 'סגירת הגבייה']],
    paused: [['active', 'חידוש חיוג', 'primary'], ['closed', 'סגירת הגבייה']],
    closed: [['paused', 'פתיחה מחדש (ללא חיוג)']],
  }[c.status];

  view.innerHTML = `
    <div class="muted"><a href="#/">כל הגנים</a> › <a href="#/groups/${group.id}/collections">${esc(group.name)}</a></div>
    <h1>${esc(c.title)} <span class="chip ${c.status}">${COLLECTION_STATUS[c.status]}</span></h1>

    <div class="stats">
      <div class="stat"><div class="muted">נאסף</div><div class="num">${shekels(collected(c))}</div><div class="muted">מתוך ${shekels(payable(c) * c.amount_agorot)}</div></div>
      <div class="stat"><div class="muted">שילמו באשראי</div><div class="num">${c.paid_card}</div></div>
      <div class="stat"><div class="muted">שילמו במזומן</div><div class="num">${c.paid_cash}</div></div>
      <div class="stat"><div class="muted">טרם שילמו</div><div class="num">${c.pending}</div></div>
      ${c.claimed_cash ? `<div class="stat"><div class="muted">דיווחו על מזומן - לאימות</div><div class="num">${c.claimed_cash}</div></div>` : ''}
    </div>
    <div class="progress"><div style="width:${pct}%"></div></div>

    <div class="row" style="margin:16px 0">
      ${statusButtons.map(([s, label, cls]) => `<button data-status="${s}" class="${cls || ''}">${label}</button>`).join('')}
      <a href="/api/collections/${c.id}/export.csv"><button type="button">ייצוא לאקסל</button></a>
      <button id="editToggle">עריכה</button>
      ${c.paid_card + c.paid_cash === 0 ? '<button id="delCollection" class="danger">מחיקה</button>' : ''}
    </div>

    <form id="editCollection" class="card inline" hidden>
      <label>נושא<input name="title" required value="${esc(c.title)}" /></label>
      <label>סכום לילד (₪)<input name="amount" type="number" min="1" step="0.5" required value="${c.amount_agorot / 100}" style="width:110px" ${done ? 'disabled title="כבר התקבלו תשלומים"' : ''} /></label>
      <label>ניסיונות חיוג<input name="maxAttempts" type="number" min="1" max="10" value="${c.max_attempts}" style="width:90px" /></label>
      <label>שעות בין ניסיונות<input name="retryHours" type="number" min="1" max="168" value="${c.retry_hours}" style="width:90px" /></label>
      <label>תאריך יעד<input name="dueDate" type="date" value="${esc(c.due_date || '')}" /></label>
      <button class="primary">שמירה</button>
    </form>

    <div class="table-wrap"><table>
      <thead><tr><th>ילד</th><th class="hide-sm">הורה</th><th>טלפון</th><th>סטטוס</th><th class="hide-sm">חיוגים</th><th class="hide-sm">פרטים</th><th>פעולות</th></tr></thead>
      <tbody>
        ${charges
          .map(
            (ch) => `<tr data-id="${ch.id}">
              <td>${esc(ch.child_name)}</td>
              <td class="hide-sm">${esc(ch.parent_name)}</td>
              <td class="ltr">${fmtPhone(ch.phone1)}</td>
              <td><span class="chip ${ch.status}">${STATUS[ch.status]}</span></td>
              <td class="hide-sm">${ch.attempts}/${c.max_attempts}${ch.last_call_at ? `<div class="muted">${fmtDate(ch.last_call_at)}</div>` : ''}</td>
              <td class="hide-sm muted">${ch.status === 'paid' ? `אישור ${esc(ch.confirmation)} · כרטיס ${esc(ch.card_last4)}` : ''}</td>
              <td>${chargeActions(ch)}</td>
            </tr>`,
          )
          .join('')}
      </tbody>
    </table></div>
    <p class="muted">"פטור" - משפחה שלא תחויב ולא יתקשרו אליה (בדיסקרטיות). "דיווח מזומן" - ההורה הקיש בטלפון ששילם במזומן; יש לאשר לאחר בדיקה.</p>`;

  view.querySelectorAll('[data-status]').forEach((b) => {
    b.onclick = async () => {
      if (b.dataset.status === 'active' && !confirm('להתחיל לחייג להורים שטרם שילמו?')) return;
      if (await act(() => api('PUT', `/api/collections/${c.id}`, { status: b.dataset.status }), 'עודכן')) route();
    };
  });
  document.getElementById('editToggle').onclick = () => {
    const f = document.getElementById('editCollection');
    f.hidden = !f.hidden;
  };
  document.getElementById('editCollection').onsubmit = async (e) => {
    e.preventDefault();
    if (await act(() => api('PUT', `/api/collections/${c.id}`, formData(e.target)), 'נשמר')) route();
  };
  const del = document.getElementById('delCollection');
  if (del) {
    del.onclick = async () => {
      if (!confirm('למחוק את הגבייה?')) return;
      if (await act(() => api('DELETE', `/api/collections/${c.id}`), 'נמחק')) location.hash = `#/groups/${group.id}/collections`;
    };
  }

  view.querySelectorAll('[data-action]').forEach((b) => {
    b.onclick = async () => {
      const chargeId = b.closest('tr').dataset.id;
      const action = b.dataset.action;
      if (action === 'call') {
        const r = await act(() => api('POST', `/api/charges/${chargeId}/call`));
        if (r) toast(r.error || (r.dialed ? 'החיוג נשלח' : 'לא בוצע חיוג'), !!r.error);
      } else if (action === 'reset') {
        await act(() => api('POST', `/api/charges/${chargeId}/reset`), 'מונה החיוגים אופס');
      } else {
        await act(() => api('POST', `/api/charges/${chargeId}/status`, { status: action }));
      }
      route();
    };
  });
}

function chargeActions(ch) {
  const btn = (action, label) => `<button class="link" data-action="${action}">${label}</button>`;
  switch (ch.status) {
    case 'pending':
      return [btn('cash', 'שולם במזומן'), btn('exempt', 'פטור'), btn('call', 'חייג עכשיו'), ch.attempts ? btn('reset', 'איפוס חיוגים') : '']
        .filter(Boolean)
        .join(' · ');
    case 'claimed_cash':
      return [btn('cash', 'אישור מזומן'), btn('pending', 'לא התקבל')].join(' · ');
    case 'cash':
    case 'exempt':
      return btn('pending', 'החזרה ל"טרם שולם"');
    default:
      return '';
  }
}

// ---------- simulator ----------
function speechText(parts) {
  return parts
    // Numbers are isolated so they read left-to-right inside the Hebrew text.
    .map((p) => (p.number !== undefined ? `\u2066${p.number}\u2069` : p.digits !== undefined ? `\u2066${p.digits.split('').join(' ')}\u2069` : p.text))
    .join(' ');
}

async function renderSimulator() {
  if (!appStatus) await refreshStatus();
  if (!appStatus.simulatorEnabled) {
    view.innerHTML = `<h1>סימולטור טלפון</h1><div class="card">הסימולטור זמין רק כשהסליקה במצב בדיקה (PAYMENT_PROVIDER=mock), כדי שלא יבוצעו חיובים אמיתיים.</div>`;
    return;
  }
  view.innerHTML = `
    <h1>סימולטור טלפון</h1>
    <p class="muted">כך ההורה שומע ומקיש בטלפון. בסליקת בדיקה: כל כרטיס תקין מאושר, כרטיס שמסתיים ב-0002 נדחה (למשל 4580000000080002). כרטיס לדוגמה: 4580000000000000 · תוקף: 1230 · ת"ז: 000000018 · קוד: 123</p>
    <div class="card phone-sim">
      <form id="dial" class="row">
        <label style="flex:1">טלפון ההורה<input name="phone" type="tel" required placeholder="0527654321" /></label>
        <button class="primary">התקשרות</button>
        <button type="button" id="hang">ניתוק</button>
      </form>
      <div class="speech" id="speech">לחצו "התקשרות" כדי להתחיל שיחה.</div>
      <form id="input" class="row">
        <input name="digits" class="ltr" style="flex:1" placeholder="הקשה (למשל מספר כרטיס)" autocomplete="off" />
        <button class="primary">שליחה #</button>
      </form>
      <div class="keypad" style="margin-top:8px">
        ${['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map((k) => `<button type="button" data-key="${k}">${k}</button>`).join('')}
      </div>
    </div>`;

  let callId = null;
  let phone = null;
  let gather = null;
  const speech = document.getElementById('speech');
  const inputForm = document.getElementById('input');

  async function send(input) {
    if (!callId) return toast('יש להתחיל שיחה', true);
    const r = await act(() => api('POST', '/api/simulator', { callId, phone, input }));
    if (!r) return;
    speech.textContent = speechText(r.say) + (r.hangup ? '\n\n[השיחה הסתיימה]' : '');
    gather = r.gather || null;
    if (r.hangup) callId = null;
  }

  document.getElementById('dial').onsubmit = async (e) => {
    e.preventDefault();
    phone = formData(e.target).phone;
    callId = Math.random().toString(36).slice(2);
    await send(undefined);
  };
  document.getElementById('hang').onclick = async () => {
    if (callId) await api('POST', '/api/simulator', { callId, hangup: true });
    callId = null;
    speech.textContent = '[נותק]';
  };
  inputForm.onsubmit = async (e) => {
    e.preventDefault();
    const v = inputForm.digits.value;
    inputForm.digits.value = '';
    await send(v);
  };
  view.querySelectorAll('[data-key]').forEach((b) => {
    b.onclick = () => {
      if (b.dataset.key === '#') return inputForm.requestSubmit();
      inputForm.digits.value += b.dataset.key;
      // Single-key menu answers go out immediately, like a real phone menu.
      if (gather?.max === 1) inputForm.requestSubmit();
    };
  });
}

// ---------- log ----------
async function renderLog() {
  const [calls, payments] = await Promise.all([api('GET', '/api/calls'), api('GET', '/api/payments')]);
  const callResult = { dialed: 'חויג', answered: 'נענה' };
  view.innerHTML = `
    <h1>יומן</h1>
    <h2>עסקאות אשראי</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>זמן</th><th>טלפון</th><th>סכום</th><th>תוצאה</th><th>אישור</th><th>כרטיס</th></tr></thead>
      <tbody>${payments
        .map(
          (p) => `<tr><td>${fmtDate(p.created_at)}</td><td class="ltr">${fmtPhone(p.phone)}</td><td>${shekels(p.amount_agorot)}</td>
          <td><span class="chip ${p.status === 'approved' ? 'paid' : 'claimed_cash'}">${p.status === 'approved' ? 'אושר' : 'נדחה (' + esc(p.response_code) + ')'}</span></td>
          <td>${esc(p.confirmation)}</td><td>${esc(p.card_last4)}</td></tr>`,
        )
        .join('')}</tbody>
    </table></div>
    <h2>שיחות</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>זמן</th><th>כיוון</th><th>טלפון</th><th>מערכת</th><th>סטטוס</th></tr></thead>
      <tbody>${calls
        .map(
          (c) => `<tr><td>${fmtDate(c.created_at)}</td><td>${c.direction === 'outbound' ? 'יוצאת' : 'נכנסת'}</td>
          <td class="ltr">${fmtPhone(c.phone)}</td><td>${esc(c.provider)}</td><td>${esc(callResult[c.result] || c.result)}</td></tr>`,
        )
        .join('')}</tbody>
    </table></div>`;
}

// ---------- settings ----------
async function renderSettings() {
  await refreshStatus();
  const s = appStatus;
  const h = s.callingHours;
  view.innerHTML = `
    <h1>הגדרות ומצב המערכת</h1>
    ${s.ephemeralSecret ? '<div class="card" style="border-color:var(--bad)">לא הוגדר APP_SECRET - ההתחברות וכתובת ה-IVR ישתנו בכל הפעלה מחדש של השרת.</div>' : ''}
    <div class="card">
      <p><strong>מערכת טלפוניה:</strong> ${esc(s.phoneProvider)} · <strong>סליקה:</strong> ${esc(s.paymentProvider)}</p>
      <p><strong>שעות חיוג:</strong> ${esc(h.start)}-${esc(h.end)} · בימי שישי וערבי חג עד ${esc(h.erevCutoff)} · לא בשבת, יום טוב ותשעה באב
      ${h.blockedDates.length ? `<br/>תאריכים חסומים: ${h.blockedDates.map(esc).join(', ')}` : ''}</p>
      <p><strong>מצב כעת:</strong> ${s.calling.allowed ? 'מותר לחייג' : esc(s.calling.reason)}</p>
      <button id="runDialer">הרצת סבב חיוג עכשיו</button>
    </div>
    ${
      s.phoneProvider === 'yemot'
        ? `<div class="card"><strong>api_link לשלוחת ימות המשיח:</strong><div class="ltr" style="word-break:break-all">${esc(s.ivrUrls.yemot)}</div></div>`
        : ''
    }
    ${
      s.phoneProvider === 'twilio'
        ? `<div class="card"><strong>Twilio Voice URL:</strong><div class="ltr">${esc(s.ivrUrls.twilioVoice)}</div></div>`
        : ''
    }
    <p class="muted">שינוי ההגדרות נעשה בקובץ ‎.env‎ בשרת (ראו README).</p>`;
  document.getElementById('runDialer').onclick = async () => {
    const r = await act(() => api('POST', '/api/dialer/run'));
    if (r) toast(r.skipped ? `לא חויג: ${r.skipped}` : r.error ? r.error : `חויגו ${r.dialed} מספרים`, !!r.error);
  };
}

// ---------- router ----------
async function route() {
  const hash = location.hash.replace(/^#/, '') || '/';
  let m;
  try {
    await refreshStatus();
  } catch {
    return; // not logged in - login screen is shown
  }
  document.getElementById('nav').hidden = false;
  try {
    if ((m = hash.match(/^\/groups\/(\d+)\/children$/))) await renderChildren(m[1]);
    else if ((m = hash.match(/^\/groups\/(\d+)\/edit$/))) await renderGroupEdit(m[1]);
    else if ((m = hash.match(/^\/groups\/(\d+)(\/collections)?$/))) await renderCollections(m[1]);
    else if ((m = hash.match(/^\/collections\/(\d+)$/))) await renderCollection(m[1]);
    else if (hash === '/simulator') await renderSimulator();
    else if (hash === '/log') await renderLog();
    else if (hash === '/settings') await renderSettings();
    else await renderGroups();
  } catch (err) {
    view.innerHTML = `<div class="card">${esc(err.message)}</div>`;
  }
}

window.addEventListener('hashchange', route);
route();
