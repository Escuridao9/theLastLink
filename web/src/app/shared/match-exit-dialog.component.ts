import {
  AfterViewInit, Component, ElementRef, EventEmitter, Input, OnChanges, Output, ViewChild,
} from '@angular/core';

@Component({
  selector: 'app-match-exit-dialog',
  standalone: true,
  template: `
    <dialog #dialog class="ll-leave-dialog" aria-labelledby="leave-match-title"
      aria-describedby="leave-match-description leave-match-timer" (cancel)="cancel($event)">
      <span class="ll-label">ONE LIFE. YOUR CALL.</span>
      <h2 id="leave-match-title">Leave this match<span>?</span></h2>
      <p id="leave-match-description">Leaving will forfeit the match and your opponent will win.</p>
      <p id="leave-match-timer" class="ll-leave-timer">The turn timer keeps running while you decide.</p>
      @if (error) { <p class="ll-leave-error" role="alert">{{ error }}</p> }
      <div class="ll-leave-actions" [attr.aria-busy]="busy">
        <button type="button" class="ll-leave-stay" autofocus [disabled]="busy" (click)="stay.emit()">Stay in match</button>
        <button type="button" class="ll-leave-forfeit" [disabled]="busy" (click)="leave.emit()">
          {{ busy ? 'Confirming forfeit…' : 'Leave and forfeit' }}
        </button>
      </div>
      <span class="sr-only" role="status">{{ busy ? 'Waiting for the server to confirm the result.' : '' }}</span>
    </dialog>
  `,
  styles: `
    .ll-leave-dialog {
      width: min(460px, calc(100vw - 32px)); max-height: calc(100dvh - 32px);
      box-sizing: border-box; overflow-y: auto; padding: 30px;
      border: 1px solid var(--ll-lilac); border-radius: 14px;
      background: var(--ll-dark); color: var(--ll-cream);
      font-family: 'Bricolage Grotesque', Arial, sans-serif;
      box-shadow: 0 24px 80px #0008;
    }
    .ll-leave-dialog::backdrop { background: #140f19cc; }
    h2 { margin: 14px 0 18px; font-size: clamp(29px, 6vw, 40px); line-height: 1.1; letter-spacing: -1.4px; }
    h2 span { color: var(--ll-coral); }
    p { font-size: 15px; line-height: 1.6; margin: 0 0 12px; }
    .ll-leave-timer { color: var(--ll-quiet); font-size: 13px; }
    .ll-leave-error { color: var(--ll-coral); }
    .ll-leave-actions { display: flex; gap: 10px; margin-top: 24px; flex-wrap: wrap; }
    button { flex: 1 1 165px; min-height: 48px; padding: 12px 16px; border: 1px solid var(--ll-lilac);
      border-radius: 7px; font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; }
    .ll-leave-stay { background: var(--ll-lilac); color: var(--ll-dark); }
    .ll-leave-forfeit { background: transparent; color: var(--ll-cream); border-color: #806270; }
    .ll-leave-forfeit:hover:not(:disabled) { color: var(--ll-coral); border-color: var(--ll-coral); }
    button:disabled { background: #39303d; color: #ab9cad; border-color: #55465a; cursor: wait; }
    @media (max-width: 400px) { .ll-leave-dialog { padding: 24px 20px; } }
  `,
})
export class MatchExitDialogComponent implements OnChanges, AfterViewInit {
  @Input() open = false;
  @Input() busy = false;
  @Input() error = '';
  @Output() readonly stay = new EventEmitter<void>();
  @Output() readonly leave = new EventEmitter<void>();
  @ViewChild('dialog') private dialog?: ElementRef<HTMLDialogElement>;

  ngOnChanges(): void { this.sync(); }
  ngAfterViewInit(): void { this.sync(); }
  private sync(): void {
    const dialog = this.dialog?.nativeElement;
    if (!dialog) return;
    if (this.open && !dialog.open) dialog.showModal();
    else if (!this.open && dialog.open) dialog.close();
  }
  cancel(event: Event): void {
    event.preventDefault();
    if (!this.busy) this.stay.emit();
  }
}
