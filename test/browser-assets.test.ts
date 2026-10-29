import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(
  readFileSync(new URL('data/browser-assets.manifest.json', root), 'utf8'),
) as {
  sources: Record<string, string>;
  files: Record<string, { sha256: string; bytes: number }>;
};
const sha = (body: Buffer) => createHash('sha256').update(body).digest('hex');

test('frozen source catalogues and fixture inputs retain their recorded hashes', () => {
  for (const [path, expected] of Object.entries(manifest.sources))
    assert.equal(sha(readFileSync(new URL(path, root))), expected, path);
});

test('all generated browser data reproduces the approved publication byte for byte', () => {
  assert.equal(Object.keys(manifest.files).length, 161);
  for (const [path, expected] of Object.entries(manifest.files)) {
    const body = readFileSync(new URL('web/public/' + path, root));
    assert.equal(body.length, expected.bytes, path + ' bytes');
    assert.equal(sha(body), expected.sha256, path + ' hash');
  }
});
