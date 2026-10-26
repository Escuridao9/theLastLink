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