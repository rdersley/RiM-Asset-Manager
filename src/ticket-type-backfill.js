import api, { route } from '@forge/api';
import { kvs } from '@forge/kvs';
import { findDevice, firstValue, identifiersIn, normaliseName, SETTINGS_KEY, typeFieldValue } from './status-sync.js';

// Fills the device type on existing tickets from the register: the same rule new tickets get
// (status-sync.js fillTypeFromRegister), run over past tickets. Only an empty device type field
// is filled, only in the project Asset Manager scans, and Jira sends no notifications.
// Runs one page per call; the UI calls again with the returned cursor until done. With
// apply=false nothing is written and the counts show what a fill would do.
const PAGE_SIZE = 50;
const CONCURRENCY = 5;
const SAMPLE_SIZE = 20;

const clean = (value) => (typeof value === 'string' ? value.trim() : '');
const fieldNumber = (id) => String(id).replace('customfield_', '');

// Jira's rate limit (429): wait as asked, a couple of times, then give the page back to the UI
// to retry later. Waits stay short so a page fits in Forge's time limit.
export class RateLimited extends Error { constructor(retryAfter) { super('Jira rate limit'); this.retryAfter = retryAfter; } }
export const timing = { wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) };
const RETRIES = 2;
async function jira(path, options = {}) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await api.asApp().requestJira(path, { ...options, headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(options.headers || {}) } });
    if (response.status !== 429) return response;
    const retryAfter = Math.max(1, Math.min(Number(response.headers?.get?.('Retry-After')) || 2, 30));
    if (attempt >= RETRIES) throw new RateLimited(retryAfter);
    await timing.wait(Math.min(retryAfter, 4) * 1000 * (attempt + 1));
  }
}

// The search. With a project, tickets with an empty type are read in key order from just after
// the last one seen, so tickets filled meanwhile can't shift the pages. Without a project the
// search covers every ticket with a Device ID (filling a type doesn't change that set) and
// tickets that already have a type are skipped here.
export function backfillSearch(settings, cursor = {}) {
  const deviceFieldId = clean(settings.jiraAssetField?.id);
  const typeFieldId = clean(settings.jiraTypeField?.id);
  const projectKey = clean(settings.jiraProjectKey).replace(/[^A-Za-z0-9_-]/g, '');
  const afterKey = /^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(clean(cursor.afterKey)) ? clean(cursor.afterKey) : '';
  const jql = projectKey
    ? `project = "${projectKey}" AND cf[${fieldNumber(deviceFieldId)}] is not EMPTY AND cf[${fieldNumber(typeFieldId)}] is EMPTY${afterKey ? ` AND issuekey > "${afterKey}"` : ''} ORDER BY key ASC`
    : `cf[${fieldNumber(deviceFieldId)}] is not EMPTY ORDER BY key ASC`;
  return { jql, body: { jql, fields: [deviceFieldId, typeFieldId, 'project', 'issuetype', 'status'], maxResults: PAGE_SIZE, ...(!projectKey && cursor.nextPageToken ? { nextPageToken: cursor.nextPageToken } : {}) }, projectKey };
}

const emptyTotals = () => ({ checked: 0, filled: 0, alreadySet: 0, noDeviceId: 0, multipleDevices: 0, notInRegister: 0, noType: 0, notAnOption: 0, notEditable: 0, failed: 0 });

export async function backfillTicketTypesPage({ cursor = {}, apply = false } = {}) {
  try {
    return await backfillPage(cursor, apply);
  } catch (error) {
    // Nothing from this page is counted; the same page is read again, which is safe: filled
    // tickets no longer match (or count as already set), and a preview writes nothing.
    if (error instanceof RateLimited) return { apply, ...emptyTotals(), rateLimited: true, retryAfterSeconds: error.retryAfter, byType: {}, notAnOptionTypes: {}, notInRegisterSample: [], fillSample: [], failures: [], cursor, done: false };
    throw error;
  }
}

async function backfillPage(cursor, apply) {
  const settings = (await kvs.get(SETTINGS_KEY)) || {};
  const deviceFieldId = clean(settings.jiraAssetField?.id);
  const typeFieldId = clean(settings.jiraTypeField?.id);
  if (!/^customfield_\d+$/.test(deviceFieldId) || !/^customfield_\d+$/.test(typeFieldId)) throw new Error('Choose the Jira Device ID field and the Jira device type field in Configuration first.');

  const { body, projectKey } = backfillSearch(settings, cursor);
  const response = await jira(route`/rest/api/3/search/jql`, { method: 'POST', body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`Jira could not search for tickets (${response.status}).`);
  const page = await response.json();
  const issues = Array.isArray(page?.issues) ? page.issues : [];

  const totals = emptyTotals();
  const byType = {}; const notAnOptionTypes = {}; const notInRegisterSample = []; const fillSample = []; const failures = [];
  const count = (map, key) => { map[key] = (map[key] || 0) + 1; };
  // Whether the type field can be edited, and its options, depend on project, issue type and
  // status, so editmeta is read once per combination rather than once per ticket.
  const metaCache = new Map();
  const typeFieldDef = (issue) => {
    const key = [issue.fields?.project?.id, issue.fields?.issuetype?.id, issue.fields?.status?.id].join('|');
    if (!metaCache.has(key)) metaCache.set(key, jira(route`/rest/api/3/issue/${issue.key}/editmeta`).then(async (r) => (r.ok ? (await r.json()).fields?.[typeFieldId] || null : null)).catch((e) => { if (e instanceof RateLimited) throw e; return null; }));
    return metaCache.get(key);
  };

  const handle = async (issue) => {
    totals.checked += 1;
    const fields = issue.fields || {};
    if (firstValue(fields[typeFieldId])) { totals.alreadySet += 1; return; }
    const ids = identifiersIn(fields[deviceFieldId]);
    if (!ids.length) { totals.noDeviceId += 1; return; }
    if (ids.length > 1) { totals.multipleDevices += 1; return; }
    const device = await findDevice(deviceFieldId, ids[0]);
    if (!device) { totals.notInRegister += 1; if (notInRegisterSample.length < SAMPLE_SIZE) notInRegisterSample.push({ key: issue.key, deviceId: ids[0] }); return; }
    const type = clean(device.type);
    // "Other" is what devices get when nobody set a type; it says nothing useful on a ticket.
    if (!type || normaliseName(type) === 'other') { totals.noType += 1; return; }
    const def = await typeFieldDef(issue);
    if (!def) { totals.notEditable += 1; return; }
    const value = typeFieldValue(def, type);
    if (value === null) { totals.notAnOption += 1; count(notAnOptionTypes, type); return; }
    if (apply) {
      const put = await jira(route`/rest/api/3/issue/${issue.key}?notifyUsers=false`, { method: 'PUT', body: JSON.stringify({ fields: { [typeFieldId]: value } }) });
      if (!put.ok) {
        totals.failed += 1;
        let detail = ''; try { detail = JSON.stringify(await put.json()).slice(0, 200); } catch { /* no body */ }
        if (failures.length < SAMPLE_SIZE) failures.push({ key: issue.key, error: `Jira returned ${put.status}${detail ? `: ${detail}` : ''}` });
        return;
      }
    }
    totals.filled += 1; count(byType, type);
    if (fillSample.length < SAMPLE_SIZE) fillSample.push({ key: issue.key, deviceId: ids[0], type });
  };

  let next = 0; let halted = false;
  const worker = async () => { while (next < issues.length && !halted) { try { await handle(issues[next++]); } catch (e) { halted = true; throw e; } } };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, issues.length) }, worker));

  const done = projectKey ? issues.length < PAGE_SIZE : !page?.nextPageToken;
  const nextCursor = done ? null : projectKey ? { afterKey: issues.at(-1).key } : { nextPageToken: page.nextPageToken };
  return { apply, ...totals, byType, notAnOptionTypes, notInRegisterSample, fillSample, failures, cursor: nextCursor, done };
}
