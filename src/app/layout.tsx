import type { Metadata } from 'next';
import { DM_Sans, Libre_Baskerville } from 'next/font/google';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import './globals.css';

const dmSans = DM_Sans({
    variable: '--font-dm-sans',
    subsets: ['latin'],
});

const libreBaskerville = Libre_Baskerville({
    variable: '--font-libre-baskerville',
    subsets: ['latin'],
    weight: '700',
});

export async function generateMetadata(): Promise<Metadata> {
    const { env } = await getCloudflareContext({ async: true });
    const orgName = env.ORG_NAME || '';
    return {
        title: orgName ? `Mistflame — ${orgName}` : 'Mistflame',
        robots: { index: false, follow: false },
    };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
    // The app is dark-only; the palette is defined directly as dark literals
    // in globals.css, so no theme class is needed. (next-themes once supplied
    // a `dark` class here and was removed; see CLAUDE.md, Styling.)
    return (
        <html
            lang="en"
            className={`${dmSans.variable} ${libreBaskerville.variable} h-full antialiased`}
        >
            <body className="min-h-full flex flex-col bg-background text-foreground">
                {children}
            </body>
        </html>
    );
}
