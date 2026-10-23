import { FormControl, Validators } from '@angular/forms';

export function createPlayerNameControl(): FormControl<string> {
  return new FormControl('', {
    nonNullable: true,
    validators: [
      Validators.required,
      Validators.minLength(2),
      Validators.maxLength(24),
    ],
  });
}