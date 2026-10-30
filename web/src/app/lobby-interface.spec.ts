import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { of } from 'rxjs';
import { RoomsComponent } from './pages/rooms.component';
import { AccountService } from './core/account.service';
import { ConfigService } from './core/config.service';
import { CatalogueService } from './core/catalogue.service';
import { MatchService } from './core/match.service';
import { leaveWaitingLobby } from './core/lobby-exit.guard';
import { ReviewAccountService } from './design-review/review-account.service';
import type { CommandResponse, Room } from './core/models';

@Component({ template:'<p>Home</p>' }) class Destination {}
async function render() {
  const room:Room={id:'room-one',code:'ABCDEF123456',category:'movies',hostId:'host',guestId:'guest',matchId:null,status:'ready',revision:1,
    players:[{id:'host',name:'Diogo'},{id:'guest',name:'Alex'}],
    lobbyPresence:{host:{connected:true,expiresAt:null},guest:{connected:true,expiresAt:null}}};
  const game={room:signal<Room|null>(null),match:signal(null),backend:{playerId:signal('host')},connection:signal('Live'),error:signal(''),
    stop:vi.fn(),watch:vi.fn(async()=>{game.room.set(room);}),
    send:vi.fn<(...args:unknown[])=>Promise<CommandResponse>>(async()=>({ok:true,duplicate:false,serverTime:new Date().toISOString()}))};
  TestBed.configureTestingModule({providers:[
    provideRouter([{path:'rooms/:id',component:RoomsComponent,canDeactivate:[leaveWaitingLobby]},{path:'rooms',component:Destination},{path:'',component:Destination}]),
    {provide:MatchService,useValue:game},{provide:AccountService,useValue:new ReviewAccountService()},
    {provide:ConfigService,useValue:{configured:true}},{provide:CatalogueService,useValue:{loadCategory:()=>of({})}},
  ]});
  const harness=await RouterTestingHarness.create('/rooms/room-one'); await harness.fixture.whenStable(); harness.detectChanges();
  return {game,room,harness,component:harness.routeDebugElement!.componentInstance as RoomsComponent,router:TestBed.inject(Router)};
}
beforeEach(()=>{localStorage.clear();sessionStorage.clear();});
afterEach(()=>{TestBed.resetTestingModule();vi.restoreAllMocks();});
it('removes Live from the lobby while showing reconnecting seats and blocking start',async()=>{
  const f=await render(); expect(f.harness.routeNativeElement!.querySelector('.ll-live-status')).toBeNull();
  f.game.room.set({...f.room,lobbyPresence:{host:{connected:true,expiresAt:null},guest:{connected:false,expiresAt:null}}});
  f.harness.detectChanges();
  expect(f.harness.routeNativeElement!.textContent).toContain('Reconnecting…');
  expect((f.harness.routeNativeElement!.querySelector('.ll-start') as HTMLButtonElement).disabled).toBe(true);
});
it('leaves a waiting room through the server before navigating to another page',async()=>{
  const f=await render(); await f.router.navigateByUrl('/');
  expect(f.game.send).toHaveBeenCalledExactlyOnceWith('leave',{roomId:'room-one'},expect.any(String));
  expect(f.router.url).toBe('/');
});
it('keeps the lobby open and reports a retryable error if leaving cannot be confirmed',async()=>{
  const f=await render(); f.game.send.mockRejectedValueOnce(Error('Connection interrupted.'));
  expect(await f.router.navigateByUrl('/')).toBe(false); f.harness.detectChanges();
  expect(f.router.url).toBe('/rooms/room-one'); expect(f.harness.routeNativeElement!.textContent).toContain('Connection interrupted');
  await f.router.navigateByUrl('/');
  expect(f.game.send.mock.calls[1][2]).toBe(f.game.send.mock.calls[0][2]);
});
it('does not send a lobby departure when the room has already entered a match',async()=>{
  const f=await render(); f.game.room.set({...f.room,status:'playing',matchId:'match-one'});
  expect(await f.component.canLeave()).toBe(true); expect(f.game.send).not.toHaveBeenCalled();
});
