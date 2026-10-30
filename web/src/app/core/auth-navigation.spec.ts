import { describe, it, expect } from 'vitest';
import {
  accountReturnPath,
  authRedirectUrl,
  isDesignReviewUrl,
  readAuthRedirect,
} from './auth-navigation';
describe('Account routing on GitHub Pages', () => {
  it('identifies recovery callbacks without accepting a URL as authentication', () => {
    expect(authRedirectUrl('https://example.github.io/theLastLink/#/account',true)).toBe('https://example.github.io/theLastLink/?auth=recovery');
    expect(readAuthRedirect('https://example.github.io/theLastLink/?auth=recovery&code=once')).toEqual({
      code:'once',failed:false,recovery:true,cleanUrl:'/theLastLink/#/account?mode=reset',
    });
    expect(readAuthRedirect('https://example.github.io/theLastLink/?auth=recovery')).toBeNull();
  });
  it('keeps the production base directory and removes router fragments from email redirects', () => {
    expect(authRedirectUrl('https://example.github.io/theLastLink/?campaign=one#/account')).toBe(
      'https://example.github.io/theLastLink/',
    );
    expect(authRedirectUrl('http://localhost:4200/')).toBe('http://localhost:4200/');
  });
  it('retains an internal room invite after logging in', () => {
    expect(accountReturnPath('/rooms?code=ABCDEF123456&category=games')).toBe(
      '/rooms?code=ABCDEF123456&category=games',
    );
    expect(accountReturnPath('/match/match-one')).toBe('/match/match-one');
  });
  it('does not accept external destinations or account redirect loops', () => {
    for (const value of [
      null,
      'https://evil.invalid',
      '//evil.invalid',
      '/account',
      '/rooms\\evil.invalid',
      '/rooms/../account',
      '/match/one\n',
    ])
      expect(accountReturnPath(value)).toBe('/play');
  });
  it('removes a PKCE code before the hash router starts and opens the account view', () => {
    expect(
      readAuthRedirect('https://example.github.io/theLastLink/?code=one-time-code&campaign=one'),
    ).toEqual({
      code: 'one-time-code',
      failed: false,
      cleanUrl: '/theLastLink/?campaign=one#/account',
    });
  });
  it('strips failed confirmation details and legacy fragment tokens', () => {
    for (const suffix of [
      '?error=access_denied&error_description=private-detail',
      '#error=denied&error_description=private-detail',
      '#access_token=private&refresh_token=private',
    ]) {
      const result = readAuthRedirect('https://example.github.io/theLastLink/' + suffix)!;
      expect(result.failed).toBe(true);
      expect(result.cleanUrl).toBe('/theLastLink/#/account');
      expect(result.code).toBeNull();
    }
  });
  it('reports an empty confirmation code as a failed callback', () => {
    expect(readAuthRedirect('https://example.github.io/theLastLink/?code=')?.failed).toBe(true);
  });
  it('leaves ordinary hash routes untouched', () => {
    expect(readAuthRedirect('https://example.github.io/theLastLink/#/match/one')).toBeNull();
  });
  it('identifies only the isolated design-review route', () => {
    expect(isDesignReviewUrl('http://localhost:4200/#/design-review/account?mode=signup')).toBe(
      true,
    );
    expect(isDesignReviewUrl('http://localhost:4200/#/account')).toBe(false);
    expect(isDesignReviewUrl('http://localhost:4200/#/design-review-other')).toBe(false);
  });
});
