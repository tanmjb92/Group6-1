'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export function useDebounce<T>(value: T, delayMs = 300) {
  const [debouncedValue, setDebouncedValue] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    timer.current = setTimeout(() => setDebouncedValue(value), delayMs);
    return () => { if (timer.current !== null) clearTimeout(timer.current); };
  }, [value, delayMs]);

  const flush = useCallback((next: T) => {
    if (timer.current !== null) clearTimeout(timer.current);
    setDebouncedValue(next);
  }, []);

  return { debouncedValue, flush };
}
