import React, { useEffect, useState } from 'react';

// After restoring a backup from the previous Asset Manager app: copy its Device field values on
// tickets into this app's Device field.
export default function DeviceFieldCopy({ invoke }) {
  const [fields, setFields] = useState(null);
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    invoke('getDeviceFieldsForCopy').then((result) => { setFields(result); if (result?.sources?.length === 1) setSource(result.sources[0].id); }).catch((e) => setError(e?.message || String(e)));
  }, []);

  const copy = async () => {
    setBusy(true); setError('');
    const totals = { checked: 0, copied: 0, alreadySet: 0, unreadable: 0 };
    try {
      let nextPageToken = null;
      do {
        const page = await invoke('copyDeviceFieldPage', { sourceFieldId: source, nextPageToken });
        for (const key of Object.keys(totals)) totals[key] += page?.[key] || 0;
        nextPageToken = page?.nextPageToken || null;
        setStatus(`Copying… ${totals.checked.toLocaleString()} tickets checked, ${totals.copied.toLocaleString()} copied`);
      } while (nextPageToken);
      setStatus(`Done: ${totals.checked.toLocaleString()} tickets checked, ${totals.copied.toLocaleString()} copied, ${totals.alreadySet.toLocaleString()} already set${totals.unreadable ? `, ${totals.unreadable.toLocaleString()} without a usable value` : ''}.`);
    } catch (e) {
      setError(`${e?.message || e} Copying again carries on safely: tickets already copied are skipped.`);
    } finally {
      setBusy(false);
    }
  };

  return <div style={{ marginTop: 16 }}>
    <h3>Copy Device field values</h3>
    <p>After restoring a backup from the previous Asset Manager app, copy the Device chosen on each ticket into this app's Device field. Restore first, so the devices exist.</p>
    {!fields && !error && <p>Looking for Device fields…</p>}
    {fields && !fields.sources.length && <p>No previous Device field was found on this site.</p>}
    {fields?.sources?.length > 0 && <p>
      <select value={source} disabled={busy} onChange={(e) => setSource(e.target.value)}>
        <option value="">Choose the previous Device field…</option>
        {fields.sources.map((field) => <option key={field.id} value={field.id}>{field.name} ({field.id})</option>)}
      </select>{' '}
      <button className="primary" disabled={busy || !source} onClick={copy}>Copy values</button>
    </p>}
    {status && <p role="status">{status}</p>}
    {error && <p role="alert" style={{ color: 'var(--ds-text-danger, #ae2a19)' }}>{error}</p>}
  </div>;
}
