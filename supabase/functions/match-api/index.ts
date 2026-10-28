import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { getEdgeEnvironment } from '../_shared/environment.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const actions = new Set(['create','join','room','start','snapshot','submit','expire','concede','rematch','cancel_rematch']);
Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
  if (request.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return reply({ error: 'authentication_required' }, 401);
  // Forward the verified user's JWT. No service-role key is needed or accepted.
  let environment: { url: string; key: string };
  try { environment = getEdgeEnvironment(name => Deno.env.get(name)); }
  catch { return reply({ error: 'server_not_configured' }, 503); }
  const client = createClient(environment.url, environment.key, {
    global: { headers: { Authorization: auth } }, auth: { persistSession: false },
  });
  try {
    const { data: { user }, error: authError } = await client.auth.getUser(auth.slice(7));
    if (authError || !user) return reply({ error: 'authentication_required' }, 401);
  } catch { return reply({ error: 'authentication_unavailable' }, 503); }
  try {
    const raw = await request.text();
    if (raw.length > 8192) return reply({ error: 'invalid_request' }, 400);
    const { action, payload, requestId } = JSON.parse(raw);
    if (!actions.has(action) || typeof payload !== 'object' || !payload ||
        typeof requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(requestId)) {
      return reply({ error: 'invalid_request' }, 400);
    }
    const { data, error } = await client.rpc('game_command', {
      p_action: action, p_payload: payload, p_request_id: requestId,
    });
    if (error) return reply({ error: error.message }, error.code === '42501' ? 403 : 400);
    return reply(data);
  } catch { return reply({ error: 'invalid_request' }, 400); }
});
