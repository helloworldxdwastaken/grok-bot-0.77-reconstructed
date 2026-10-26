# Recovering Grok Bot 0.75.8 from the installed app

This is the university reverse-engineering pass over the installed
`/Applications/Grok Bot.app` (version **0.75.8**, `sandTrack: stable`,
built 2026-10-24). Everything it extracts goes to the ignored folder
`recovered/0.75.8/`. Upstream code is never committed.

## Reproduce

Requirements: Node, Xcode CLT (`lipo`), JDK 21 (`brew install openjdk@21`),
and a Ghidra 12.x `ghidra_*_PUBLIC` directory.

```sh
GHIDRA="$HOME/Desktop/carpeta sin título/.toolchain/ghidra_12.1.4_PUBLIC" scripts/recover-installed-app.sh
```

The script reads the version from `Info.plist` and rebuilds
`recovered/<version>/` from scratch. Ghidra uses
[`scripts/ghidra/ExportDecompiled.java`](../scripts/ghidra/ExportDecompiled.java),
a headless post-script that writes each binary's decompiled C, its
imports/exports and its defined strings.

## Output layout

| Path | Contents |
| --- | --- |
| `asar/` | Raw `app.asar` (961 files, 58 MB), unpacked native files included |
| `bundle/` | Bundle without the Electron framework, asar or locales: Info.plist, helpers, Computer Use helper, icons |
| `pretty/` | 750 JS/CJS/MJS/CSS/HTML/JSON files formatted with Prettier |
| `native/bin/` | arm64 slices of every non-OSS native binary |
| `native/ghidra-project/` | Ghidra project. Open it in the GUI with `ghidraRun` |
| `native/decompiled/` | `<bin>.c`, `<bin>.symbols.txt`, `<bin>.strings.txt` |
| `SHA256SUMS` | Identity of the source `app.asar` |

Source identity:

- bundle ID `com.anysphere.sand`, team `DCNK4UB866`
- `app.asar` SHA-256 `7d6fe1a476e2c575c11429772959728333eb9d3d442f71f89bbd9c6f180dd779`

## What the JavaScript contains

The app ships no source maps and no esbuild path comments, so the original file
boundaries are lost. Only Prettier formatting is recoverable, not the authored
TypeScript. The bundled `package.json` still lists the original monorepo
packages: 49 `workspace:*` packages (`@anysphere/agent*`, `@anysphere/local-exec`,
`@anysphere/mcp-core`, `@anysphere/proto`, `@sand/client`, `@sand/shared`, …)
and 53 external dependencies.

| Runtime | File | Lines (formatted) |
| --- | --- | --- |
| Electron main | `dist/electron-main/main-app.cjs`, `main-core.cjs`, `proto.cjs` | 151k + 52k + protobufs |
| Preload | `dist/electron-preload/preload.cjs` (+5 window-specific preloads) | 6k |
| Agent coordinator | `dist/node-agent-coordinator/main.cjs` | 56k |
| Local exec daemon | `dist/local-exec-daemon/main.cjs` | 177k |
| Renderer | `dist/renderer/assets/*` (762 chunks, Vite) | — |

The main preload exposes `desktop`, `desktopMount`, `coordinatorPort` and
`sandRenderTrace` to the renderer.

## Native binaries (Ghidra)

Ghidra 12.1.4 headless, AARCH64 Apple Silicon slices: 10,308 functions
decompiled, 5 failed.

| Binary | Lang | Functions | What it does (from imports, exports and strings) |
| --- | --- | --- | --- |
| `Grok Bot` (main exe) | C | 2 | Stock Electron launcher stub |
| `CUGrokBotService` (Computer Use helper) | Swift | 6,959 | Desktop control: Accessibility (`AXUIElement`), synthetic input (`CGEvent`), ScreenCaptureKit, XPC, plus Contacts/EventKit/CoreLocation |
| `sand-webauthn-signer` | Rust | 2,891 | Security-key WebAuthn ceremonies over IOKit HID (Mozilla `authenticator` 0.5.0, `serde_cbor`). Crate files leak: `crates/sand-webauthn-signer/src/{main,protocol,ceremony}.rs` |
| `sand-op-launcher` | C | 5 | Verifies the 1Password CLI signature (`com.1password.op`, team `2BUA8C4S2C`) with `SecStaticCodeCheckValidity`, then `execve`s it |
| `sand_window_capture.node` | C++/N-API | 117 | Window list and PNG capture via ScreenCaptureKit (`id`, `pid`, `layer`, `x`, `width`, `scale`, `png`, …) |
| `cursor_proclist.node` | C++/N-API | 103 | Memory stats (`totalBytes`, `availableBytes`, `pressureLevel`) and AppKit window state |
| `sand_card_text_recognition.node` | C++/N-API | 90 | Vision framework OCR returning `string` and `boundingBox` results |
| `sand_devicecheck.node` | C++/N-API | 71 | Apple DeviceCheck: `isSupported`, `generateToken`, `hvVmmPresent` (VM detection via `kern.hv_vmm_present`) |
| `sand_notification_settings.node` | C++/N-API | 70 | UserNotifications authorization status (`authorized`, `denied`, `provisional`, …) |

Skipped: stock Electron helpers/framework, Squirrel/Mantle/ReactiveObjC (OSS
updater frameworks), and the `tree-sitter` / `tree-sitter-bash` addons (OSS;
their source is on GitHub).

## Limits

- Decompiled C is Ghidra pseudo-code. It is not compilable source.
- Swift (`CUGrokBotService`) and Rust (`sand-webauthn-signer`) decompile with
  mangled names and runtime noise. Demangle with `swift demangle` /
  `rustfilt` while reading.
- Rebuilding the readable TypeScript for 0.75 (as `source/` does for 0.18)
  is a separate, much larger task.
