/**
 * useSovereignMode.js
 * Hook that gates all Sovereign Tech UI features behind a persisted toggle.
 * State is stored in localStorage so it survives page reloads.
 */
import { useState, useCallback, useEffect } from 'react';

const STORAGE_KEY = '@myslack_sovereign_mode';

/**
 * Returns [sovereignMode, toggleSovereignMode, setSovereignMode].
 * sovereignMode is true when Sovereign Tech features are active.
 */
export function useSovereignMode() {
  const [sovereignMode, setMode] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  // Sync to localStorage whenever the value changes
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(sovereignMode));
    } catch {
      // localStorage may be unavailable in some native environments
    }
  }, [sovereignMode]);

  const toggleSovereignMode = useCallback(() => {
    setMode((prev) => !prev);
  }, []);

  return [sovereignMode, toggleSovereignMode, setMode];
}
