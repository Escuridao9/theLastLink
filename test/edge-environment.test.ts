import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getEdgeEnvironment } from '../supabase/functions/_shared/environment.ts';
const syntheticLegacy = (role: string) => `header.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.synthetic`;
test('Edge gateway selects a publishable key without reading any private key', () => {
  const requested: string[] = [];
  const environment: Record<string, string> = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: 'sb_publishable_synthetic' }) };
  const result = getEdgeEnvironment(name => { requested.push(name); return environment[name]; });
  assert.equal(result.key, 'sb_publishable_synthetic');
  assert.deepEqual(requested, ['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEYS']);
});
test('Edge gateway supports legacy anon and named publishable keys', () => {
  const legacy: Record<string,string> = { SUPABASE_URL:'https://example.supabase.co', SUPABASE_ANON_KEY:syntheticLegacy('anon') };
  assert.equal(getEdgeEnvironment(name=>legacy[name]).key,syntheticLegacy('anon'));
  const named: Record<string,string> = { SUPABASE_URL:'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEYS:JSON.stringify({ website:'sb_publishable_synthetic_named' }) };
  assert.equal(getEdgeEnvironment(name=>named[name]).key,'sb_publishable_synthetic_named');
});
test('Edge gateway rejects missing, malformed and privileged fallback keys', () => {
  assert.throws(()=>getEdgeEnvironment(()=>undefined));
  for(const value of [syntheticLegacy('service_role'),'sb_secret_synthetic','broken']) {
    const environment: Record<string,string> = { SUPABASE_URL:'https://example.supabase.co', SUPABASE_ANON_KEY:value };
    assert.throws(()=>getEdgeEnvironment(name=>environment[name]));
  }
  const malformed: Record<string,string> = { SUPABASE_URL:'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEYS:'not json' };
  assert.throws(()=>getEdgeEnvironment(name=>malformed[name]));
});
