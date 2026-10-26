interface RoomParameters {
  p_room_id: string;
  p_host_user_id: string;
  p_category_id: 'games' | 'movies';
  p_display_name: string;
  p_code: string;
}

interface DatabaseResult {
  data: unknown;
  error: { code?: string } | null;
}

type CreateRoom = (
  parameters: RoomParameters,
) => Promise<DatabaseResult>;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function roomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));

  return Array.from(
    bytes,
    (value) => alphabet.charAt(value % alphabet.length),
  ).join('');
}

export async function handleCreateRoom(
  request: Request,
  userId: string,
  createRoom: CreateRoom,
): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json(
      { error: 'Use POST to create a room.' },
      {
        status: 405,
        headers: { Allow: 'POST' },
      },
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: 'Send a valid JSON request.' },
      { status: 400 },
    );
  }

  if (
    typeof body !== 'object'
    || body === null
    || Array.isArray(body)
  ) {
    return Response.json(
      { error: 'Send valid room details.' },
      { status: 400 },
    );
  }

  const input = body as Record<string, unknown>;
  const roomId = input['roomId'];
  const categoryId = input['categoryId'];
  const displayName = input['displayName'];

  if (
    typeof roomId !== 'string'
    || !uuidPattern.test(roomId)
  ) {
    return Response.json(
      { error: 'Invalid room request ID.' },
      { status: 400 },
    );
  }

  if (categoryId !== 'games' && categoryId !== 'movies') {
    return Response.json(
      { error: 'Choose Games or Movies.' },
      { status: 400 },
    );
  }

  if (
    typeof displayName !== 'string'
    || Array.from(displayName.trim()).length < 2
    || Array.from(displayName.trim()).length > 24
  ) {
    return Response.json(
      {
        error: 'Use a player name between 2 and 24 characters.',
      },
      { status: 400 },
    );
  }

  try {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { data, error } = await createRoom({
        p_room_id: roomId,
        p_host_user_id: userId,
        p_category_id: categoryId,
        p_display_name: displayName.trim(),
        p_code: roomCode(),
      });

      if (!error && data !== null) {
        return Response.json(data, { status: 201 });
      }

      if (error?.code === '23505') {
        continue;
      }

      if (error?.code === '22023') {
        return Response.json(
          {
            error:
              'These room details do not match the original request.',
          },
          { status: 400 },
        );
      }

      console.error(
        'Room creation failed:',
        error?.code ?? 'empty response',
      );

      break;
    }
  } catch {
    console.error('Room creation request failed.');
  }

  return Response.json(
    {
      error: 'We could not create your room. Please try again.',
    },
    { status: 503 },
  );
}