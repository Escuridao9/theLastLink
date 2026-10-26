import { withSupabase } from '@supabase/server';
import { handleCreateRoom } from './handler.ts';

const handler = withSupabase(
  { auth: 'user' },
  async (request, context) => {
    const userId = context.userClaims?.id;

    if (!userId) {
      return Response.json(
        { error: 'Sign in before creating a room.' },
        { status: 401 },
      );
    }

    return handleCreateRoom(
      request,
      userId,
      async (parameters) => {
        const { data, error } =
          await context.supabaseAdmin.rpc(
            'create_room',
            parameters,
          );

        return { data, error };
      },
    );
  },
);

Deno.serve((request) => handler(request));