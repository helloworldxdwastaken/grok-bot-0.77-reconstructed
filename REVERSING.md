# Help reverse Grok Bot

This repo has two tracks. Pick whichever you like:

| Track | Target | Where |
| --- | --- | --- |
| **Rebuild** | Readable TypeScript for 0.18.0 that compiles back into a working app | `source/`, `frontend/`, [README](README.md) |
| **Recover** | Pull apart each new release (0.75.8, 0.77.0, …) and document what changed | `scripts/recover-*`, [docs/RECOVERY-0.75.md](docs/RECOVERY-0.75.md) |

Newer releases have no readable source yet. That is the big open job.

## Set up

You need macOS on Apple Silicon, Node 26.5.x, Xcode Command Line Tools, Git
LFS, and, for native code, JDK 21 plus Ghidra 12.x.

```sh
git clone https://github.com/helloworldxdwastaken/grok-bot-0.77-reconstructed.git
cd grok-bot-0.77-reconstructed
git lfs install && git lfs pull
npm ci
npm test
```

## Recover a release

Install the Grok Bot version you want in `/Applications`, then:

```sh
GHIDRA=/path/to/ghidra_12.1.4_PUBLIC scripts/recover-installed-app.sh
node scripts/recover-protos.mjs recovered/<version>   # .proto schemas
node scripts/recover-ipc.mjs recovered/<version>      # rpc-edge IPC contracts as TypeScript
```

Everything lands in `recovered/<version>/`, which is git-ignored:

| Path | What's in it |
| --- | --- |
| `asar/` | Raw `app.asar` |
| `pretty/` | Every JS/CSS/HTML/JSON file run through Prettier |
| `native/decompiled/` | Ghidra C, symbols and strings for each native binary |
| `native/ghidra-project/` | Open it with `ghidraRun` |
| `protos/` | Rebuilt `.proto` files |
| `ipc/` | Rebuilt IPC contracts |

[docs/RECOVERY-0.75.md](docs/RECOVERY-0.75.md) explains what each runtime
holds. [docs/CHANGES-0.75.8-to-0.77.0.md](docs/CHANGES-0.75.8-to-0.77.0.md)
shows how to diff two releases.

## Open work

- **Readable TypeScript for 0.75+.** Rebuild a runtime (start with
  `electron-preload/preload.cjs`, the smallest) the way `source/` does for
  0.18. The recovered `ipc/` and `protos/` give you the types.
- **Change report for each new release.** Recover it, compare it against the
  previous one using the method in the 0.77.0 report, and add
  `docs/CHANGES-<old>-to-<new>.md`.
- **Native helpers.** `CUGrokBotService` (Swift, computer use) and
  `sand-webauthn-signer` (Rust) are only partly understood. Demangle names
  with `swift demangle` / `rustfilt` and write up what you find.
- **Recovery script coverage.** A new bundle pattern that `recover-protos` or
  `recover-ipc` misses is a good first PR. Add a failing case to `tests/` first.
- **Frontend.** `frontend/` is a partial reconstruction of the renderer;
  see the README for its limits.

## Rules

- **Never commit upstream code or recovery output.** That means `recovered/`,
  decompiled C, extracted asar files and app bundles. Commit scripts that
  produce them, and docs that describe them.
- No credentials, tokens or personal paths in commits.
- Small, focused PRs. Run `npm test` (and `npm run check` if you touch
  `source/`) before opening one.
- Facts in docs should be reproducible: name the script, version and hash
  they came from.

Read [NOTICE.md](NOTICE.md) before you redistribute anything. This is an
unofficial research project, not affiliated with Anysphere, Cursor or xAI.
