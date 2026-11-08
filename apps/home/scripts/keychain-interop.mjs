// WilmAI Home reading a keychain entry the WilmAI CLI really wrote: the CLI's
// store saves an entry (the real service, a random id), Home's Rust code reads
// it (the ignored test `reads_an_entry_the_cli_wrote`), and the entry is
// deleted. macOS: /usr/bin/security; Windows: Credential Manager, written by
// @napi-rs/keyring and read by the keyring crate. Build the CLI first.
//
//   node apps/home/scripts/keychain-interop.mjs
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const store = await import(pathToFileURL(join(repo, "packages", "wilma-cli", "dist", "secret-store.js")).href);
const id = store.newSecretId();
const password = `interop "q" \\ ä ${Date.now()}`;
await store.writeLoginSecrets(id, { password, totpSecret: "JBSWY3DPEHPK3PXP" });
try {
  execFileSync("cargo", ["test", "--", "--ignored", "reads_an_entry_the_cli_wrote"], {
    cwd: join(repo, "apps", "home", "src-tauri"),
    env: { ...process.env, WILMAI_INTEROP_SECRET_ID: id, WILMAI_INTEROP_PASSWORD: password },
    stdio: "inherit",
  });
  console.log("keychain-interop: Home read the entry the CLI wrote");
} finally {
  console.log(`keychain-interop: entry deleted: ${await store.deleteLoginSecrets(id)}`);
}
