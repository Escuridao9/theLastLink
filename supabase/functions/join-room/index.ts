import { withSupabase } from '@supabase/server';
import { handleJoinRoom } from './handler.ts';

const handler = withSupabase(
  { auth: 'user' },
  async (request, context) => {
    const userId = context.userClaims?.id;

    if (!userId) {
      return Response.json(
        { error: 'Sign in before joining a room.' },
        { status: 401 },
      );
    }

    return handleJoinRoom(
      request,
      userId,
      async (parameters) => {
        const { data, error } =
          await context.supabaseAdmin.rpc(
            'join_room',
            parameters,
          );

        return { data, error };
      },
    );
  },
);

Deno.serve((request) => handler(request));