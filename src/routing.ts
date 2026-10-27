/** Build an invite that survives static-host refreshes and repository base paths. */
export function buildInviteUrl(baseUri: string, route: string, code: string, category: string): string {
  if (!route.startsWith('/') || route.startsWith('//')) throw Error('Invalid application route.');
  const url = new URL(baseUri);
  url.search = '';
  url.hash = `${route}?${new URLSearchParams({ code, category })}`;
  return url.href;
}
