interface JoinParameters {
  p_user_id: string;
  p_code: string;
  p_category_id: 'games' | 'movies';
  p_display_name: string;
}

interface DatabaseResult {
  data: unknown;
  error: { code?: string } | null;
}

type JoinRoom = (parameters: JoinParameters) => Promise<DatabaseResult>;

function failure(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export async function handleJoinRoom(
  request: Request,
  userId: string,
  joinRoom: JoinRoom,
): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json(
      { error: 'Use POST to join a room.' },
      { status: 405, headers: { Allow: 'POST' } },
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return failure('Send a valid JSON request.', 400);
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return failure('Send valid joining details.', 400);
  }

  const input = body as Record<string, unknown>;
  const roomCode = input['roomCode'];
  const categoryId = input['categoryId'];
  const displayName = input['displayName'];

  if (
    typeof roomCode !== 'string'
    || !/^[A-Z0-9]{6}$/.test(roomCode.trim().toUpperCase())
  ) {
    return failure('Enter a six-character room code.', 400);
  }

  if (categoryId !== 'games' && categoryId !== 'movies') {
    return failure('Choose Games or Movies.', 400);
  }

  if (
    typeof displayName !== 'string'
    || Array.from(displayName.trim()).length < 2
    || Array.from(displayName.trim()).length > 24
  ) {
    return failure('Use a player name between 2 and 24 characters.', 400);
  }

  try {
    const { data, error } = await joinRoom({
      p_user_id: userId,
      p_code: roomCode.trim().toUpperCase(),
      p_category_id: categoryId,
      p_display_name: displayName.trim(),
    });

    if (!error && data !== null) {
      return Response.json(data, { status: 200 });
    }

    switch (error?.code) {
      case '22023':
        return failure('Check your room code, category and player name.', 400);
      case 'LL001':
        return failure('No room in this category matches that code.', 404);
      case 'LL002':
        return failure('This room is no longer accepting players.', 409);
      case 'LL003':
        return failure('This room is full.', 409);
      default:
        console.error('Room joining failed:', error?.code ?? 'empty response');
    }
  } catch {
    console.error('Room joining request failed.');
  }

  return failure('We could not join your room. Please try again.', 503);
}