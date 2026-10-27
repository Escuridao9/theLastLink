import { DatePipe, TitleCasePipe } from '@angular/common';
import {
  Component,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import type {
  LobbyRoom,
  RoomConnectionStatus,
} from '../../core/models/room';
import { AuthService } from '../../core/services/auth.service';
import { LobbyService } from '../../core/services/lobby.service';

@Component({
  selector: 'app-lobby',
  imports: [RouterLink, DatePipe, TitleCasePipe],
  templateUrl: './lobby.component.html',
  styleUrl: './lobby.component.css',
})
export class Lobby implements OnInit, OnDestroy {
  readonly auth = inject(AuthService);

  private readonly service = inject(LobbyService);
  private readonly route = inject(ActivatedRoute);

  private routeSubscription?: Subscription;
  private stopWatching: (() => void) | null = null;
  private generation = 0;
  private requestNumber = 0;

  readonly room = signal<LobbyRoom | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly connection =
    signal<RoomConnectionStatus>('connecting');

  readonly seats = [1, 2] as const;

  ngOnInit(): void {
    this.routeSubscription = this.route.paramMap.subscribe(
      (params) => {
        void this.open(params.get('roomId') ?? '');
      },
    );
  }

  ngOnDestroy(): void {
    this.generation += 1;
    this.routeSubscription?.unsubscribe();
    this.stopWatching?.();
  }

  playerAt(seat: 1 | 2) {
    return this.room()?.players.find(
      (player) => player.seat === seat,
    );
  }

  retry(): void {
    void this.open(
      this.route.snapshot.paramMap.get('roomId') ?? '',
    );
  }

  private async open(roomId: string): Promise<void> {
    const generation = ++this.generation;

    this.stopWatching?.();
    this.stopWatching = null;
    this.room.set(null);
    this.connection.set('connecting');

    await this.reload(roomId, generation);

    if (generation !== this.generation || !this.room()) {
      return;
    }

    try {
      this.stopWatching = this.service.watch(
        roomId,
        () => {
          void this.reload(roomId, generation);
        },
        (status) => {
          if (generation === this.generation) {
            this.connection.set(status);
          }
        },
      );
    } catch {
      this.connection.set('reconnecting');
      this.error.set(
        'Live updates could not start. Try reconnecting.',
      );
    }
  }

  private async reload(
    roomId: string,
    generation: number,
  ): Promise<void> {
    if (generation !== this.generation) return;

    const requestNumber = ++this.requestNumber;

    this.loading.set(true);
    this.error.set(null);

    try {
      const room = await this.service.load(roomId);

      if (
        generation === this.generation
        && requestNumber === this.requestNumber
      ) {
        this.room.set(room);
      }
    } catch (error) {
      if (
        generation === this.generation
        && requestNumber === this.requestNumber
      ) {
        this.error.set(
          error instanceof Error
            ? error.message
            : 'Please try again.',
        );
      }
    } finally {
      if (
        generation === this.generation
        && requestNumber === this.requestNumber
      ) {
        this.loading.set(false);
      }
    }
  }
}