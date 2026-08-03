-- Local development seed data.
-- Run from the mistflame directory:
--   npx wrangler d1 execute DB --local --file db/seed-local.sql

INSERT INTO contact (id, name, email) VALUES
    (1, 'Alice Nguyen',  'alice@example.com'),
    (2, 'Bob Tremblay',  'bob@example.com');

-- ── Thread 1 (Alice): contact form → outbound reply with quote → contact replies with quote ──

-- Email 1: inbound contact form submission (no quote; button should NOT show)
INSERT INTO email (id, contact_id, parent_id, sender, sent_at, subject, body, message_id, recipient) VALUES (
    1, 1, NULL, NULL, '2026-05-28T09:00:00.000Z',
    'Contact Form: Partnership inquiry',
    'Hi there,

I am interested in your digital model service. Could we set up a call to discuss?

Best,
Alice',
    NULL, 'hello@example.com'
);

-- Email 2: outbound sent reply with quote appended (button SHOULD show)
INSERT INTO email (id, contact_id, parent_id, sender, sent_at, subject, body, message_id, recipient) VALUES (
    2, 1, 1, 'hello@example.com', '2026-05-28T10:15:00.000Z',
    'Re: Contact Form: Partnership inquiry',
    'Hi Alice,

Thanks for getting in touch. We would love to set up a call. Are you free on Thursday afternoon?

Best,
Mistflame

On 28 May 2026, 09:00, Alice Nguyen wrote:
> Hi there,
>
> I am interested in your digital model service. Could we set up a call to discuss?
>
> Best,
> Alice',
    'abc123.def456@example.com', NULL
);

-- Email 3: contact replies with quoted text from their email client (button SHOULD show)
INSERT INTO email (id, contact_id, parent_id, sender, sent_at, subject, body, message_id, recipient) VALUES (
    3, 1, 2, NULL, '2026-05-28T11:30:00.000Z',
    'Re: Contact Form: Partnership inquiry',
    'Thursday works perfectly, say 2pm?

On 28 May 2026, 10:15, Mistflame wrote:
> Hi Alice,
>
> Thanks for getting in touch. We would love to set up a call. Are you free on Thursday afternoon?
>
> Best,
> Mistflame',
    'reply789.xyz@example.com', 'hello@example.com'
);

-- ── Thread 2 (Alice): inbound question → unsent draft reply ──

-- Email 4: inbound from Alice with co-recipients (inbound to_addrs is the
-- parsed To: header; the envelope address stays in recipient). Shows the
-- "+ Reply all" button: the prefill keeps bob (a contact, golden chip) and
-- carol (unknown, grey chip) and drops our own address.
INSERT INTO email (id, contact_id, parent_id, sender, sent_at, subject, body, message_id, recipient, cc, to_addrs) VALUES (
    4, 1, NULL, NULL, '2026-05-27T14:00:00.000Z',
    'Brochure request',
    'Hi,

Do you have a brochure or one-pager I could share with my team?

Thanks,
Alice',
    'brochure.req@example.com', 'hello@example.com',
    'carol@example.net', 'hello@example.com, bob@example.com'
);

-- Email 5: unsent draft reply (sent_at NULL; quote button should NOT show on
-- drafts). Draft to_addrs holds the *extras* beyond the contact (bob shows as
-- a golden contact chip in the editor); bcc is never emitted in a header.
INSERT INTO email (id, contact_id, parent_id, sender, sent_at, subject, body, message_id, recipient, to_addrs, bcc) VALUES (
    5, 1, 4, 'hello@example.com', NULL,
    'Re: Brochure request',
    'Hi Alice,

Happy to put something together for you. I will send it over by end of week.',
    NULL, NULL,
    'bob@example.com', 'records@example.net'
);

-- ── Thread 3 (Bob): outbound email → inbound reply with quote ──

-- Email 6: outbound sent, no quote (button should NOT show). On a sent row
-- to_addrs is the full delivered To list, snapshotted by the send-time claim
-- (contact first, then the extras); the card shows it as the To: line.
INSERT INTO email (id, contact_id, parent_id, sender, sent_at, subject, body, message_id, recipient, cc, to_addrs, bcc) VALUES (
    6, 2, NULL, 'hello@example.com', '2026-05-26T14:00:00.000Z',
    'Introduction',
    'Hi Bob,

I wanted to introduce Mistflame. We specialise in digital model generation from biometric measurements.

Best,
Mistflame',
    'intro.xyz@example.com', NULL,
    'carol@example.net', 'bob@example.com, dana@example.org', 'archive@example.net'
);

-- Email 7: inbound reply with quoted text (button SHOULD show)
INSERT INTO email (id, contact_id, parent_id, sender, sent_at, subject, body, message_id, recipient) VALUES (
    7, 2, 6, NULL, '2026-05-26T16:45:00.000Z',
    'Re: Introduction',
    'Sounds interesting, tell me more about the tech stack.

On 26 May 2026, 14:00, Mistflame wrote:
> Hi Bob,
>
> I wanted to introduce Mistflame. We specialise in digital model generation from biometric measurements.
>
> Best,
> Mistflame',
    'bobr.abc@example.com', 'hello@example.com'
);

-- Email 8: standalone inbound, no quote (button should NOT show)
INSERT INTO email (id, contact_id, parent_id, sender, sent_at, subject, body, message_id, recipient) VALUES (
    8, 2, NULL, NULL, '2026-05-25T08:00:00.000Z',
    'Quick question',
    'Do you operate in Denmark?',
    'standalone.abc@example.com', 'hello@example.com'
);

-- ── Thread 4 (Bob): inbound HTML email ─────────────────────────────────────────
--
-- Exercises the HTML rendering path: a <style> block (applied inside the message
-- frame, so the serif font and cream background prove it works, while a second
-- block trying to hide the app's own chrome proves it cannot reach outside), a
-- table layout with inline
-- colours that would be illegible on the dark card, a declared 1x1 tracking
-- pixel (removed outright), a real remote image (placeholder until "Load
-- images"), two CSS background urls (one in the style block, one in an inline
-- style; blocked and counted by default, proxied after "Load images"), a cid:
-- inline image, a trailing gmail_quote blockquote for the ··· toggle, and an
-- XSS battery that must all be neutralised.
--
-- body is the plain-text rendition the receiver derives via htmlToText;
-- body_html is the fragment htmlToFragment produces (no doctype or wrapper).
--
-- htmlToFragment would already have removed the <script> and <iframe> at ingest,
-- so a real row never holds them. They are here on purpose: the renderer is the
-- security boundary and must neutralise hostile markup on its own, whatever put
-- it in the column.
--
-- The cid: image needs bytes in local R2 or it will not render: the attachment
-- row exists, so the sanitiser rewrites the cid: reference to the attachment
-- endpoint, which then has nothing to serve. After seeding, run:
--
-- (one line, base64 of a 120x40 PNG):
--   echo 'iVBORw0KGgoAAAANSUhEUgAAAHgAAAAoCAIAAAC6iKlyAAAAZElEQVR42u3aMQ0AIAwAwWrAAHulMCMeOShgaQILl7yCmz9an3pQIAANWqBBg6YA+gvoHEuFQIMGLdCgQYMGDVqgQYMGDRq0QIMGDRo0aIEGDRo0aNC6DS2nEmiBBg1aoEHr2AaOWFMAZ/LUvAAAAABJRU5ErkJggg==' | base64 -d > /tmp/logo.png
--   npx wrangler r2 object put mistflame-attachments/9/seed-logo.png \
--     --local --file /tmp/logo.png --content-type image/png
--
-- That base64 is a valid 120x40 PNG (verified CRCs, decompressible IDAT). Do not
-- substitute a truncated stand-in such as just the 8-byte PNG signature: the
-- request succeeds, the decode fails, and the image reports naturalWidth 0, which
-- looks exactly like a bug in the rendering path.
--
-- The remote image and background URLs below are fictional, so "Load images"
-- fetches them through /api/img and gets 502s. That is the proxy working; swap
-- in any real image URL to see it render.

INSERT INTO email (id, contact_id, parent_id, sender, sent_at, subject, body, body_html, message_id, recipient) VALUES (
    9, 2, NULL, NULL, '2026-05-29T09:30:00.000Z',
    'Our new brochure',
    'Big & Bold Offer

Hello there — have a look at our latest brochure <https://example.com/offer>.

- Faster turnaround
- Lower cost

[Company logo]

Thanks,
Bob

> Do you operate in Denmark?',
    '<style>body{font-family:Georgia,serif;background:#fffbe6}.promo{color:#c00}
h1.promo{background-image:url(https://cdn.example.com/banner.png)}</style>
<div dir="ltr"><table cellpadding="0" cellspacing="0"><tbody><tr><td style="color:#333333;font-size:14px">
<h1 class="promo">Big &amp; Bold Offer</h1>
<p>Hello&nbsp;there &mdash; have a look at our <a href="https://example.com/offer">latest brochure</a>.</p>
<ul><li>Faster turnaround</li><li>Lower cost</li></ul>
<img src="https://track.example.com/open.gif" width="1" height="1" alt="">
<img src="https://cdn.example.com/brochure-hero.png" width="480" height="180" alt="Brochure cover">
<img src="cid:seed-logo-1" alt="Company logo" width="120" height="40">
<div style="position:fixed;top:0;left:0;background:url(https://track.example.com/bg.png);color:#666">Thanks,<br>Bob</div>
<script>alert(''xss-script'')</script>
<img src="x" onerror="alert(''xss-onerror'')">
<a href="javascript:alert(''xss-href'')">do not click</a>
<iframe src="https://evil.example.com"></iframe>
<style>.mf-email-frame,.mf-app-chrome{display:none !important}</style>
</td></tr></tbody></table></div>
<div class="gmail_quote"><div dir="ltr" class="gmail_attr">On 25 May 2026, 08:00, Bob Tremblay wrote:<br></div>
<blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex"><div>Do you operate in Denmark?</div></blockquote></div>',
    'brochure.html@example.com', 'hello@example.com'
);

INSERT INTO attachment (id, email_id, file_name, content_type, r2_key, size, content_id, inline) VALUES
    (1, 9, 'logo.png', 'image/png', '9/seed-logo.png', 157, 'seed-logo-1', 1),
    (2, 9, 'brochure.pdf', 'application/pdf', '9/seed-brochure.pdf', 1024, NULL, 0);

-- ── Thread 5 (Alice): forwarded draft ──────────────────────────────────────────
--
-- What the Forward button produces: a fresh draft thread under the target
-- contact with the source message baked into the body as a block. The block
-- collapses behind the same ··· toggle as reply quotes (second marker in
-- splitQuote), and being a draft it counts towards the pending-send badge.

INSERT INTO email (id, contact_id, parent_id, sender, sent_at, subject, body, message_id, recipient) VALUES (
    10, 1, NULL, 'hello@example.com', NULL,
    'Fwd: Quick question',
    'Alice, this seems like one for you.

---------- Forwarded message ----------
From: Bob Tremblay <bob@example.com>
Date: 25 May 2026, 08:00
Subject: Quick question
To: hello@example.com

Do you operate in Denmark?',
    NULL, NULL
);
