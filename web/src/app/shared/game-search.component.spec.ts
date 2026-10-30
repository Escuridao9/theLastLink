import { TestBed } from '@angular/core/testing';
import { afterEach, expect, it, vi } from 'vitest';
import { GameSearchComponent } from './game-search.component';

afterEach(() => { TestBed.resetTestingModule(); vi.restoreAllMocks(); document.querySelector('#external-focus')?.remove(); });
async function render(autoFocus = true, disabled = false) {
  const fixture = TestBed.createComponent(GameSearchComponent);
  fixture.componentRef.setInput('autoFocus',autoFocus);
  fixture.componentRef.setInput('disabled',disabled);
  fixture.detectChanges(); await fixture.whenStable();
  return { fixture, input:fixture.nativeElement.querySelector('input') as HTMLInputElement };
}
it('focuses the answer field without scrolling when its turn view is created', async () => {
  const focus=vi.spyOn(HTMLInputElement.prototype,'focus');
  const f=await render(); expect(document.activeElement).toBe(f.input);
  expect(focus).toHaveBeenCalledWith({preventScroll:true});
});
it('does not focus a disabled answer or a search field outside the match', async () => {
  const f=await render(false); expect(document.activeElement).not.toBe(f.input);
  f.fixture.destroy();
  const disabled=await render(true,true); expect(document.activeElement).not.toBe(disabled.input);
});
it('does not steal focus from another control or an open dialog', async () => {
  const button=document.createElement('button'); button.id='external-focus'; document.body.append(button); button.focus();
  const f=await render(); expect(document.activeElement).toBe(button);
  button.setAttribute('role','dialog'); button.blur(); f.fixture.componentInstance.focusAnswer();
  expect(document.activeElement).not.toBe(f.input);
});
it('waits for a hidden tab to become visible before attempting turn focus', async () => {
  const hidden=vi.spyOn(document,'hidden','get').mockReturnValue(true);
  const f=await render(); expect(document.activeElement).not.toBe(f.input);
  hidden.mockReturnValue(false); document.dispatchEvent(new Event('visibilitychange'));
  expect(document.activeElement).toBe(f.input);
  f.fixture.destroy(); f.input.blur(); document.dispatchEvent(new Event('visibilitychange'));
  expect(document.activeElement).not.toBe(f.input);
});
