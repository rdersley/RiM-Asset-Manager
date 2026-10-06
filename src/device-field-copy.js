import api, { route } from '@forge/api';

// Moving a site from the previous Asset Manager app: copies each ticket's value in the previous
// app's Device field into this app's Device field. Both fields hold { id, name } with the asset's
// internal id, and a restored backup keeps those ids, so the values carry over unchanged.
// Runs one page of tickets per call; the UI calls it again with nextPageToken until it is done.
export const OWN_DEVICE_FIELD_MODULE = 'retailinmotion-device-field';
const PAGE_SIZE = 100;

const moduleKeyOf = (field) => String(field?.schema?.custom || '').split('/static/')[1] || '';

async function jira(path, options = {}) {
  const response = await api.asApp().requestJira(path, { ...options, headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(options.headers || {}) } });
  if (!response.ok) throw new Error(`Jira returned ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return response.status === 204 ? null : response.json();
}

// This app's Device field, and other apps' Forge "device" fields that could be copied from.
export async function deviceFields() {
  const fields = await jira(route`/rest/api/3/field`);
  const forgeDeviceFields = (fields || []).filter((field) => /-device-field$/.test(moduleKeyOf(field)));
  const target = forgeDeviceFields.find((field) => moduleKeyOf(field) === OWN_DEVICE_FIELD_MODULE) || null;
  const sources = forgeDeviceFields.filter((field) => field !== target).map((field) => ({ id: field.id, name: field.name }));
  return { target: target ? { id: target.id, name: target.name } : null, sources };
}

const sameValue = (a, b) => a?.id === b?.id && a?.name === b?.name;

export async function copyDeviceFieldPage({ sourceFieldId, nextPageToken } = {}) {
  if (!/^customfield_\d+$/.test(String(sourceFieldId || ''))) throw new Error('Choose the previous Device field to copy from.');
  const { target, sources } = await deviceFields();
  if (!target) throw new Error('This app\'s Device field was not found. Open a ticket once so Jira creates it, then try again.');
  if (!sources.some((field) => field.id === sourceFieldId)) throw new Error('That field is not another app\'s Device field.');
  const jql = `cf[${sourceFieldId.replace('customfield_', '')}] is not EMPTY ORDER BY key ASC`;
  const page = await jira(route`/rest/api/3/search/jql`, { method: 'POST', body: JSON.stringify({ jql, fields: [sourceFieldId, target.id], maxResults: PAGE_SIZE, ...(nextPageToken ? { nextPageToken } : {}) }) });
  const issues = page?.issues || [];
  // Issues needing the same value are updated together.
  const updates = new Map();
  let alreadySet = 0;
  let unreadable = 0;
  for (const issue of issues) {
    const value = issue.fields?.[sourceFieldId];
    if (!value?.id || !value?.name) { unreadable += 1; continue; }
    if (sameValue(issue.fields?.[target.id], value)) { alreadySet += 1; continue; }
    const key = JSON.stringify({ id: String(value.id), name: String(value.name) });
    if (!updates.has(key)) updates.set(key, []);
    updates.get(key).push(Number(issue.id));
  }
  let copied = 0;
  const groups = [...updates.entries()].map(([value, issueIds]) => ({ issueIds, value: JSON.parse(value) }));
  for (let i = 0; i < groups.length; i += 50) {
    const batch = groups.slice(i, i + 50);
    await jira(route`/rest/api/3/app/field/${target.id}/value?generateChangelog=false`, { method: 'PUT', body: JSON.stringify({ updates: batch }) });
    copied += batch.reduce((sum, group) => sum + group.issueIds.length, 0);
  }
  return { checked: issues.length, copied, alreadySet, unreadable, nextPageToken: page?.nextPageToken || null };
}
