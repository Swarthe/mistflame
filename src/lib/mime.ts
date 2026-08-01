// RFC 2047 encoded-word encoding for raw email headers.
//
// Shared by the send route and the email receiver for the same reason as
// html-to-text.mjs: both workers build raw MIME messages, and a Subject: or
// display name containing non-ASCII (common in Danish correspondence) must be
// encoded identically wherever it is emitted. Left raw, such headers ride on
// undeclared 8-bit bytes that receiving servers may mangle or junk.

const encoder = new TextEncoder();

/**
 * Bytes of source text per encoded word. 45 bytes base64-encode to 60
 * characters, which sits comfortably inside the 75-character limit RFC 2047
 * places on a single encoded word once the =?UTF-8?B?...?= wrapper is added.
 */
const CHUNK_BYTES = 45;

function toBase64(bytes: Uint8Array): string {
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary);
}

/**
 * Encode a header value as RFC 2047 encoded words when it contains anything
 * outside printable ASCII; return it unchanged otherwise. Long values are
 * split on code-point boundaries into several words joined by folding
 * whitespace, which decoders strip when the words are adjacent, so the split
 * is invisible to the reader.
 *
 * The caller is still responsible for stripping CR/LF first; this encodes
 * text, it does not neutralise header injection.
 */
export function encodeHeaderText(value: string): string {
    if (/^[\x20-\x7E]*$/.test(value)) return value;
    const chunks: string[] = [];
    let chunk = '';
    for (const ch of value) {
        if (chunk && encoder.encode(chunk + ch).length > CHUNK_BYTES) {
            chunks.push(chunk);
            chunk = ch;
        } else {
            chunk += ch;
        }
    }
    if (chunk) chunks.push(chunk);
    return chunks
        .map(c => `=?UTF-8?B?${toBase64(encoder.encode(c))}?=`)
        .join('\r\n ');
}
