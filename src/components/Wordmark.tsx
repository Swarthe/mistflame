'use client';

// The "Mistflame — {org}" title shared by the app header and the login page.
export function Wordmark({ orgName, className }: {
    orgName: string;
    className?: string;
}) {
    return (
        <h1 className={`font-heading-bold tracking-wide ${className ?? ''}`}>
            <span className="text-gold">Mistflame</span>
            {orgName && (
                <>
                    <span className="text-white/30 mx-1.5">—</span>
                    <span className="text-white">{orgName}</span>
                </>
            )}
        </h1>
    );
}
