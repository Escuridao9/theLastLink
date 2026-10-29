export interface AccountIdentity {
  id: string;
  email?: string;
  email_confirmed_at?: string;
  is_anonymous?: boolean;
}
export interface AccountDependencies {
  user(token: string): Promise<AccountIdentity | null>;
  verifyPassword(
    email: string,
    password: string,
  ): Promise<AccountIdentity | null>;
  changePassword(current: string, password: string): Promise<void>;
  deleteAccount(id: string): Promise<void>;
  closeVerification(): Promise<void>;
}
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
export function accountHandler(factory: () => AccountDependencies) {
  return async (request: Request): Promise<Response> => {
    const reply = (error: string | null, status = 200) =>
      new Response(JSON.stringify(error ? { error } : { ok: true }), {
        status,
        headers: {
          ...cors,
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      });
    if (request.method === "OPTIONS")
      return new Response("ok", { headers: cors });
    if (request.method !== "POST") return reply("method_not_allowed", 405);
    const authorization = request.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ") || authorization.length > 8192)
      return reply("authentication_required", 401);
    let body: Record<string, unknown>;
    try {
      const raw = await request.text();
      if (raw.length > 2048) return reply("invalid_request", 400);
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        return reply("invalid_request", 400);
      body = parsed as Record<string, unknown>;
    } catch {
      return reply("invalid_request", 400);
    }
    if (
      !["change_password", "delete_account"].includes(String(body.action)) ||
      Object.keys(body).some(
        (key) =>
          ![
            "action",
            "currentPassword",
            "password",
            "confirm",
            "confirmation",
          ].includes(key),
      )
    )
      return reply("invalid_request", 400);
    const current = body.currentPassword;
    if (typeof current !== "string" || !current.length || current.length > 128)
      return reply("current_password_required", 400);
    if (body.action === "change_password") {
      if (
        typeof body.password !== "string" ||
        body.password.length < 8 ||
        body.password.length > 128
      )
        return reply("weak_password", 400);
      if (body.password !== body.confirm)
        return reply("passwords_do_not_match", 400);
      if (body.password === current) return reply("same_password", 400);
    } else if (body.confirmation !== "DELETE")
      return reply("deletion_confirmation_required", 400);
    let dependencies: AccountDependencies;
    try {
      dependencies = factory();
    } catch {
      return reply("server_not_configured", 503);
    }
    let verified = false;
    try {
      const user = await dependencies.user(authorization.slice(7));
      if (!user) return reply("authentication_required", 401);
      if (user.is_anonymous || !user.email || !user.email_confirmed_at)
        return reply("registered_account_required", 403);
      const passwordUser = await dependencies.verifyPassword(
        user.email,
        current,
      );
      if (!passwordUser) return reply("current_password_incorrect", 403);
      verified = true;
      if (passwordUser.id !== user.id) return reply("account_changed", 403);
      if (body.action === "change_password")
        await dependencies.changePassword(current, body.password as string);
      else await dependencies.deleteAccount(user.id);
      return reply(null);
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "";
      if (["55P03", "40P01", "40001"].includes(code))
        return reply("account_busy_retry", 409);
      if (
        [
          "over_request_rate_limit",
          "over_email_send_rate_limit",
          "over_sign_in_attempts",
        ].includes(code)
      )
        return reply("rate_limit", 429);
      if (
        [
          "weak_password",
          "same_password",
          "current_password_required",
          "current_password_mismatch",
          "current_password_invalid",
          "reauthentication_needed",
        ].includes(code)
      )
        return reply(code, 400);
      return reply("account_operation_failed", 503);
    } finally {
      if (verified) {
        try {
          await dependencies.closeVerification();
        } catch {
          /* No tokens or passwords are logged. */
        }
      }
    }
  };
}
