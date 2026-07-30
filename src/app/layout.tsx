import type { Metadata } from 'next';
import { DM_Sans, Libre_Baskerville } from 'next/font/google';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import './globals.css';

const dmSans = DM_Sans({
    variable: '--font-dm-sans',
    subsets: ['latin'],
});

const libreBaskerville = Libre_Baskerville({
    variable: '--font-playfair',
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
    // The app is dark-only, so the `dark` class is set here rather than by a
    // theme provider. It has to be present in the server-rendered HTML: the
    // colour variables in globals.css default to a light palette under :root, so
    // a class applied only after hydration means the first paint is white.
    return (
        <html
            lang="en"
            className={`dark ${dmSans.variable} ${libreBaskerville.variable} h-full antialiased`}
        >
            <body className="min-h-full flex flex-col bg-background text-foreground">
                {children}
            </body>
        </html>
    );
}
