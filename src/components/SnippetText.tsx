// Must match HIT_OPEN/HIT_CLOSE in api/search/route.ts. Duplicated for the same
// reason as isValidEmail: importing a route module into the client bundle to
// share two characters is the worse trade.
const HIT_OPEN = '\u0002';
const HIT_CLOSE = '\u0003';

/**
 * Render a snippet's matched runs as <mark>. The delimiters are control
 * characters that cannot occur in a body, so a plain split is unambiguous, and
 * every piece stays text: no markup from an email is ever injected here.
 */
export function SnippetText({ snippet }: { snippet: string }) {
    const pieces = snippet.split(HIT_OPEN).flatMap((chunk, i) => {
        if (i === 0) return [{ hit: false, text: chunk }];
        const [hit, ...rest] = chunk.split(HIT_CLOSE);
        return [{ hit: true, text: hit }, { hit: false, text: rest.join(HIT_CLOSE) }];
    });
    return (
        <>
            {pieces.map((piece, i) => piece.hit
                ? <mark key={i} className="bg-gold/25 text-gold rounded-[1px]">{piece.text}</mark>
                : <span key={i}>{piece.text}</span>)}
        </>
    );
}
