import { strict as assert } from 'node:assert';
import { handleJoinRoom } from './handler.ts';

const userId = '22222222-2222-4222-8222-222222222222';
const body = {
  roomCode: ' ab7k2q ',
  categoryId: 'games',
  displayName: '  Marta  ',
};
const savedRoom = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  code: 'AB7K2Q',
  categoryId: 'games',
  displayName: 'Marta',
  seat: 2,
};

function request(value: unknown = body): Request {
  return new Request('https://example.invalid/join-room', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
}

Deno.test('joins using the verified identity and normalized details', async () => {
  const response = await handleJoinRoom(
    request({ ...body, userId: 'forged-user', p_user_id: 'forged-user' }),
    userId,
    async (parameters) => {
      assert.deepEqual(parameters, {
        p_user_id: userId,
        p_code: 'AB7K2Q',
        p_category_id: 'games',
        p_display_name: 'Marta',
      });
      return { data: savedRoom, error: null };
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), savedRoom);
});

Deno.test('supports joining the Movies category', async () => {
  const response = await handleJoinRoom(
    request({ ...body, categoryId: 'movies' }),
    userId,
    async (parameters) => {
      assert.equal(parameters.p_category_id, 'movies');
      return {
        data: { ...savedRoom, categoryId: 'movies' },
        error: null,
      };
    },
  );

  assert.equal(response.status, 200);
  assert.equal((await response.json()).categoryId, 'movies');
});

Deno.test('rejects methods other than POST', async () => {
  const response = await handleJoinRoom(
    new Request('https://example.invalid/join-room'),
    userId,
    async () => {
      throw new Error('The database should not be called.');
    },
  );

  assert.equal(response.status, 405);
  assert.equal(response.headers.get('Allow'), 'POST');
});

Deno.test('rejects malformed JSON and non-object bodies', async () => {
  const invalidRequests = [
    new Request('https://example.invalid/join-room', {
      method: 'POST',
      body: '{',
    }),
    request(null),
    request([]),
    request('invalid'),
  ];

  for (const invalidRequest of invalidRequests) {
    const response = await handleJoinRoom(
      invalidRequest,
      userId,
      async () => {
        throw new Error('The database should not be called.');
      },
    );

    assert.equal(response.status, 400);
  }
});

Deno.test('rejects invalid fields before accessing the database', async () => {
  for (const value of [
    { ...body, roomCode: 'ABC' },
    { ...body, roomCode: 'AB!123' },
    { ...body, roomCode: 123456 },
    { ...body, categoryId: 'music' },
    { ...body, displayName: ' ' },
    { ...body, displayName: 'M'.repeat(25) },
  ]) {
    const response = await handleJoinRoom(
      request(value),
      userId,
      async () => {
        throw new Error('The database should not be called.');
      },
    );

    assert.equal(response.status, 400);
  }
});

for (const [code, status, message] of [
  ['22023', 400, 'Check your room code, category and player name.'],
  ['LL001', 404, 'No room in this category matches that code.'],
  ['LL002', 409, 'This room is no longer accepting players.'],
  ['LL003', 409, 'This room is full.'],
] as const) {
  Deno.test(`maps database error ${code} to HTTP ${status}`, async () => {
    const response = await handleJoinRoom(
      request(),
      userId,
      async () => ({ data: null, error: { code } }),
    );

    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: message });
  });
}

Deno.test('hides unexpected database details', async () => {
  const response = await handleJoinRoom(
    request(),
    userId,
    async () => ({
      data: null,
      error: { code: 'XX000', message: 'Private database detail.' },
    }),
  );

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: 'We could not join your room. Please try again.',
  });
});

Deno.test('handles an unavailable database', async () => {
  const response = await handleJoinRoom(
    request(),
    userId,
    async () => {
      throw new Error('Private connection detail.');
    },
  );

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: 'We could not join your room. Please try again.',
  });
});

Deno.test('rejects an empty database response', async () => {
  const response = await handleJoinRoom(
    request(),
    userId,
    async () => ({ data: null, error: null }),
  );

  assert.equal(response.status, 503);
});