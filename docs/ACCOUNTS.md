# Accounts

The Last Link supports email/password accounts and optional guest play. Account
creation, email confirmation, login, logout, and session restoration use Supabase
Auth. The 20-second server deadline and multiplayer rules are unchanged.

## Architecture

| File                                                  | Responsibility                                                          |
| ----------------------------------------------------- | ----------------------------------------------------------------------- |
| `web/src/app/core/backend.service.ts`                 | The production Supabase client, shared Auth session, and game commands. |
| `web/src/app/core/account.service.ts`                 | Registration, guest upgrades, verification, login, and local logout.    |
| `web/src/app/core/auth-navigation.ts`                 | Confirmation callbacks, base paths, and internal return destinations.   |
| `web/src/app/pages/account.component.*`               | Reactive Forms, validation, loading/errors, and account UI.             |
| `web/src/app/shared/account-link.component.ts`        | Desktop and mobile account navigation.                                  |
| `web/src/app/design-review/review-account.service.ts` | Isolated examples for visual review.                                    |

Account operations share `BackendService.client` with multiplayer. The user's
JWT reaches `match-api`, and PostgreSQL authorizes commands with `auth.uid()`.
Display-name metadata is presentation data and never grants access.

Startup restores an existing session. Visiting the homepage or account screen
does not create a guest; a multiplayer operation creates one when necessary.
The SDK loads on demand for an account operation, a saved session, a confirmation
callback, or multiplayer. A fresh public visit does not load it.

Switching identities stops existing match subscriptions, clears private view
state and pending answers, and rejects late responses. Resume links are saved
per identity in that browser. Logout does not delete matches or pause the server.
The logout button is available for accounts, not unrecoverable guest identities.

Passwords and confirmation codes are never stored by application code in local
storage, session storage, environment files, logs, or public tables. The SDK
persists its session under the existing `last-link-auth` key. Pending email
verification stores only an email, flow type, and guest UUID in the current tab.
An unfinished guest password step stores a UUID flag, never a password.

## Registration flows

New visitors supply a player name, email, password, and matching confirmation.
They confirm the email using its link or the six-digit code in the supplied
template before logging in.

Guests attach an email to their existing Supabase user with `updateUser`, verify
it, then choose a password. Supabase requires verification before adding a guest
password. This flow preserves the UUID and access to existing matches.

Logging in to an existing account switches identity. It does not reassign or
merge guest matches. The login screen explains this distinction.

## Hosted Supabase setup

These are Auth settings, not SQL migrations. `supabase db push` does not apply
them. `supabase/config.toml` configures the local stack; configure the hosted
project through the dashboard:

1. In Authentication settings, enable the email/password provider and new-user
   signups. Keep **Confirm email** enabled. Set the minimum password length to
   at least 8 characters and use six-digit email OTPs.
2. Keep anonymous sign-ins enabled and enable manual identity linking for guest
   registration.
3. Under Authentication → URL Configuration, set the Site URL to:

   ```text
   https://escuridao9.github.io/theLastLink/
   ```

4. Add these exact allowed redirect URLs:

   ```text
   https://escuridao9.github.io/theLastLink/
   http://localhost:4200/
   http://127.0.0.1:4200/
   ```

5. Under Authentication → Email Templates, copy these HTML bodies:
   - **Confirm signup:** `supabase/templates/confirm-signup.html`
   - **Change email address:** `supabase/templates/change-email.html`

   They retain `{{ .ConfirmationURL }}` and display `{{ .Token }}`, enabling both
   link confirmation and the in-app code form.

6. Configure custom SMTP in Supabase before allowing arbitrary addresses to
   register. The default mail service only sends to project team addresses and
   currently limits sending to two messages per hour. SMTP credentials belong
   in Supabase, not Angular or GitHub Pages variables.

The application uses PKCE. Email links return to the deployed base directory;
the initializer consumes `?code=...` before the hash router starts, removes the
code, and opens `#/account`. There is no physical callback path for GitHub Pages
to resolve. Open a PKCE link in the browser that requested it, or enter the code
there. If a new account's email was confirmed in another browser, log in normally
using its password. Guest conversion should be completed in the original guest
browser.

No new table, RLS relaxation, service-role key, database password, or Edge
Function redeployment is required.

## Verification

From the repository root, using the existing public configuration in `web/.env`:

```bash
npm run verify
npm --prefix web run typecheck
npm --prefix web test -- --watch=false
npm --prefix web run build -- --base-href=/theLastLink/
```

Automated Auth tests use transport doubles. They cover registration, conversion,
verification types, password timing, login errors, scoped resume state, logout,
callback cleanup, stale responses, validation, and cleanup. They do not certify
hosted email delivery. Local Supabase email tests can use its captured mail inbox.

Complete these hosted checks after configuring Auth:

1. Register in a fresh browser identity, confirm the email, and check the account
   name and email. Log out, log in again, and refresh.
2. Play a registered-account match against an independent guest browser. Verify
   Realtime, accepted/rejected answers, the timer, and the shared result.
3. In the guest browser, save a finished result URL. Register from that guest
   session, verify the email, and set a password.
4. Log out and sign into that converted account in another browser. Opening the
   saved result URL should retain access, proving the player identity survived.
5. Check invalid credentials, expired codes, resend throttling, mobile navigation,
   and refreshing `#/account?mode=signup` directly on GitHub Pages.
6. Log out or change accounts in another tab of the same browser while a match
   is visible. Private state must clear and late responses must not restore it.
   The match still expires on its server deadline.

Use separate browsers or a regular/private pair for independent players. Tabs
in the same browser intentionally share their account session.

## Visual review

`#/design-review/account` and `#/design-review/account?mode=signup` render the
actual components with route-scoped examples. Review controls offer logged-out,
guest, and account states. Use example code **123456**; **error@example.invalid**
previews a login error. No Auth request or email is sent. These providers are
absent from normal account routes.

## Supabase documentation

- [Anonymous users and conversion](https://supabase.com/docs/guides/auth/auth-anonymous)
- [Password authentication](https://supabase.com/docs/guides/auth/passwords)
- [PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow)
- [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [Email templates](https://supabase.com/docs/guides/auth/auth-email-templates)
- [SMTP restrictions](https://supabase.com/docs/guides/auth/auth-smtp)
