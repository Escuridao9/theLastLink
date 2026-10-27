import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInviteUrl } from '../src/routing.ts';

test('GitHub Pages invites retain the repository base and hash route', () => {
  assert.equal(buildInviteUrl('https://example.github.io/theLastLink/','/rooms','ABC123DEF456','movies'),
    'https://example.github.io/theLastLink/#/rooms?code=ABC123DEF456&category=movies');
});
test('local and visual-review invites use the same route construction', () => {
  assert.equal(buildInviteUrl('http://localhost:4200/','/design-review/rooms','EXAMPLE12345','games'),
    'http://localhost:4200/#/design-review/rooms?code=EXAMPLE12345&category=games');
});
test('invite values are encoded and cannot escape into another origin', () => {
  const url=new URL(buildInviteUrl('https://example.test/app/','/rooms','A&B# C','movies'));
  assert.equal(url.origin,'https://example.test');
  const query=new URLSearchParams(url.hash.slice(url.hash.indexOf('?')+1));
  assert.equal(query.get('code'),'A&B# C');
  assert.throws(()=>buildInviteUrl('https://example.test/','//other.test','code','games'));
});
