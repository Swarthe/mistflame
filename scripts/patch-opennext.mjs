/**
 * Patches @opennextjs/cloudflare's bundle-server.js to support cloudflare:email.
 *
 * cloudflare:email is an ESM-only virtual module available only at Workers runtime.
 * esbuild must treat it as external (not try to resolve it), and any require() call
 * in the bundled output must be rewritten to a top-level static ESM import.
 *
 * This patch is re-applied on every `npm install` via the postinstall hook.
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundleServerPath = path.join(root, "node_modules/@opennextjs/cloudflare/dist/cli/build/bundle-server.js");

const code = await readFile(bundleServerPath, "utf8");

let patched = code;

// 1. Add cloudflare:email to the esbuild external array
if (!patched.includes('"cloudflare:email"')) {
  patched = patched.replace(
    'external: ["./middleware/handler.mjs"]',
    'external: ["./middleware/handler.mjs", "cloudflare:email"]'
  );
  if (!patched.includes('"cloudflare:email"')) {
    console.error("patch-opennext: could not find esbuild external array, patch skipped");
    process.exit(1);
  }
  console.log("patch-opennext: added cloudflare:email to esbuild externals");
} else {
  console.log("patch-opennext: esbuild external already present, skipping");
}

// 2. patchedCode must be let (not const) so the ESM rewrite block can reassign it
if (patched.includes("const patchedCode = code.replace(")) {
  patched = patched.replace(
    "const patchedCode = code.replace(",
    "let patchedCode = code.replace("
  );
  console.log("patch-opennext: changed patchedCode from const to let");
} else {
  console.log("patch-opennext: patchedCode already let, skipping");
}

// 3. Rewrite require("cloudflare:email") to a top-level ESM import in the bundled output
const esmRewriteSnippet = `    if (patchedCode.includes('"cloudflare:email"')) {
        patchedCode = 'import * as __cfEmail from "cloudflare:email";\\n' +
            patchedCode.replace(/require\\("cloudflare:email"\\)/g, "__cfEmail");
    }`;

if (!patched.includes(esmRewriteSnippet)) {
  patched = patched.replace(
    "    await writeFile(workerOutputFile, patchedCode);",
    `${esmRewriteSnippet}\n    await writeFile(workerOutputFile, patchedCode);`
  );
  if (!patched.includes(esmRewriteSnippet)) {
    console.error("patch-opennext: could not find writeFile anchor, ESM rewrite patch skipped");
    process.exit(1);
  }
  console.log("patch-opennext: added cloudflare:email ESM require→import rewrite");
} else {
  console.log("patch-opennext: ESM rewrite already present, skipping");
}

await writeFile(bundleServerPath, patched);
console.log("patch-opennext: done");
