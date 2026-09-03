// @ts-check
//
// Mint, list and revoke agent tokens: bearer credentials that let a program
// call the API on behalf of one principal, with one of three scopes. The
// person a token is for runs the mint; that is their consent, and revoking
// it is deleting one key.
//
//   node scripts/agent-token.mjs mint <principal> <scope> [--days N]
//   node scripts/agent-token.mjs list
//   node scripts/agent-token.mjs revoke <principal | key prefix>
//
// Scopes, least to most: read, read+draft, read+draft+send. What each one
// allows is the AGENT_ROUTES table in src/middleware.ts; nothing here can
// widen it.
//
// The token itself is printed once and never stored: KV holds only its
// SHA-256 under `agent:<hex>`, with the principal and scope as the value
// and again as metadata so `list` needs one call. A KV dump therefore
// yields no usable credential, and a lost token is re-minted, not
// recovered. The default lifetime is 180 days; the middleware sees an
// expired key as no key at all, so an expiry reads as 401 on the caller's
// side and is fixed by minting again.
//
// Runs through wrangler against the REMOTE namespace bound as SESSION in
// wrangler.toml, so it needs a Cloudflare login on this machine and nothing
// else. Run it from the repository root.

import { randomBytes, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const SCOPES = ['read', 'read+draft', 'read+draft+send'];
const KEY_PREFIX = 'agent:';
const DEFAULT_DAYS = 180;
const PRINCIPAL = /^[a-z0-9][a-z0-9_-]*$/;

/** @param {string[]} args */
function wrangler(args) {
    return execFileSync('npx', ['wrangler', 'kv', 'key', ...args, '--binding', 'SESSION', '--remote'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'inherit'],
    });
}

/** @returns {{ name: string, expiration?: number, metadata?: Record<string, unknown> }[]} */
function listKeys() {
    const out = wrangler(['list', '--prefix', KEY_PREFIX]);
    const start = out.indexOf('[');
    if (start < 0) return [];
    return JSON.parse(out.slice(start));
}

/** @param {number | undefined} seconds */
function when(seconds) {
    return seconds ? new Date(seconds * 1000).toISOString().slice(0, 10) : 'never';
}

/** @param {string} message */
function fail(message) {
    console.error(message);
    process.exit(2);
}

const [command, ...rest] = process.argv.slice(2);

if (command === 'mint') {
    const [principal, scope] = rest;
    let days = DEFAULT_DAYS;
    const at = rest.indexOf('--days');
    if (at >= 0) {
        days = parseInt(rest[at + 1] ?? '', 10);
        if (!Number.isInteger(days) || days < 1) fail('--days needs a whole number of days, at least 1.');
    }
    if (!principal || !PRINCIPAL.test(principal)) fail('mint needs a principal: lower-case letters, digits, - and _.');
    if (!SCOPES.includes(scope)) fail(`mint needs a scope: ${SCOPES.join(', ')}.`);

    const token = randomBytes(32).toString('hex');
    const hash = createHash('sha256').update(token).digest('hex');
    const grant = JSON.stringify({ principal, scope, minted: new Date().toISOString().slice(0, 10) });
    wrangler([
        'put', `${KEY_PREFIX}${hash}`, grant,
        '--ttl', String(days * 86_400),
        '--metadata', grant,
    ]);
    console.error(`minted a ${scope} token for ${principal}, valid ${days} days, key ${KEY_PREFIX}${hash.slice(0, 12)}...`);
    console.error('The token is below and is not stored anywhere; paste it where it is needed now.');
    console.log(token);
} else if (command === 'list') {
    const keys = listKeys();
    if (keys.length === 0) {
        console.log('no agent tokens');
    }
    for (const key of keys) {
        const meta = key.metadata ?? {};
        console.log(
            `${String(meta.principal ?? '?').padEnd(10)} ${String(meta.scope ?? '?').padEnd(16)} ` +
            `expires ${when(key.expiration)}  ${key.name.slice(0, KEY_PREFIX.length + 12)}...`,
        );
    }
} else if (command === 'revoke') {
    const [target] = rest;
    if (!target) fail('revoke needs a principal or a key prefix.');
    const matches = listKeys().filter(key =>
        key.metadata?.principal === target ||
        key.name.startsWith(target) ||
        key.name.startsWith(`${KEY_PREFIX}${target}`),
    );
    if (matches.length === 0) fail(`nothing matches ${target}.`);
    for (const key of matches) {
        wrangler(['delete', key.name]);
        console.log(`revoked ${key.metadata?.principal ?? '?'} ${key.metadata?.scope ?? '?'} ${key.name.slice(0, KEY_PREFIX.length + 12)}...`);
    }
} else {
    fail('usage: agent-token.mjs mint <principal> <scope> [--days N] | list | revoke <principal | key prefix>');
}
