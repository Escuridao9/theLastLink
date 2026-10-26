import {
  Component,
  computed,
  DestroyRef,
  ErrorHandler,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  CATEGORY_OPTIONS,
  type CategoryOption,
} from '../../core/config/categories';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-category-selection',
  imports: [RouterLink],
  templateUrl: './category-selection.component.html',
  styleUrl: './category-selection.component.css',
})
export class CategorySelection implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly errorHandler = inject(ErrorHandler);

  readonly categories = CATEGORY_OPTIONS;
  readonly selectedCategory = signal<CategoryOption | null>(null);

  readonly connecting = signal(false);
  readonly connectionError = signal<string | null>(null);
  readonly playerConnected = this.auth.isAuthenticated;

  readonly continueLink = computed(() => {
    const selected = this.selectedCategory();

    return selected &&
      this.playerConnected() &&
      !this.connecting() &&
      !this.connectionError()
      ? ['/play', selected.id]
      : null;
  });

  ngOnInit(): void {
    void this.connectPlayer();
  }

  async connectPlayer(): Promise<void> {
    if (this.connecting()) {
      return;
    }

    this.connecting.set(true);
    this.connectionError.set(null);

    try {
      await this.auth.ensureSession();
    } catch (error) {
      if (!this.destroyRef.destroyed) {
        this.connectionError.set(
          'We could not connect your player. Please try again.',
        );

        this.errorHandler.handleError(error);
      }
    } finally {
      if (!this.destroyRef.destroyed) {
        this.connecting.set(false);
      }
    }
  }
}