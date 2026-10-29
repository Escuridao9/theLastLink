import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountService } from './core/account.service';
import { CatalogueService } from './core/catalogue.service';
import { ConfigService } from './core/config.service';
import { MatchService } from './core/match.service';
import type { Room } from './core/models';
import { ReviewAccountService } from './design-review/review-account.service';
import { RoomsComponent } from './pages/rooms.component';
import { AccountLinkComponent } from './shared/account-link.component';
import { REQUEST_ID } from './shared/request-id';

@Component({ template: '<p>Arenas</p>' })
class Arenas {}
const room: Room = {
  id: 'invited-room', code: 'ABCDEF123456', hostId: 'host', guestId: 'guest',
  category: 'movies', status: 'ready', matchId: null, revision: 2,
  players: [{ id: 'host', name: 'Alex' }, { id: 'guest', name: 'Diogo' }],
};
function setup() {
  const account = new ReviewAccountService();
  const initialize = vi.spyOn(account, 'initialize');
  const game = {
    backend: { playerId: signal('guest') }, room: signal<Room | null>(null), match: signal(null),
    connection: signal('Live'), error: signal(''), stop: vi.fn(),
    send: vi.fn(async (_action: string, _payload: unknown, _id: string) => ({
      ok: true, duplicate: false, serverTime: new Date().toISOString(), room,
    })),
    watch: vi.fn(async () => { game.room.set(room); }),
  };
  const requestId = vi.fn(() => crypto.randomUUID());
  TestBed.configureTestingModule({ providers: [
    provideRouter([
      { path: 'rooms', component: RoomsComponent },
      { path: 'rooms/:id', component: RoomsComponent },
      { path: 'play', component: Arenas },
    ]),
    { provide: AccountService, useValue: account },
    { provide: MatchService, useValue: game },
    { provide: ConfigService, useValue: { configured: true, issue: signal('') } },
    { provide: CatalogueService, useValue: { loadCategory: vi.fn(() => of({})) } },
    { provide: REQUEST_ID, useValue: requestId },
  ] });
  return { account, initialize, game, requestId };
}
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
afterEach(() => { TestBed.resetTestingModule(); vi.restoreAllMocks(); });

describe('Private invite entry', () => {
  it('shows one name field and submits the invited room instead of creating another', async () => {
    const f = setup();
    const h = await RouterTestingHarness.create('/rooms?code=abcdef123456&category=movies');
    await h.fixture.whenStable();
    const page = h.routeNativeElement!;
    expect(page.querySelector('.ll-room-options')).toBeNull();
    expect(page.querySelector('#room-code')).toBeNull();
    expect(page.querySelectorAll('.ll-invited-form input')).toHaveLength(1);
    expect(f.game.send).not.toHaveBeenCalled();
    const component = h.routeDebugElement!.componentInstance as RoomsComponent;
    component.form.controls.name.setValue('Diogo');
    page.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await h.fixture.whenStable();
    expect(f.game.send).toHaveBeenCalledTimes(1);
    expect(f.game.send).toHaveBeenCalledWith('join', { name: 'Diogo', code: 'ABCDEF123456' }, expect.any(String));
    expect(TestBed.inject(Router).url).toBe('/rooms/invited-room');
    expect(h.routeNativeElement!.textContent).toContain('The host starts the match');
    expect(TestBed.inject(CatalogueService).loadCategory).not.toHaveBeenCalled();
  });
  it('restores a registered name and joins once without showing category or code choices', async () => {
    const f = setup();
    f.account.showAccount();
    const h = await RouterTestingHarness.create('/rooms?code=ABCDEF123456&category=movies');
    await h.fixture.whenStable();
    expect(f.initialize).toHaveBeenCalledTimes(1);
    expect(f.game.send).toHaveBeenCalledTimes(1);
    expect(f.game.send.mock.calls[0].slice(0, 2)).toEqual(['join', { name: 'Diogo', code: 'ABCDEF123456' }]);
    expect(TestBed.inject(Router).url).toBe('/rooms/invited-room');
  });
  it('rejects an incomplete invite before initializing Auth or sending a room command', async () => {
    const f = setup();
    const h = await RouterTestingHarness.create('/rooms?code=SHORT&category=games');
    await h.fixture.whenStable();
    expect(h.routeNativeElement?.querySelector('[role=alert]')?.textContent).toContain('incomplete or invalid');
    expect(f.initialize).not.toHaveBeenCalled();
    expect(f.game.send).not.toHaveBeenCalled();
  });
  it('explains a full room and keeps the guest on the invitation', async () => {
    const f = setup();
    f.game.send.mockRejectedValueOnce(Error('room_full'));
    const h = await RouterTestingHarness.create('/rooms?code=ABCDEF123456');
    await h.fixture.whenStable();
    const component = h.routeDebugElement!.componentInstance as RoomsComponent;
    component.form.controls.name.setValue('Diogo');
    await component.act('join');
    h.detectChanges();
    expect(h.routeNativeElement?.querySelector('[role=alert]')?.textContent).toContain('Both seats are taken');
    expect(TestBed.inject(Router).url).toContain('code=ABCDEF123456');
    expect(f.game.send.mock.calls[0][0]).toBe('join');
  });
  it('retries a lost join response with the same receipt', async () => {
    const f = setup();
    f.game.send.mockRejectedValueOnce(Error('Network interrupted'));
    const h = await RouterTestingHarness.create('/rooms?code=ABCDEF123456');
    await h.fixture.whenStable();
    const component = h.routeDebugElement!.componentInstance as RoomsComponent;
    component.form.controls.name.setValue('Diogo');
    await component.act('join');
    await component.act('join');
    expect(f.game.send.mock.calls[1]).toEqual(f.game.send.mock.calls[0]);
    expect(f.requestId).toHaveBeenCalledTimes(1);
  });
  it('does not auto-join after the visitor leaves while a session is restoring', async () => {
    const f = setup();
    let restore!: () => void;
    f.initialize.mockReturnValueOnce(new Promise<void>((resolve) => { restore = resolve; }));
    const h = await RouterTestingHarness.create('/rooms?code=ABCDEF123456');
    await h.navigateByUrl('/play');
    f.account.showAccount();
    restore();
    await h.fixture.whenStable();
    expect(f.game.send).not.toHaveBeenCalled();
    expect(TestBed.inject(Router).url).toBe('/play');
  });
});

describe('Account navigation wording', () => {
  it('shows both entry options, then My Account for a registered session', async () => {
    const f = setup();
    const fixture = TestBed.createComponent(AccountLinkComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Log in / Sign up');
    f.account.showAccount();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('My Account');
    expect(fixture.nativeElement.textContent).not.toContain('Log in / Sign up');
  });
});
