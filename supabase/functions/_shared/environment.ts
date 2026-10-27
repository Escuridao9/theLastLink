/** Read only Supabase's public client key. Caller identity still comes from Auth. */
export function getEdgeEnvironment(read: (name: string) => string | undefined): { url: string; key: string } {
  const url = read('SUPABASE_URL');
  if (!url) throw Error('Project URL is missing.');
  const rawKeys = read('SUPABASE_PUBLISHABLE_KEYS');
  if (rawKeys) {
    const keys = JSON.parse(rawKeys) as Record<string, unknown>;
    const key = typeof keys['default'] === 'string' ? keys['default'] : Object.values(keys).find(value => typeof value === 'string' && value.startsWith('sb_publishable_'));
    if (typeof key !== 'string' || !key.startsWith('sb_publishable_')) throw Error('A publishable key is missing.');
    return { url, key };
  }
  // Older hosted/local stacks inject the legacy anon key instead.
  const key = read('SUPABASE_ANON_KEY');
  if (!key) throw Error('A publishable or legacy anon key is missing.');
  const encoded = key.split('.')[1]?.replaceAll('-', '+').replaceAll('_', '/');
  if (!encoded) throw Error('Legacy key is invalid.');
  const claims = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '='))) as Record<string, unknown>;
  if (claims['role'] !== 'anon') throw Error('A privileged key cannot be used by this gateway.');
  return { url, key };
}
