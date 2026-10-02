import { useState } from 'react';

// index.html applies the stored theme before first paint; this keeps React in sync with it.
export type Theme = 'light' | 'dark';
const KEY = 'theme';

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.classList.contains('dark') ? 'dark' : 'light',
  );
  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.classList.toggle('dark', next === 'dark');
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Storage can be blocked (private mode); the theme still applies for this visit.
    }
    setTheme(next);
  };
  return { theme, toggle };
}
