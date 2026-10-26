import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-player-connection',
  templateUrl: './player-connection.component.html',
  styleUrl: './player-connection.component.css',
})
export class PlayerConnection {
  @Input({ required: true }) connecting = false;
  @Input({ required: true }) connected = false;
  @Input({ required: true }) error: string | null = null;

  @Output() readonly retryRequested = new EventEmitter<void>();
}