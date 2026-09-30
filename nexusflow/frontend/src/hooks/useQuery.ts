import { useState, useEffect, useCallback, useRef } from 'react';

interface UseQueryOptions<T> {
  /** Polling interval in ms; 0 = no polling */
  pollInterval?: number;
  enabled?: boolean;
  onSuccess?: (data: T) => void;
  onError?: (err: Error) => void;
}

interface QueryState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * useQuery — minimal data fetching hook with optional polling and error handling.
 * Cancels pending requests on unmount using AbortController.
 */
export function useQuery<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: unknown[] = [],
  options: UseQueryOptions<T> = {}
): QueryState<T> {
  const { pollInterval = 0, enabled = true, onSuccess, onError } = options;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  const fetch_ = useCallback(async () => {
    if (!enabled) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    try {
      const result = await fetcher(controller.signal);
      if (!mountedRef.current || controller.signal.aborted) return;
      setData(result);
      setError(null);
      onSuccess?.(result);
    } catch (err: unknown) {
      if (!mountedRef.current || controller.signal.aborted) return;
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      onError?.(e);
    } finally {
      if (mountedRef.current && !controller.signal.aborted) setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  useEffect(() => {
    mountedRef.current = true;
    void fetch_();

    if (pollInterval > 0) {
      pollRef.current = setInterval(() => void fetch_(), pollInterval);
    }

    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetch_, pollInterval]);

  return { data, loading, error, refetch: fetch_ };
}

/**
 * useMutation — simple async action hook with loading/error state.
 */
export function useMutation<TInput, TOutput>(
  mutator: (input: TInput) => Promise<TOutput>
): {
  mutate: (input: TInput) => Promise<TOutput | null>;
  loading: boolean;
  error: Error | null;
} {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const mutate = useCallback(async (input: TInput): Promise<TOutput | null> => {
    setLoading(true);
    setError(null);
    try {
      const result = await mutator(input);
      return result;
    } catch (err: unknown) {
      const e = err instanceof Error ? err : new Error(String(err));
      if (mountedRef.current) setError(e);
      return null;
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [mutator]);

  return { mutate, loading, error };
}
