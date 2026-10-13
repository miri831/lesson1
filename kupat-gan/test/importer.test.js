import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChildrenList } from '../src/importer.js';

test('parses comma, tab and quoted lines, skipping a header row', () => {
  const text = [
    'שם הילד,שם ההורה,טלפון',
    'משה כהן, אברהם כהן, 052-7654321, 050-1234567',
    'שרה לוי\t\t03-6181234',
    '"לוי, דוד",יעקב,527654322',
  ].join('\n');
  const { rows, errors } = parseChildrenList(text);
  assert.deepEqual(errors, []);
  assert.deepEqual(rows, [
    { name: 'משה כהן', parentName: 'אברהם כהן', phone1: '0527654321', phone2: '0501234567' },
    { name: 'שרה לוי', parentName: '', phone1: '036181234', phone2: null },
    { name: 'לוי, דוד', parentName: 'יעקב', phone1: '0527654322', phone2: null },
  ]);
});

test('reports bad lines with their line number', () => {
  const { rows, errors } = parseChildrenList('משה, 052-7654321\nרחל\nדוד, 12345678901\n0521111111');
  assert.equal(rows.length, 1);
  assert.deepEqual(
    errors.map((e) => e.line),
    [2, 3, 4],
  );
});
