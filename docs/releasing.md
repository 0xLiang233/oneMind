# Releasing OneMind

OneMind stable releases are built on a GitHub-hosted Windows runner and published as draft GitHub Releases. The Tauri updater reads `latest.json` only after the draft is published.

## One-time setup

The updater public key is committed in `desktop/tauri/src-tauri/tauri.conf.json`. Keep the matching private key outside the repository and back it up securely.

The initial local key is stored at:

```text
$HOME/.tauri/onemind.key
```

Add its complete contents to the repository Actions secret `TAURI_SIGNING_PRIVATE_KEY`. The generated key has no password, so `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` can be omitted. If the key is replaced with a password-protected key, add that password as the second secret.

Losing the private key prevents installed copies from accepting future updates. Changing the key requires a transition release signed by the old key.

## Publish a version

1. Update the root `package.json` version using SemVer and commit the change.
2. Build locally with the signing key available:

   ```powershell
   $env:TAURI_SIGNING_PRIVATE_KEY="$HOME\.tauri\onemind.key"
   $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
   $env:CI="true"
   pnpm build:tauri
   ```

3. Create and push the matching tag:

   ```powershell
   git tag v0.1.5
   git push origin v0.1.5
   ```

4. Wait for the `Release OneMind` workflow to create the draft release.
5. Install and smoke-test the generated NSIS package.
6. Publish the draft release. Published stable clients can then discover it through `releases/latest/download/latest.json`.

The workflow rejects a tag whose version does not match the root `package.json` version.
