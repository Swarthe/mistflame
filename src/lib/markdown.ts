import MarkdownIt from 'markdown-it';

// The one markdown renderer, shared between the send path (the HTML part of
// an outgoing message) and the client (composer preview and reading back our
// own markdown rows), the same way html-to-text.mjs is shared: the copy the
// recipient gets and the copy read back here must render identically.
//
// html: false is the security property. Raw HTML in the source is escaped to
// text, so the output is a closed tag set built entirely by markdown-it's own
// renderer (which escapes text and attribute values), and link destinations go
// through its validateLink, which rejects javascript: and friends. That is why
// the rendered HTML can be injected into the page without a DOMPurify pass;
// do not flip this flag.
//
// breaks: true makes a single newline a <br>, matching how the same body
// reads as the text/plain part. linkify matches what receiving clients do to
// bare URLs in plain text.
const md = new MarkdownIt({ html: false, breaks: true, linkify: true });

// No inline images: a remote URL would be blocked by CSP on our side and a
// tracking risk on the recipient's. ![alt](url) falls back to plain text.
md.disable('image');

// _blank/noopener for display in the app; harmless in outgoing mail, where
// clients open links externally regardless. One config keeps the wire and
// read-back renditions identical.
const renderLink = md.renderer.rules.link_open
    ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    tokens[idx].attrSet('target', '_blank');
    tokens[idx].attrSet('rel', 'noopener noreferrer');
    return renderLink(tokens, idx, options, env, self);
};

export function renderMarkdown(source: string): string {
    return md.render(source);
}
