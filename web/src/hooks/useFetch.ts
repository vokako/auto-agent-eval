import { useState, useEffect } from "react";

/**
 * Fetch on mount and whenever `deps` change. Responses for superseded deps are dropped, so a slow
 * earlier request can never overwrite a newer one.
 */
export function useFetch<T>(fetcher: () => Promise<T>, deps: unknown[] = []) {
  const key = JSON.stringify(deps);
  const [state, setState] = useState<{ key: string | null; data: T | null; error: string | null }>(
    { key: null, data: null, error: null });

  useEffect(() => {
    let cancelled = false;
    fetcher()
      .then(d => { if (!cancelled) setState({ key, data: d, error: null }); })
      .catch(e => { if (!cancelled) setState({ key, data: null, error: e instanceof Error ? e.message : String(e) }); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- callers list the inputs of `fetcher` in `deps`
  }, [key]);

  const fresh = state.key === key;
  return { data: fresh ? state.data : null, loading: !fresh, error: fresh ? state.error : null };
}
