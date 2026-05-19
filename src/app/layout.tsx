import type { Metadata } from 'next';
import { DM_Sans, Libre_Baskerville } from 'next/font/google';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import './globals.css';
import { ThemeProvider } from 'next-themes';

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
    return (
        <html
            lang="en"
            className={`${dmSans.variable} ${libreBaskerville.variable} h-full antialiased`}
            suppressHydrationWarning
        >
            <body suppressHydrationWarning className="min-h-full flex flex-col bg-background text-foreground">
                <ThemeProvider
                    attribute="class"
                    defaultTheme="dark"
                    enableSystem={false}
                    forcedTheme="dark"
                >
                    {children}
                </ThemeProvider>
            </body>
        </html>
    );
}
