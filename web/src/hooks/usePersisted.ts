import { useEffect, useState } from "react";

// useState that survives a page reload (localStorage). `encode`/`decode` convert values JSON can't
// hold directly, such as Set.
export function usePersisted<T>(key: string, initial: T, encode: (v: T) => unknown = v => v,
                                decode: (raw: any) => T = raw => raw as T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : decode(JSON.parse(raw));
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(encode(value))); } catch { /* quota / private mode */ }
  }, [key, value]);
  return [value, setValue] as const;
}

export const setCodec = {
  encode: (s: Set<string>) => [...s],
  decode: (a: string[]) => new Set(a),
};

export const setMapCodec = {
  encode: (m: Record<string, Set<string>>) => Object.fromEntries(Object.entries(m).map(([k, s]) => [k, [...s]])),
  decode: (o: Record<string, string[]>) => Object.fromEntries(Object.entries(o).map(([k, a]) => [k, new Set(a)])) as Record<string, Set<string>>,
};
