import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// Fake Jira: two Forge Device fields, a page of tickets, and the app field value endpoint.
const calls = [];
let issues = [];
const fields = [
  { id: 'customfield_100', name: 'Device', schema: { custom: 'ari:cloud:ecosystem::extension/old-app/env/static/previous-device-field' } },
  { id: 'customfield_200', name: 'Device', schema: { custom: 'ari:cloud:ecosystem::extension/new-app/env/static/retailinmotion-device-field' } },
  { id: 'customfield_300', name: 'Device ID', schema: { custom: 'com.atlassian.jira.plugin.system.customfieldtypes:textfield' } }
];
const respond = (body, status = 200) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
mock.module('@forge/api', {
  defaultExport: {
    asApp: () => ({
      requestJira: async (path, options = {}) => {
        calls.push({ path: String(path), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
        if (String(path) === '/rest/api/3/field') return respond(fields);
        if (String(path) === '/rest/api/3/search/jql') return respond({ issues, nextPageToken: null });
        if (String(path).startsWith('/rest/api/3/app/field/customfield_200/value')) return respond(null, 204);
        return respond({ error: 'unexpected' }, 404);
      }
    })
  },
  namedExports: { route: (strings, ...values) => strings.reduce((out, s, i) => out + s + (values[i] ?? ''), '') }
});
const { deviceFields, copyDeviceFieldPage } = await import('../src/device-field-copy.js');

test('finds this app\'s Device field and the previous app\'s one', async () => {
  assert.deepEqual(await deviceFields(), { target: { id: 'customfield_200', name: 'Device' }, sources: [{ id: 'customfield_100', name: 'Device' }] });
});

test('copies values grouped by device, skipping tickets already set or without a value', async () => {
  calls.length = 0;
  issues = [
    { id: '1', fields: { customfield_100: { id: 'A1', name: 'DEV-1' } } },
    { id: '2', fields: { customfield_100: { id: 'A1', name: 'DEV-1' } } },
    { id: '3', fields: { customfield_100: { id: 'A2', name: 'DEV-2' }, customfield_200: { id: 'A2', name: 'DEV-2' } } },
    { id: '4', fields: { customfield_100: { id: 'A3', name: 'DEV-3' }, customfield_200: { id: 'OLD', name: 'X' } } },
    { id: '5', fields: { customfield_100: 'not an object' } }
  ];
  const result = await copyDeviceFieldPage({ sourceFieldId: 'customfield_100' });
  assert.deepEqual(result, { checked: 5, copied: 3, alreadySet: 1, unreadable: 1, nextPageToken: null });
  const search = calls.find((c) => c.path === '/rest/api/3/search/jql');
  assert.equal(search.body.jql, 'cf[100] is not EMPTY ORDER BY key ASC');
  const put = calls.find((c) => c.method === 'PUT');
  assert.equal(put.path, '/rest/api/3/app/field/customfield_200/value?generateChangelog=false');
  assert.deepEqual(put.body.updates, [{ issueIds: [1, 2], value: { id: 'A1', name: 'DEV-1' } }, { issueIds: [4], value: { id: 'A3', name: 'DEV-3' } }]);
});

test('refuses fields that are not another app\'s Device field', async () => {
  await assert.rejects(copyDeviceFieldPage({ sourceFieldId: '' }), /Choose the previous Device field/);
  await assert.rejects(copyDeviceFieldPage({ sourceFieldId: 'customfield_300' }), /not another app's Device field/);
  await assert.rejects(copyDeviceFieldPage({ sourceFieldId: 'customfield_200' }), /not another app's Device field/);
});
