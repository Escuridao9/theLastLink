import {
  accountHandler,
  type AccountDependencies,
  type AccountIdentity,
} from "./handler.ts";
const equal = (a: unknown, b: unknown) => {
  if (JSON.stringify(a) !== JSON.stringify(b))
    throw Error(`Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
};
const user: AccountIdentity = {
  id: "player-one",
  email: "player@example.invalid",
  email_confirmed_at: "2026-10-29",
  is_anonymous: false,
};
function setup(overrides: Partial<AccountDependencies> = {}) {
  const calls: string[] = [];
  const dependencies: AccountDependencies = {
    user: async () => user,
    verifyPassword: async () => {
      calls.push("password");
      return user;
    },
    changePassword: async () => {
      calls.push("change");
    },
    deleteAccount: async (id) => {
      calls.push("delete:" + id);
    },
    closeVerification: async () => {
      calls.push("close");
    },
    ...overrides,
  };
  const request = (body: object, authorization = "Bearer example-token") =>
    new Request("https://example.invalid/account-api", {
      method: "POST",
      headers: { Authorization: authorization },
      body: JSON.stringify(body),
    });
  return { calls, handle: accountHandler(() => dependencies), request };
}
const deletion = {
  action: "delete_account",
  currentPassword: "old password",
  confirmation: "DELETE",
};
Deno.test(
  "account deletion requires both the current password and explicit confirmation",
  async () => {
    const s = setup();
    equal(
      (await s.handle(s.request({ ...deletion, confirmation: "" }))).status,
      400,
    );
    equal(
      (await s.handle(s.request({ ...deletion, currentPassword: "" }))).status,
      400,
    );
    equal(s.calls, []);
  },
);
Deno.test(
  "a wrong password cannot delete an account or change its password",
  async () => {
    const s = setup({ verifyPassword: async () => null });
    equal((await s.handle(s.request(deletion))).status, 403);
    equal(s.calls, []);
  },
);
Deno.test(
  "the verified JWT identity must match the password identity",
  async () => {
    const s = setup({
      verifyPassword: async () => ({ ...user, id: "another-user" }),
    });
    equal((await s.handle(s.request(deletion))).status, 403);
    equal(s.calls, ["close"]);
    equal(
      (await s.handle(s.request({ ...deletion, userId: "another-user" })))
        .status,
      400,
    );
  },
);
Deno.test(
  "anonymous and unverified users cannot use account destruction or password changes",
  async () => {
    const s = setup({ user: async () => ({ ...user, is_anonymous: true }) });
    equal((await s.handle(s.request(deletion))).status, 403);
    equal(s.calls, []);
  },
);
Deno.test(
  "valid deletion only targets the authenticated identity and closes the temporary session",
  async () => {
    const s = setup();
    const response = await s.handle(s.request(deletion));
    equal(response.status, 200);
    equal(await response.json(), { ok: true });
    equal(s.calls, ["password", "delete:player-one", "close"]);
    equal(response.headers.get("Cache-Control"), "no-store");
  },
);
Deno.test(
  "password change verifies confirmation and sends the actual current password to Auth",
  async () => {
    const s = setup({
      changePassword: async (old, next) => {
        equal(old, "old password");
        equal(next, "new password");
      },
    });
    const body = {
      action: "change_password",
      currentPassword: "old password",
      password: "new password",
      confirm: "different",
    };
    equal((await s.handle(s.request(body))).status, 400);
    equal(s.calls, []);
    equal(
      (await s.handle(s.request({ ...body, confirm: "new password" }))).status,
      200,
    );
    equal(s.calls, ["password", "close"]);
  },
);
Deno.test(
  "busy deletion and rate limits produce retryable errors without leaking credentials",
  async () => {
    const s = setup({
      deleteAccount: async () => {
        throw { code: "55P03", message: "private backend detail" };
      },
    });
    const response = await s.handle(s.request(deletion));
    equal(response.status, 409);
    equal(await response.json(), { error: "account_busy_retry" });
    equal(s.calls, ["password", "close"]);
  },
);
Deno.test(
  "missing authentication and malformed or oversized bodies cannot reach account operations",
  async () => {
    const s = setup();
    equal((await s.handle(s.request(deletion, ""))).status, 401);
    equal(
      (
        await s.handle(
          s.request({ ...deletion, currentPassword: "x".repeat(3000) }),
        )
      ).status,
      400,
    );
    equal(s.calls, []);
  },
);
