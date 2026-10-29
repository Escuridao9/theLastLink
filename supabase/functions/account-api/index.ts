import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { getEdgeEnvironment } from "../_shared/environment.ts";
import { accountHandler } from "./handler.ts";

function serverKey(): string {
  const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (keys) {
    const values = JSON.parse(keys) as Record<string, unknown>;
    const value =
      values.default ??
      Object.values(values).find(
        (value) => typeof value === "string" && value.startsWith("sb_secret_"),
      );
    if (typeof value === "string" && value.startsWith("sb_secret_"))
      return value;
  }
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) {
    const payload = legacy
      .split(".")[1]
      ?.replaceAll("-", "+")
      .replaceAll("_", "/");
    if (
      payload &&
      JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, "=")))
        .role === "service_role"
    )
      return legacy;
  }
  throw Error("A server key is required.");
}

Deno.serve(
  accountHandler(() => {
    const environment = getEdgeEnvironment((name) => Deno.env.get(name));
    const options = {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    };
    const caller = createClient(environment.url, environment.key, options);
    // Separate, request-local client: checking a password never replaces the browser session.
    const verification = createClient(
      environment.url,
      environment.key,
      options,
    );
    return {
      async user(token) {
        const { data, error } = await caller.auth.getUser(token);
        return error ? null : data.user;
      },
      async verifyPassword(email, password) {
        const { data, error } = await verification.auth.signInWithPassword({
          email,
          password,
        });
        if (error?.code === "invalid_credentials") return null;
        if (error) throw error;
        return data.user;
      },
      async changePassword(current, password) {
        const { error } = await verification.auth.updateUser({
          password,
          current_password: current,
        });
        if (error) throw error;
      },
      async deleteAccount(id) {
        const admin = createClient(environment.url, serverKey(), options);
        // The owner-only RPC and Auth deletion trigger remove related records in one
        // database transaction. Failure rolls the whole account deletion back.
        const { error } = await admin.rpc("delete_player_account", {
          p_user_id: id,
        });
        if (error) throw error;
      },
      async closeVerification() {
        await verification.auth.signOut({ scope: "local" });
      },
    };
  }),
);
