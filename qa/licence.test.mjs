import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const requests = [];
mock.module('@forge/api', {
  defaultExport: { asUser: () => ({ requestJira: async (path) => { requests.push(String(path)); return { ok: true, json: async () => ({ permissions: { ADMINISTER: { havePermission: true } } }) }; } }) },
  namedExports: { route: (strings, ...values) => strings.reduce((out, s, i) => out + s + (values[i] ?? ''), '') }
});
const { licenceState, requireActiveLicence, licensedResolver, LICENCE_INACTIVE_CODE, LICENCE_INACTIVE_MESSAGE } = await import('../src/licence.js');
const ui = await import('../shared/licence.js');

function fakeResolver() { const defs = {}; return { defs, define: (key, handler) => { defs[key] = handler; } }; }
const prod = (license) => ({ environmentType: 'PRODUCTION', ...(license === undefined ? {} : { license }) });

test('the internal edition never blocks, in any environment or licence state', async () => {
  for (const environmentType of ['PRODUCTION', 'production', 'DEVELOPMENT', 'STAGING', '', undefined]) {
    for (const license of [undefined, null, {}, { isActive: false }, { isActive: true }]) {
      const context = { environmentType, license };
      assert.deepEqual([licenceState(context).enforced, licenceState(context).active], [false, true]);
      assert.doesNotThrow(() => requireActiveLicence(context));
    }
  }
  assert.doesNotThrow(() => requireActiveLicence(undefined));
  const resolver = licensedResolver(fakeResolver());
  resolver.define('getPortalAssets', async ({ payload }) => `ok:${payload.n}`);
  assert.equal(await resolver.defs.getPortalAssets({ payload: { n: 1 }, context: prod(undefined) }), 'ok:1');
});

test('the internal manifest does not enable Marketplace licensing', () => {
  assert.doesNotMatch(fs.readFileSync(new URL('../manifest.yml', import.meta.url), 'utf8'), /licensing:\s*\r?\n\s+enabled:\s*true/);
});

test('resolvers are all licence-wrapped', () => {
  for (const file of ['index.js', 'ticket-sync.js', 'issue-panel.js', 'device-split.js', 'portal-assets.js']) {
    const source = fs.readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    assert.match(source, /licensedResolver\(new Resolver\(\)\)/, `${file} must use licensedResolver`);
  }
});

test('UI helper recognises the Forge-wrapped licence error and shows the friendly message', async () => {
  const bridged = new Error(`There was an error invoking the function - ${LICENCE_INACTIVE_MESSAGE} [${LICENCE_INACTIVE_CODE}]`);
  assert.equal(ui.LICENCE_INACTIVE_CODE, LICENCE_INACTIVE_CODE);
  assert.equal(ui.LICENCE_INACTIVE_MESSAGE, LICENCE_INACTIVE_MESSAGE);
  assert.equal(ui.isLicenceInactive(bridged), true);
  assert.equal(ui.errorMessage(bridged, 'fallback'), LICENCE_INACTIVE_MESSAGE);
  assert.equal(ui.isLicenceInactive(new Error('Only Jira administrators can perform this action.')), false);
  assert.equal(ui.errorMessage(new Error('boom'), 'fallback'), 'boom');
  assert.equal(ui.errorMessage(null, 'fallback'), 'fallback');
});
