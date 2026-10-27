/** Shared by the local configuration writer and Angular, never by move validation. */
export interface PublicConfiguration {
  supabaseUrl: string;
  supabasePublishableKey: string;
  catalogueId: string;
  transport: 'edge' | 'rpc';
}

export const PREVIEW_CONFIGURATION: PublicConfiguration = {
  supabaseUrl: '',
  supabasePublishableKey: '',
  catalogueId: 'games-reviewed-2026-10-21-v1',
  transport: 'edge',
};

/** A public key is intentionally visible. This check rejects accidental secrets,
 * not forged credentials: Supabase still verifies tokens and enforces RLS. */
export function validatePublicConfiguration(input: unknown): PublicConfiguration {
  if (!input || typeof input !== 'object') throw Error('Public configuration must be a JSON object.');
  const fields = input as Record<string, unknown>;
  if (typeof fields['supabaseUrl'] !== 'string' || typeof fields['supabasePublishableKey'] !== 'string') {
    throw Error('Public configuration needs a project URL and a publishable key.');
  }
  const rawUrl = fields['supabaseUrl'].trim();
  const key = fields['supabasePublishableKey'].trim();
  if (Boolean(rawUrl) !== Boolean(key)) throw Error('Set both SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY, or leave both empty for catalogue preview.');
  let url = '';
  if (rawUrl) {
    let parsed: URL;
    try { parsed = new URL(rawUrl); } catch { throw Error('Use the project URL from Supabase Connect, starting with https://.'); }
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) {
      throw Error('Use HTTPS for hosted Supabase; HTTP is allowed only for a local loopback project.');
    }
    if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
      throw Error('Use only the project origin: no password, query, /rest/v1 or /functions/v1 suffix.');
    }
    url = parsed.origin;
    if (key.startsWith('sb_secret_')) throw Error('A secret key must never be placed in frontend configuration. Use a publishable key.');
    if (key.split('.').length === 3) {
      let role: unknown;
      try {
        const encoded = key.split('.')[1]!.replaceAll('-', '+').replaceAll('_', '/');
        const payload = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '='))) as Record<string, unknown>;
        role = payload['role'];
      } catch { throw Error('The legacy anon key is not a valid JWT-shaped key.'); }
      if (role !== 'anon') throw Error('Only a publishable or legacy anon key belongs in the frontend; service-role and user tokens are rejected.');
    } else if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
      throw Error('Expected a publishable key beginning sb_publishable_, or a legacy anon key.');
    }
  }
  const catalogueId = fields['catalogueId'];
  if (typeof catalogueId !== 'string' || !catalogueId.trim()) throw Error('Public configuration needs a catalogue version ID.');
  if (fields['transport'] !== 'edge' && fields['transport'] !== 'rpc') throw Error('Transport must be edge or rpc.');
  // Whitelist the public fields; unrelated environment secrets are never exported.
  return { supabaseUrl: url, supabasePublishableKey: key, catalogueId, transport: fields['transport'] };
}
