// Retail inMotion edition: an internal app installed only on Retail inMotion sites, with no
// Marketplace listing, so there is no licence to enforce. Every installation is allowed in every
// Forge environment (production included). licensedResolver is kept so the resolvers stay in step
// with the Marketplace edition; it never blocks.
export const LICENCE_INACTIVE_CODE = 'RIM_LICENCE_INACTIVE';
export const LICENCE_INACTIVE_MESSAGE = 'Asset Manager does not have an active licence for this site. Ask a Jira administrator to renew or activate it in Manage apps.';

export function licenceState(context = {}) {
  const environmentType = String(context?.environmentType || '').trim().toUpperCase();
  return { enforced: false, active: true, environmentType: environmentType || 'UNKNOWN' };
}

export function requireActiveLicence(context) {
  const licence = licenceState(context);
  if (licence.enforced && !licence.active) throw new Error(`${LICENCE_INACTIVE_MESSAGE} [${LICENCE_INACTIVE_CODE}]`);
}

// Wraps resolver.define so every resolver checks the licence before running. Apply it
// innermost (guardResolver(licensedResolver(new Resolver()), ...)) so the licence check
// runs before the admin permission call.
export function licensedResolver(resolver) {
  const define = resolver.define.bind(resolver);
  resolver.define = (key, handler) => define(key, async (request) => { requireActiveLicence(request?.context); return handler(request); });
  return resolver;
}
