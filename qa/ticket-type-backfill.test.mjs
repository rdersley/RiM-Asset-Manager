import test, { mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// In-memory storage and a fake Jira that applies the parts of the JQL the backfill relies on:
// "cf[type] is EMPTY", "issuekey > X", key order and page size.
const store = new Map();
mock.module('@forge/kvs', { namedExports: { kvs: {
  get: async (k) => store.get(k), set: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); },
  getSecret: async () => null, setSecret: async () => {}, query: () => ({ where() { return this; }, limit() { return this; }, cursor() { return this; }, getMany: async () => ({ results: [] }) })
}, WhereConditions: { beginsWith: (p) => p } } });

const DEVICE = 'customfield_100';
const TYPE = 'customfield_200';
const OPTIONS = [{ id: '10', value: 'Tablet' }, { id: '11', value: 'Printer' }];
let issues = [];
const calls = [];
let refuse = new Set();
const num = (key) => Number(key.split('-')[1]);
const respond = (body, status = 200) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
const issue = (n, deviceId, { type = null, status = '1' } = {}) => ({ id: String(n), key: `HW-${n}`, fields: { [DEVICE]: deviceId, [TYPE]: type, project: { id: '1', key: 'HW' }, issuetype: { id: '5' }, status: { id: status } } });
mock.module('@forge/api', {
  defaultExport: { asApp: () => ({ requestJira: async (path, options = {}) => {
    const p = String(path); const method = options.method || 'GET';
    calls.push({ path: p, method, body: options.body ? JSON.parse(options.body) : null });
    if (p === '/rest/api/3/search/jql') {
      const { jql, maxResults, nextPageToken } = JSON.parse(options.body);
      let list = issues.filter((i) => i.fields[DEVICE]);
      if (jql.includes('is EMPTY')) list = list.filter((i) => !i.fields[TYPE]);
      const after = /issuekey > "([^"]+)"/.exec(jql)?.[1];
      if (after) list = list.filter((i) => num(i.key) > num(after));
      list.sort((a, b) => num(a.key) - num(b.key));
      const start = Number(nextPageToken || 0);
      const page = list.slice(start, start + maxResults);
      return respond({ issues: structuredClone(page), nextPageToken: !jql.includes('project =') && start + maxResults < list.length ? String(start + maxResults) : undefined });
    }
    const meta = /^\/rest\/api\/3\/issue\/(HW-\d+)\/editmeta$/.exec(p);
    if (meta) { const i = issues.find((x) => x.key === meta[1]); return respond({ fields: i.fields.status.id === '6' ? {} : { [TYPE]: { schema: { type: 'option' }, allowedValues: OPTIONS } } }); }
    const put = /^\/rest\/api\/3\/issue\/(HW-\d+)\?notifyUsers=false$/.exec(p);
    if (put && method === 'PUT') {
      if (refuse.has(put[1])) return respond({ errors: { [TYPE]: 'no' } }, 400);
      issues.find((x) => x.key === put[1]).fields[TYPE] = OPTIONS.find((o) => o.id === JSON.parse(options.body).fields[TYPE].id);
      return respond(null, 204);
    }
    return respond({ error: `unexpected ${method} ${p}` }, 404);
  } }) },
  namedExports: { route: (s, ...v) => s.reduce((o, x, i) => o + x + (v[i] ?? ''), '') }
});
const { backfillTicketTypesPage, backfillSearch } = await import('../src/ticket-type-backfill.js');

const nameKey = (name) => `asset-name:${Buffer.from(name.toLowerCase(), 'utf8').toString('base64url')}`;
function device(id, name, type) { store.set(`asset:${id}`, { id, name, type }); store.set(nameKey(name), { assetId: id, name }); }
async function runAll(apply) {
  const totals = {}; let cursor = {}; let pages = 0;
  while (cursor) {
    const page = await backfillTicketTypesPage({ cursor, apply }); pages += 1;
    for (const [k, v] of Object.entries(page)) if (typeof v === 'number') totals[k] = (totals[k] || 0) + v;
    cursor = page.cursor;
    assert.ok(pages < 50, 'paging never ends');
  }
  return { ...totals, pages };
}

beforeEach(() => {
  store.clear(); calls.length = 0; refuse = new Set();
  store.set('settings:asset-manager', { jiraAssetField: { id: DEVICE }, jiraTypeField: { id: TYPE }, jiraProjectKey: 'HW' });
  device('A1', 'TAB-0001', 'Tablet');
  device('A2', 'PRN-0002', 'Printer');
  device('A3', 'ODD-0003', 'Other');
  device('A4', 'PHN-0004', 'Phone');
  issues = [
    issue(1, 'TAB-0001'),
    issue(2, 'PRN-0002'),
    issue(3, 'TAB-0001', { type: { id: '11', value: 'Printer' } }), // a type someone chose: left alone
    issue(4, 'NOPE-9999'),
    issue(5, 'ODD-0003'),
    issue(6, 'PHN-0004'),
    issue(7, 'TAB-0001 | PRN-0002'),
    issue(8, 'TAB-0001', { status: '6' }),
    issue(9, 'n/a'),
  ];
});

test('the preview counts every outcome and writes nothing', async () => {
  const t = await runAll(false);
  assert.deepEqual({ filled: t.filled, notInRegister: t.notInRegister, noType: t.noType, notAnOption: t.notAnOption, multipleDevices: t.multipleDevices, notEditable: t.notEditable, noDeviceId: t.noDeviceId },
    { filled: 2, notInRegister: 1, noType: 1, notAnOption: 1, multipleDevices: 1, notEditable: 1, noDeviceId: 1 });
  assert.equal(calls.filter((c) => c.method === 'PUT').length, 0);
  assert.equal(issues[0].fields[TYPE], null);
});

test('the fill writes the matching option without notifications, and never changes a type already set', async () => {
  const t = await runAll(true);
  assert.equal(t.filled, 2);
  assert.deepEqual(issues[0].fields[TYPE], { id: '10', value: 'Tablet' });
  assert.deepEqual(issues[1].fields[TYPE], { id: '11', value: 'Printer' });
  assert.deepEqual(issues[2].fields[TYPE], { id: '11', value: 'Printer' });
  const puts = calls.filter((c) => c.method === 'PUT');
  assert.ok(puts.every((c) => c.path.endsWith('?notifyUsers=false')));
  assert.deepEqual(puts.map((c) => c.body.fields[TYPE]).sort((a, b) => a.id.localeCompare(b.id)), [{ id: '10' }, { id: '11' }]);
  // Run again: nothing left to fill.
  calls.length = 0;
  assert.equal((await runAll(true)).filled, 0);
  assert.equal(calls.filter((c) => c.method === 'PUT').length, 0);
});

test('filling many tickets pages by key, so tickets filled meanwhile do not make it skip any', async () => {
  issues = Array.from({ length: 130 }, (_, i) => issue(i + 1, i % 3 === 0 ? 'NOPE-9999' : 'TAB-0001'));
  const t = await runAll(true);
  const fillable = issues.filter((_, i) => i % 3 !== 0).length;
  assert.equal(t.filled, fillable);
  assert.ok(issues.every((i, n) => (n % 3 === 0 ? i.fields[TYPE] === null : i.fields[TYPE]?.value === 'Tablet')));
  assert.equal(t.notInRegister, 130 - fillable);
});

test('editmeta is read once per project, issue type and status, not per ticket', async () => {
  issues = Array.from({ length: 40 }, (_, i) => issue(i + 1, 'TAB-0001', { status: i < 20 ? '1' : '6' }));
  await runAll(false);
  assert.equal(calls.filter((c) => c.path.endsWith('/editmeta')).length, 2);
});

test('a ticket Jira refuses is reported and the rest still fill', async () => {
  refuse = new Set(['HW-1']);
  const page = await backfillTicketTypesPage({ apply: true });
  assert.equal(page.failed, 1);
  assert.equal(page.filled, 1);
  assert.match(page.failures[0].error, /HW-1|400/);
  assert.equal(page.failures[0].key, 'HW-1');
});

test('without a scanned project it pages every ticket with a Device ID and skips typed ones', async () => {
  store.set('settings:asset-manager', { jiraAssetField: { id: DEVICE }, jiraTypeField: { id: TYPE } });
  issues = Array.from({ length: 70 }, (_, i) => issue(i + 1, 'TAB-0001', { type: i < 10 ? { id: '11', value: 'Printer' } : null }));
  const t = await runAll(true);
  assert.equal(t.filled, 60);
  assert.equal(t.alreadySet, 10);
  assert.equal(t.pages, 2);
  assert.ok(issues.slice(0, 10).every((i) => i.fields[TYPE].value === 'Printer'));
});

test('the search is scoped to the project and only empty types, and rejects a forged cursor', () => {
  const settings = { jiraAssetField: { id: DEVICE }, jiraTypeField: { id: TYPE }, jiraProjectKey: 'HW' };
  assert.equal(backfillSearch(settings, { afterKey: 'HW-12' }).jql, 'project = "HW" AND cf[100] is not EMPTY AND cf[200] is EMPTY AND issuekey > "HW-12" ORDER BY key ASC');
  assert.equal(backfillSearch(settings, { afterKey: 'HW-1" OR project = X' }).jql, 'project = "HW" AND cf[100] is not EMPTY AND cf[200] is EMPTY ORDER BY key ASC');
});

test('it needs both fields configured', async () => {
  store.set('settings:asset-manager', { jiraAssetField: { id: DEVICE } });
  await assert.rejects(backfillTicketTypesPage({}), /device type field/);
});
