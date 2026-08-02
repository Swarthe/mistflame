'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
    const router = useRouter();
    const [password, setPassword] = useState('');
    const [remember, setRemember] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [orgName, setOrgName] = useState('');
    useEffect(() => {
        fetch('/api/config').then(r => r.json()).then((d: unknown) => setOrgName(((d as { orgName?: string }).orgName) ?? ''));
    }, []);

    const submit = async () => {
        setLoading(true);
        setError('');
        try {
            const res = await fetch('/api/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password, remember }),
            });
            const data = (await res.json()) as { ok: boolean; error?: string };
            if (res.ok) {
                router.replace('/');
            } else {
                setError(data.error ?? 'Incorrect password.');
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <main className="min-h-screen bg-black flex items-center justify-center px-4">
            <div className="flex flex-col gap-4 w-full max-w-xs">
                <div className="mb-2 text-center">
                    <h1 className="font-heading-bold text-2xl tracking-wide">
                        <span className="text-[#ffd54f]">Mistflame</span>
                        {orgName && <><span className="text-white/30 mx-1.5">—</span><span className="text-white">{orgName}</span></>}
                    </h1>
                </div>

                <form onSubmit={e => { e.preventDefault(); submit(); }} className="flex flex-col gap-4">
                        <input
                            type="password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            placeholder="Password"
                            autoFocus
                            disabled={loading}
                            className="bg-white/[0.07] border border-white/15 text-white text-sm px-4 py-3 font-sans focus:outline-none focus:border-white/40 placeholder:text-white/40"
                        />
                        <button
                            type="submit"
                            disabled={loading}
                            className="bg-white/80 text-black font-sans text-sm font-bold py-3 hover:bg-[#ffd54f] transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                        >
                            {loading ? 'Checking…' : 'Enter'}
                        </button>
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                            <input
                                type="checkbox"
                                checked={remember}
                                onChange={e => setRemember(e.target.checked)}
                                disabled={loading}
                                className="cursor-pointer accent-[#ffd54f]"
                            />
                            <span className="text-xs text-white/60 font-sans">Remember me</span>
                        </label>
                        <div className="h-4">
                            {error && <p className="font-sans text-xs text-red-400">{error}</p>}
                        </div>
                    </form>
                <a
                    href="https://github.com/Swarthe/mistflame"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex justify-center text-white/45 hover:text-white/65 transition-colors"
                    aria-label="Mistflame on GitHub"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
                        <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
                    </svg>
                </a>
            </div>
        </main>
    );
}
