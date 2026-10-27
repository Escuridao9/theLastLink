export type PlayableCategoryId = 'games' | 'movies';

export interface CreateRoomRequest {
  readonly roomId: string;
  readonly categoryId: PlayableCategoryId;
  readonly displayName: string;
}

export interface CreatedRoom {
  readonly id: string;
  readonly code: string;
  readonly categoryId: PlayableCategoryId;
  readonly displayName: string;
}

export interface JoinRoomRequest {
  readonly roomCode: string;
  readonly categoryId: PlayableCategoryId;
  readonly displayName: string;
}

export interface JoinedRoom extends CreatedRoom {
  readonly seat: 1 | 2;
}

export interface RoomPlayer {
  readonly userId: string;
  readonly seat: 1 | 2;
  readonly displayName: string;
  readonly isReady: boolean;
}

export interface LobbyRoom {
  readonly id: string;
  readonly code: string;
  readonly categoryId: PlayableCategoryId;
  readonly status: 'lobby' | 'playing' | 'finished' | 'closed';
  readonly createdAt: string;
  readonly players: readonly RoomPlayer[];
}

export type RoomConnectionStatus =
  | 'connecting'
  | 'live'
  | 'reconnecting';