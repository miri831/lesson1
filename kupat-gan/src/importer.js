// Parses a pasted list / CSV of children into rows.
// Each line: child name, [parent name], phone, [second phone] - in any column order.
// Phone columns are detected by content, so a header row or extra columns are tolerated.

import { normalizePhone } from './phone.js';

function splitLine(line) {
  if (line.includes('\t')) return line.split('\t');
  const sep = line.includes(';') && !line.includes(',') ? ';' : ',';
  const cells = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === sep && !quoted) {
      cells.push(cur);
      cur = '';
    } else cur += ch;
  }
  cells.push(cur);
  return cells;
}

export function parseChildrenList(text) {
  const rows = [];
  const errors = [];
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/);

  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (!line) return;
    const cells = splitLine(line).map((c) => c.trim()).filter(Boolean);
    const phones = [];
    const names = [];
    for (const cell of cells) {
      const phone = /\d{7,}/.test(cell.replace(/\D/g, '')) ? normalizePhone(cell) : null;
      if (phone) phones.push(phone);
      else if (/\d{6,}/.test(cell.replace(/[\s-]/g, ''))) {
        errors.push({ line: idx + 1, text: line, reason: `מספר טלפון לא תקין: ${cell}` });
        return;
      } else names.push(cell);
    }
    if (!phones.length) {
      // Probably a header row ("שם הילד, טלפון") - skip quietly if it's the first line.
      if (idx > 0 || names.length === 0) {
        errors.push({ line: idx + 1, text: line, reason: 'לא נמצא מספר טלפון בשורה' });
      }
      return;
    }
    if (!names.length) {
      errors.push({ line: idx + 1, text: line, reason: 'לא נמצא שם ילד בשורה' });
      return;
    }
    const uniquePhones = [...new Set(phones)];
    rows.push({
      name: names[0],
      parentName: names[1] || '',
      phone1: uniquePhones[0],
      phone2: uniquePhones[1] || null,
    });
  });

  return { rows, errors };
}
