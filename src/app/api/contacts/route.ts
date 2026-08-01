import { getCloudflareContext } from '@opennextjs/cloudflare';

export const isValidEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

interface ContactRow {
    id: number;
    name: string;
    email: string;
    description: string | null;
    awaiting_reply: number;
}

interface TagRow {
    contact_id: number;
    tag_id: number;
    name: string;
    color: string;
}

const CONTACTS_QUERY = `
    SELECT
        c.id, c.name, c.email, c.description,
        EXISTS (
            SELECT 1 FROM email e
            WHERE e.contact_id = c.id
              AND e.sender IS NULL
              AND NOT EXISTS (SELECT 1 FROM email child WHERE child.parent_id = e.id)
        ) AS awaiting_reply
    FROM contact c
    ORDER BY name
`;

async function attachTags(env: CloudflareEnv, contacts: ContactRow[]) {
    if (contacts.length === 0) return contacts.map(c => ({ ...c, tags: [] }));
    const { results: tagRows } = await env.DB
        .prepare(`
            SELECT ct.contact_id, t.id AS tag_id, t.name, t.color
            FROM contact_tag ct
            JOIN tag t ON t.id = ct.tag_id
            ORDER BY t.name
        `)
        .all<TagRow>();
    const tagMap = new Map<number, { id: number; name: string; color: string }[]>();
    for (const row of tagRows) {
        const list = tagMap.get(row.contact_id) ?? [];
        list.push({ id: row.tag_id, name: row.name, color: row.color });
        tagMap.set(row.contact_id, list);
    }
    return contacts.map(c => ({ ...c, tags: tagMap.get(c.id) ?? [] }));
}

export async function GET() {
    const { env } = await getCloudflareContext({ async: true });
    const { results } = await env.DB.prepare(CONTACTS_QUERY).all<ContactRow>();
    const contacts = await attachTags(env, results);
    return Response.json({ ok: true, contacts });
}

export async function POST(request: Request) {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const name = body?.name;
    const email = body?.email;
    const description = body?.description ?? null;
    const tags = Array.isArray(body?.tags)
        ? (body.tags as unknown[]).filter((t): t is { name: string; color: string } =>
            typeof (t as Record<string, unknown>).name === 'string' &&
            typeof (t as Record<string, unknown>).color === 'string'
          )
        : [];

    if (typeof name !== 'string' || !name.trim()) {
        return Response.json({ ok: false, error: 'Name is required.' }, { status: 400 });
    }
    if (typeof email !== 'string' || !isValidEmail(email)) {
        return Response.json({ ok: false, error: 'A valid email address is required.' }, { status: 400 });
    }

    const { env } = await getCloudflareContext({ async: true });

    // The UNIQUE constraint on contact.email is case-sensitive, so a case
    // variant of an existing address would slip past it and leave the
    // receiver's LOWER(email) lookup matching one of two contacts arbitrarily.
    const duplicate = await env.DB
        .prepare('SELECT id FROM contact WHERE LOWER(email) = LOWER(?)')
        .bind(email.trim())
        .first();
    if (duplicate) {
        return Response.json({ ok: false, error: 'A contact with this email already exists.' }, { status: 409 });
    }

    let result;
    try {
        result = await env.DB
            .prepare('INSERT INTO contact (name, email, description) VALUES (?, ?, ?)')
            .bind(name.trim(), email.trim(), description)
            .run();
    } catch (e: unknown) {
        if (e instanceof Error && e.message.includes('UNIQUE constraint failed: contact.email')) {
            return Response.json({ ok: false, error: 'A contact with this email already exists.' }, { status: 409 });
        }
        throw e;
    }

    const contactId = result.meta.last_row_id as number;
    const savedTags = await upsertTags(env, contactId, tags);

    return Response.json({
        ok: true,
        contact: {
            id: contactId,
            name: name.trim(),
            email: email.trim(),
            description,
            tags: savedTags,
            awaiting_reply: 0,
        },
    }, { status: 201 });
}

export async function upsertTags(
    env: CloudflareEnv,
    contactId: number,
    tags: { name: string; color: string }[]
): Promise<{ id: number; name: string; color: string }[]> {
    if (tags.length === 0) return [];
    const saved: { id: number; name: string; color: string }[] = [];
    for (const tag of tags) {
        const trimmed = tag.name.trim();
        if (!trimmed) continue;
        let row = await env.DB
            .prepare('SELECT id, name, color FROM tag WHERE LOWER(name) = LOWER(?)')
            .bind(trimmed)
            .first<{ id: number; name: string; color: string }>();
        if (!row) {
            await env.DB
                .prepare('INSERT OR IGNORE INTO tag (name, color) VALUES (?, ?)')
                .bind(trimmed, tag.color)
                .run();
            row = await env.DB
                .prepare('SELECT id, name, color FROM tag WHERE LOWER(name) = LOWER(?)')
                .bind(trimmed)
                .first<{ id: number; name: string; color: string }>();
        }
        if (!row) continue;
        await env.DB
            .prepare('INSERT OR IGNORE INTO contact_tag (contact_id, tag_id) VALUES (?, ?)')
            .bind(contactId, row.id)
            .run();
        saved.push(row);
    }
    return saved;
}
