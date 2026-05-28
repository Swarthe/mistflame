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

-- Email 4: inbound from Alice, no quote (button should NOT show)
INSERT INTO email (id, contact_id, parent_id, sender, sent_at, subject, body, message_id, recipient) VALUES (
    4, 1, NULL, NULL, '2026-05-27T14:00:00.000Z',
    'Brochure request',
    'Hi,

Do you have a brochure or one-pager I could share with my team?

Thanks,
Alice',
    'brochure.req@example.com', 'hello@example.com'
);

-- Email 5: unsent draft reply (sent_at NULL; button should NOT show on drafts)
INSERT INTO email (id, contact_id, parent_id, sender, sent_at, subject, body, message_id, recipient) VALUES (
    5, 1, 4, 'hello@example.com', NULL,
    'Re: Brochure request',
    'Hi Alice,

Happy to put something together for you. I will send it over by end of week.',
    NULL, NULL
);

-- ── Thread 3 (Bob): outbound email → inbound reply with quote ──

-- Email 6: outbound sent, no quote (button should NOT show)
INSERT INTO email (id, contact_id, parent_id, sender, sent_at, subject, body, message_id, recipient) VALUES (
    6, 2, NULL, 'hello@example.com', '2026-05-26T14:00:00.000Z',
    'Introduction',
    'Hi Bob,

I wanted to introduce Mistflame. We specialise in digital model generation from biometric measurements.

Best,
Mistflame',
    'intro.xyz@example.com', NULL
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
