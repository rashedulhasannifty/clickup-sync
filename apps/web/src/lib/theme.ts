// Single source of truth for the light/dark theme contract. The pre-paint
// inline script in index.html reads the same 'theme' key independently (it has
// to run before this bundle loads), so keep the key in sync if it ever changes.

const KEY = 'theme';
export type Theme = 'light' | 'dark';

export function currentTheme(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

export function applyTheme(next: Theme): void {
  document.documentElement.setAttribute('data-theme', next);
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* ignore (private mode / disabled storage) */
  }
}

/** Flip the theme, persist it, and return the new value. */
export function toggleTheme(): Theme {
  const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  return next;
}
