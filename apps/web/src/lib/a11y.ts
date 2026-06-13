import type { KeyboardEvent } from 'react';

/**
 * Keyboard activation for elements made clickable without being a native
 * button (e.g. a focusable <tr>). Returns an onKeyDown that fires `fn` on
 * Enter/Space.
 *
 * Note we intentionally do NOT set role="button" on table rows — that would
 * strip the implicit `row` role and break table semantics for screen readers.
 * The row stays a row, but is focusable (tabIndex={0}) and operable.
 *
 * The `e.currentTarget !== e.target` guard means activation only fires when the
 * row itself is focused, never when the keystroke came from an inner control
 * (checkbox, select, menu button), so those keep their own keyboard behavior.
 */
export function onActivate(fn: () => void) {
  return (e: KeyboardEvent) => {
    if (e.currentTarget !== e.target) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fn();
    }
  };
}
