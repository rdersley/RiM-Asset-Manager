import React, { useRef, useState } from 'react';

// Fill the device type on past tickets from the register (empty type fields only). A preview
// counts what would change; the fill then writes page by page and can be stopped and re-run.
const LABELS = [
  ['filled', 'Device type filled in', 'Device type would be filled in'],
  ['notInRegister', 'Device ID not in the register'],
  ['noType', 'Device has no type in the register (or "Other")'],
  ['notAnOption', 'Device type is not an option on the Jira field'],
  ['notEditable', 'Device type field can\'t be edited on the ticket (e.g. closed tickets)'],
  ['multipleDevices', 'More than one Device ID on the ticket'],
  ['noDeviceId', 'No usable Device ID'],
  ['alreadySet', 'Already has a device type'],
  ['failed', 'Jira refused the update'],
];
const NUMBERS = LABELS.map(([key]) => key).concat('checked');
const addCounts = (into, from) => { for (const [k, v] of Object.entries(from || {})) into[k] = (into[k] || 0) + v; };
const addSample = (into, from) => into.concat(from || []).slice(0, 20);

export default function TicketTypeBackfill({ invoke }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [previewed, setPreviewed] = useState(false);
  const [error, setError] = useState('');
  const stop = useRef(false);

  const run = async (apply) => {
    if (apply && !window.confirm('Fill the device type on the tickets counted in the preview? Each ticket is updated by Asset Manager without email notifications. Its Updated date changes, and Jira Automation rules that react to field changes may run.')) return;
    setBusy(true); setError(''); stop.current = false;
    const totals = { apply, checked: 0, byType: {}, notAnOptionTypes: {}, notInRegisterSample: [], fillSample: [], failures: [], done: false };
    for (const key of NUMBERS) totals[key] = 0;
    setResult({ ...totals });
    try {
      let cursor = {};
      while (cursor && !stop.current) {
        const page = await invoke('backfillTicketTypesPage', { cursor, apply });
        for (const key of NUMBERS) totals[key] += page?.[key] || 0;
        addCounts(totals.byType, page?.byType); addCounts(totals.notAnOptionTypes, page?.notAnOptionTypes);
        totals.notInRegisterSample = addSample(totals.notInRegisterSample, page?.notInRegisterSample);
        totals.fillSample = addSample(totals.fillSample, page?.fillSample);
        totals.failures = addSample(totals.failures, page?.failures);
        cursor = page?.cursor || null;
        totals.done = !cursor;
        setResult({ ...totals });
      }
      if (!apply && totals.done) setPreviewed(true);
    } catch (e) {
      setError(`${e?.message || e} Running it again is safe: tickets that already have a type are skipped.`);
    } finally {
      setBusy(false);
    }
  };

  const r = result;
  const typeRows = (map) => Object.entries(map || {}).sort((a, b) => b[1] - a[1]);
  return <div className="card form-card" style={{ marginTop: 16 }}>
    <h2>Fill device types on past tickets</h2>
    <p className="muted">For tickets in the scanned project whose Device ID is a device in the register, fills an empty device type field with that device's type. A type already on a ticket is never changed. Uses the saved configuration. Preview first: nothing is written until you select Fill device types.</p>
    <div className="actions" style={{ justifyContent: 'flex-start' }}>
      <button className="secondary" disabled={busy} onClick={() => run(false)}>{busy && !r?.apply ? 'Previewing…' : 'Preview'}</button>
      <button className="primary" disabled={busy || !previewed || !(r && !r.apply ? r.filled : true)} onClick={() => run(true)}>{busy && r?.apply ? 'Filling…' : 'Fill device types'}</button>
      {busy && <button className="secondary" onClick={() => { stop.current = true; }}>Stop</button>}
    </div>
    {r && <div style={{ marginTop: 12 }}>
      <p role="status"><strong>{r.apply ? (r.done ? 'Fill complete' : busy ? 'Filling…' : 'Fill stopped') : (r.done ? 'Preview complete' : busy ? 'Previewing…' : 'Preview stopped')}</strong>: {r.checked.toLocaleString()} tickets checked.</p>
      <div className="table-wrap"><table aria-label="Device type fill results"><tbody>
        {LABELS.filter(([key]) => r[key]).map(([key, done, would]) => <tr key={key} style={{ cursor: 'default' }}><td>{!r.apply && would ? would : done}</td><td><strong>{r[key].toLocaleString()}</strong></td></tr>)}
      </tbody></table></div>
      {typeRows(r.byType).length > 0 && <p><small>By type: {typeRows(r.byType).map(([t, n]) => `${t} ${n.toLocaleString()}`).join(', ')}</small></p>}
      {typeRows(r.notAnOptionTypes).length > 0 && <p><small>Types that aren't options on the Jira field (add them to the field, or rename the devices' type): {typeRows(r.notAnOptionTypes).map(([t, n]) => `${t} (${n.toLocaleString()})`).join(', ')}</small></p>}
      {r.fillSample.length > 0 && <p><small>{r.apply ? 'Filled' : 'Would fill'}, for example: {r.fillSample.slice(0, 10).map((x) => `${x.key} → ${x.type}`).join(', ')}</small></p>}
      {r.notInRegisterSample.length > 0 && <p><small>Device IDs not in the register, for example: {r.notInRegisterSample.slice(0, 10).map((x) => `${x.key} (${x.deviceId})`).join(', ')}</small></p>}
      {r.failures.length > 0 && <p><small>Refused by Jira: {r.failures.slice(0, 5).map((x) => `${x.key}: ${x.error}`).join('; ')}</small></p>}
    </div>}
    {error && <p role="alert" className="notice">{error}</p>}
  </div>;
}
