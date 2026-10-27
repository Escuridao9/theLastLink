import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnChanges,
  OnDestroy,
  signal,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
@Component({
  selector: 'app-turn-clock',
  standalone: true,
  imports: [DecimalPipe],
  templateUrl: './turn-clock.component.html',
  styleUrl: './turn-clock.component.css',
})
export class TurnClockComponent implements OnInit, OnChanges, OnDestroy {
  @Input({ required: true }) deadline = '';
  @Input() offset = 0;
  @Output() elapsed = new EventEmitter<void>();
  readonly remaining = signal(20000);
  private interval?: ReturnType<typeof setInterval>;
  private notified = false;
  get seconds(): number {
    return Math.ceil(this.remaining() / 1000);
  }
  get progress(): number {
    return Math.max(0, Math.min(100, this.remaining() / 200));
  }
  ngOnInit(): void {
    this.interval = setInterval(() => this.tick(), 100);
    this.tick();
  }
  ngOnChanges(): void {
    this.notified = false;
    this.tick();
  }
  private tick(): void {
    this.remaining.set(Math.max(0, Date.parse(this.deadline) - (Date.now() + this.offset)));
    if (this.remaining() === 0 && !this.notified) {
      this.notified = true;
      this.elapsed.emit();
    }
  }
  ngOnDestroy(): void {
    if (this.interval) clearInterval(this.interval);
  }
}
