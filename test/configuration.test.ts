import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PREVIEW_CONFIGURATION, validatePublicConfiguration } from '../src/configuration.ts';

// All keys in this file are synthetic test values, never usable credentials.
const publicInput = { ...PREVIEW_CONFIGURATION, supabaseUrl: 'https://example.supabase.co/', supabasePublishableKey: 'sb_publishable_synthetic_test_key' };
const legacy = (role: string) => `header.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.synthetic`;

test('preview requires neither account access nor a Supabase project', () => {
  assert.deepEqual(validatePublicConfiguration(PREVIEW_CONFIGURATION), PREVIEW_CONFIGURATION);
});
test('configuration normalizes a project URL and accepts only documented public fields', () => {
  const result = validatePublicConfiguration({ ...publicInput, DATABASE_URL: 'synthetic-private-value', accessToken: 'synthetic-private-value' });
  assert.equal(result.supabaseUrl, 'https://example.supabase.co');
  assert.equal(JSON.stringify(result).includes('synthetic-private-value'), false);
  assert.deepEqual(Object.keys(result).sort(), ['catalogueId','supabasePublishableKey','supabaseUrl','transport']);
});
test('secret, service-role, authenticated-user and malformed keys are rejected', () => {
  for (const key of ['sb_secret_synthetic_test_key', legacy('service_role'), legacy('authenticated'), 'header.invalid.synthetic', 'random-value']) {
    assert.throws(() => validatePublicConfiguration({ ...publicInput, supabasePublishableKey: key }));
  }
  assert.equal(validatePublicConfiguration({ ...publicInput, supabasePublishableKey: legacy('anon') }).supabasePublishableKey, legacy('anon'));
});
test('frontend URL rejects passwords, service suffixes and insecure remote endpoints', () => {
  for (const url of ['https://user:password@example.supabase.co','https://example.supabase.co/rest/v1','https://example.supabase.co?token=synthetic','https://example.supabase.co#value','http://example.supabase.co','file:///tmp/config']) {
    assert.throws(() => validatePublicConfiguration({ ...publicInput, supabaseUrl: url }));
  }
  assert.equal(validatePublicConfiguration({ ...publicInput, supabaseUrl: 'http://127.0.0.1:54321' }).supabaseUrl,'http://127.0.0.1:54321');
});
test('partial configuration and invalid transport/version fail clearly', () => {
  assert.throws(() => validatePublicConfiguration({ ...publicInput, supabaseUrl: '' }), /both/);
  assert.throws(() => validatePublicConfiguration({ ...publicInput, transport: 'unknown' }), /Transport/);
  assert.throws(() => validatePublicConfiguration({ ...publicInput, catalogueId: '' }), /catalogue version/);
});
test('Git ignores local secret file variants while retaining example templates', () => {
  const directory = mkdtempSync(join(tmpdir(), 'last-link-ignore-test-'));
  const environment = { ...process.env };
  for (const name of ['GIT_DIR','GIT_WORK_TREE','GIT_INDEX_FILE','GIT_COMMON_DIR']) delete environment[name];
  try {
    execFileSync('git', ['init','-q',directory], { env: environment });
    writeFileSync(join(directory, '.gitignore'), readFileSync(new URL('../.gitignore', import.meta.url)));
    const output = execFileSync('git', ['-c','core.excludesFile=','check-ignore','--no-index','--stdin'], {
      cwd: directory, input: '.env\n.env.local\n.env.development\nsupabase/functions/.env.local\n.env.example\nsupabase/functions/.env.example\n', encoding: 'utf8', env: environment,
    });
    assert.ok(output.includes('.env.development'));
    assert.equal(output.includes('.env.example'),false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
