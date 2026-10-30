/** Confirmation links return to the deployed base path, before the hash router. */
export function authRedirectUrl(baseUri: string, recovery = false): string {
  const url = new URL(baseUri);
  url.search = '';
  url.hash = '';
  if (recovery) url.searchParams.set('auth', 'recovery');
  return url.href;
}

export function accountReturnPath(value: string | null): string {
  if (!value || !/^\/(?:play|rooms|match|results|catalogue)(?:\/|\?|$)/.test(value)) return '/play';
  if (/[\\\u0000-\u001f#]/.test(value) || /(?:^|\/)\.\.(?:\/|$|\?)/.test(value)) return '/play';
  return value;
}

export function isDesignReviewUrl(href: string): boolean {
  return /^#\/design-review(?:\/|\?|$)/.test(new URL(href).hash);
}

export function readAuthRedirect(
  href: string,
): { code: string | null; failed: boolean; cleanUrl: string; recovery?: boolean } | null {
  const url = new URL(href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const hasLegacyTokens = fragment.has('access_token') || fragment.has('refresh_token');
  const failed = url.searchParams.has('error') || fragment.has('error') || hasLegacyTokens;
  const code = url.searchParams.get('code');
  const recovery = url.searchParams.get('auth') === 'recovery';
  if (!url.searchParams.has('code') && !failed) return null;
  for (const name of ['code', 'error', 'error_code', 'error_description'])
    url.searchParams.delete(name);
  if (recovery) url.searchParams.delete('auth');
  url.hash = recovery ? '/account?mode=reset' : '/account';
  return {
    code: failed ? null : code,
    failed: failed || !code,
    cleanUrl: url.pathname + url.search + url.hash,
    ...(recovery ? { recovery: true } : {}),
  };
}
