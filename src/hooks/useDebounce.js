import { useState, useEffect } from 'react';

/**
 * Hook pour retarder une valeur (debounce)
 * @param {any} value - La valeur à debouncer
 * @param {number} delay - Le délai en millisecondes
 * @returns {any} La valeur debouncée
 */
export function useDebounce(value, delay = 300) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}
