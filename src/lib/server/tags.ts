// Tag upsert shared by the contact POST and PUT handlers.
//
// The tag name UNIQUE constraint is case-sensitive, so the LOWER() lookup is
// what actually deduplicates case variants; the stored row's casing wins.

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
