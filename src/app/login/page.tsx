'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
    const router = useRouter();
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [activeSession, setActiveSession] = useState(false);
    const [orgName, setOrgName] = useState('');
    useEffect(() => {
        fetch('/api/config').then(r => r.json()).then((d: unknown) => setOrgName(((d as { orgName?: string }).orgName) ?? ''));
    }, []);

    const submit = async (force = false) => {
        setLoading(true);
        setError('');
        try {
            const res = await fetch('/api/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password, force }),
            });
            const data = (await res.json()) as { ok: boolean; activeSession?: boolean; error?: string };
            if (res.ok) {
                router.replace('/');
            } else if (data.activeSession) {
                setActiveSession(true);
            } else {
                setError(data.error ?? 'Incorrect password.');
                setActiveSession(false);
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <main className="min-h-screen bg-black flex items-center justify-center px-4">
            <div className="flex flex-col gap-4 w-full max-w-xs">
                <div className="mb-2">
                    <h1 className="font-heading-bold text-2xl tracking-wide">
                        <span className="text-[#ffd54f]">Mistflame</span>
                        {orgName && <><span className="text-white/30 mx-1.5">—</span><span className="text-white">{orgName}</span></>}
                    </h1>
                </div>

                {!activeSession ? (
                    <form onSubmit={e => { e.preventDefault(); submit(false); }} className="flex flex-col gap-4">
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
                            className="bg-white/70 text-black font-sans text-sm font-bold py-3 hover:bg-[#ffd54f] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            {loading ? 'Checking…' : 'Enter'}
                        </button>
                        <div className="h-4">
                            {error && <p className="font-sans text-xs text-red-400">{error}</p>}
                        </div>
                    </form>
                ) : (
                    <div className="flex flex-col gap-4">
                        <div className="border border-[#ffd54f]/30 bg-[#ffd54f]/[0.05] px-4 py-3">
                            <p className="font-sans text-sm text-white/80 leading-relaxed">
                                Another session is currently active. Logging in will disconnect them and may disrupt ongoing work.
                            </p>
                        </div>
                        <button
                            onClick={() => submit(true)}
                            disabled={loading}
                            className="bg-white/70 text-black font-sans text-sm font-bold py-3 hover:bg-[#ffd54f] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            {loading ? 'Logging in…' : 'Log in anyway'}
                        </button>
                        <button
                            onClick={() => setActiveSession(false)}
                            disabled={loading}
                            className="font-sans text-sm text-white/50 hover:text-white/80 transition-colors"
                        >
                            Cancel
                        </button>
                    </div>
                )}
            </div>
        </main>
    );
}
