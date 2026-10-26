import { strict as assert } from 'node:assert';
import { handleCreateRoom } from './handler.ts';

const roomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const body = {
  roomId,
  categoryId: 'games',
  displayName: '  Diogo  ',
};

function request(value: unknown = body): Request {
  return new Request('https://example.invalid/create-room', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
}

Deno.test('creates a room using the verified identity', async () => {
  const response = await handleCreateRoom(
    request({ ...body, hostUserId: 'forged-user' }),
    'verified-user',
    async (parameters) => {
      assert.equal(
        parameters.p_host_user_id,
        'verified-user',
      );
      assert.equal(parameters.p_room_id, roomId);
      assert.equal(parameters.p_display_name, 'Diogo');
      assert.match(parameters.p_code, /^[A-Z0-9]{6}$/);

      return {
        data: {
          id: roomId,
          code: parameters.p_code,
        },
        error: null,
      };
    },
  );

  assert.equal(response.status, 201);
  assert.equal((await response.json()).id, roomId);
});

Deno.test('rejects unavailable categories before calling the database', async () => {
  let calls = 0;

  const response = await handleCreateRoom(
    request({ ...body, categoryId: 'music' }),
    'verified-user',
    async () => {
      calls += 1;
      return { data: null, error: null };
    },
  );

  assert.equal(response.status, 400);
  assert.equal(calls, 0);
});

Deno.test('rejects malformed names and IDs', async () => {
  for (const value of [
    { ...body, displayName: ' ' },
    { ...body, roomId: 'invalid' },
    { ...body, displayName: 'D'.repeat(25) },
  ]) {
    const response = await handleCreateRoom(
      request(value),
      'verified-user',
      async () => {
        throw new Error('The database should not be called.');
      },
    );

    assert.equal(response.status, 400);
  }
});

Deno.test('retries a code collision with the same room identity', async () => {
  let calls = 0;

  const response = await handleCreateRoom(
    request(),
    'verified-user',
    async (parameters) => {
      calls += 1;
      assert.equal(parameters.p_room_id, roomId);

      return calls === 1
        ? {
            data: null,
            error: { code: '23505' },
          }
        : {
            data: { id: roomId },
            error: null,
          };
    },
  );

  assert.equal(response.status, 201);
  assert.equal(calls, 2);
});

Deno.test('stops after five unsuccessful code attempts', async () => {
  let calls = 0;

  const response = await handleCreateRoom(
    request(),
    'verified-user',
    async () => {
      calls += 1;

      return {
        data: null,
        error: { code: '23505' },
      };
    },
  );

  assert.equal(response.status, 503);
  assert.equal(calls, 5);
});