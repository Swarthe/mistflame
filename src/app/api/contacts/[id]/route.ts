import { getCloudflareContext } from '@opennextjs/cloudflare';
import { isValidEmail, upsertTags } from '@/app/api/contacts/route';

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const contactId = parseInt(id, 10);
    if (isNaN(contactId)) return Response.json({ ok: false, error: 'Invalid ID.' }, { status: 400 });

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

    // Same reasoning as the POST handler: the UNIQUE constraint is
    // case-sensitive, so case variants must be rejected here.
    const duplicate = await env.DB
        .prepare('SELECT id FROM contact WHERE LOWER(email) = LOWER(?) AND id != ?')
        .bind(email.trim(), contactId)
        .first();
    if (duplicate) {
        return Response.json({ ok: false, error: 'A contact with this email already exists.' }, { status: 409 });
    }

    let result;
    try {
        result = await env.DB
            .prepare('UPDATE contact SET name=?, email=?, description=? WHERE id=?')
            .bind(name.trim(), email.trim(), description, contactId)
            .run();
    } catch (e: unknown) {
        if (e instanceof Error && e.message.includes('UNIQUE constraint failed: contact.email')) {
            return Response.json({ ok: false, error: 'A contact with this email already exists.' }, { status: 409 });
        }
        throw e;
    }

    if (result.meta.changes === 0) {
        return Response.json({ ok: false, error: 'Contact not found.' }, { status: 404 });
    }

    await env.DB
        .prepare('DELETE FROM contact_tag WHERE contact_id = ?')
        .bind(contactId)
        .run();

    await upsertTags(env, contactId, tags);
    await env.DB.prepare('DELETE FROM tag WHERE id NOT IN (SELECT tag_id FROM contact_tag)').run();

    return Response.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const contactId = parseInt(id, 10);
    if (isNaN(contactId)) return Response.json({ ok: false, error: 'Invalid ID.' }, { status: 400 });

    const { env } = await getCloudflareContext({ async: true });

    const { results: attachments } = await env.DB
        .prepare('SELECT r2_key FROM attachment WHERE email_id IN (SELECT id FROM email WHERE contact_id = ?)')
        .bind(contactId)
        .all<{ r2_key: string }>();

    await Promise.all(attachments.map(att => env.ATTACHMENTS.delete(att.r2_key)));

    // One batch, one transaction: a failure midway rolls the lot back rather
    // than leaving emails without their contact. The R2 deletes above stay
    // best-effort either way.
    const results = await env.DB.batch([
        env.DB.prepare('DELETE FROM attachment WHERE email_id IN (SELECT id FROM email WHERE contact_id = ?)').bind(contactId),
        env.DB.prepare('DELETE FROM email WHERE contact_id = ?').bind(contactId),
        env.DB.prepare('DELETE FROM contact_tag WHERE contact_id = ?').bind(contactId),
        env.DB.prepare('DELETE FROM contact WHERE id = ?').bind(contactId),
        env.DB.prepare('DELETE FROM tag WHERE id NOT IN (SELECT tag_id FROM contact_tag)'),
    ]);

    if ((results[3].meta.changes ?? 0) === 0) {
        return Response.json({ ok: false, error: 'Contact not found.' }, { status: 404 });
    }

    return Response.json({ ok: true });
}
