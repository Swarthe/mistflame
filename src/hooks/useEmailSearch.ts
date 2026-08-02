'use client';

import { useState, useEffect } from 'react';
import type { SearchResult } from '@/lib/types';

// Long enough that typing a word is one query rather than five, short enough
// that the results feel attached to the keystrokes.
const SEARCH_DEBOUNCE_MS = 250;
const MIN_SEARCH_CHARS = 2;

/**
 * Server-side message search. Contacts are filtered client-side from data
 * already in hand; only the message half needs the server, so a short query
 * does nothing and the rest is debounced. Clearing on a too-short query
 * happens synchronously in setQuery, so the effect never sets state
 * synchronously.
 */
export function useEmailSearch(apiFetch: (...args: Parameters<typeof fetch>) => Promise<Response>) {
    const [query, setQueryState] = useState('');
    const [results, setResults] = useState<SearchResult[]>([]);
    const [truncated, setTruncated] = useState(false);
    const [loading, setLoading] = useState(false);
    const [unavailable, setUnavailable] = useState(false);

    const trimmed = query.trim();
    const active = trimmed.length >= MIN_SEARCH_CHARS;

    const clear = () => {
        setResults([]);
        setTruncated(false);
        setUnavailable(false);
        setLoading(false);
    };

    const setQuery = (value: string) => {
        setQueryState(value);
        if (value.trim().length < MIN_SEARCH_CHARS) clear();
    };

    useEffect(() => {
        if (trimmed.length < MIN_SEARCH_CHARS) return;
        let cancelled = false;
        const timer = setTimeout(() => {
            setLoading(true);
            apiFetch(`/api/search?q=${encodeURIComponent(trimmed)}`)
                .then(async res => {
                    if (cancelled) return;
                    if (res.status === 503) {
                        setUnavailable(true);
                        setResults([]);
                        return;
                    }
                    const data = await res.json() as { results?: SearchResult[]; truncated?: boolean };
                    setUnavailable(false);
                    setResults(data.results ?? []);
                    setTruncated(!!data.truncated);
                })
                .catch(() => { if (!cancelled) setResults([]); })
                .finally(() => { if (!cancelled) setLoading(false); });
        }, SEARCH_DEBOUNCE_MS);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [trimmed]); // eslint-disable-line react-hooks/exhaustive-deps

    return { query, setQuery, trimmed, active, results, truncated, loading, unavailable };
}
