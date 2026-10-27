# What changed: 0.75.8 → 0.77.0

0.77.0 was built 2026-10-26 19:10 UTC, two days after 0.75.8. It was recovered
with `scripts/recover-installed-app.sh` into `recovered/0.77.0/` and compared
against `recovered/0.75.8/`.

Source identity: `app.asar` SHA-256
`adb7b74305dc63633a596df7c477210a2a4a88d49871ac91ab7d2f55c2fe973a`.

## Method

- **Packages:** compared the `dependencies` of the two `package.json` files.
- **File layout:** compared the file lists with the 8-character content hash
  stripped from renderer chunk names (`chunk-Foo-AbC123xy.js` becomes `chunk-Foo.js`).
  The remaining `chunk-XXXXXXXX.js` names are hash-only and churn every build,
  so they carry no meaning.
- **Behaviour:** compared the sets of string literals (6–60 chars) across all
  runtimes, renderer included. A literal that is new everywhere is a new
  feature. One that only moved between runtimes is not counted.
- **Native code:** hashed each binary's `__TEXT,__text` section (`otool -X -t`)
  to tell real code changes from re-signing.

## Packages

Added workspace packages: `@anysphere/attention-count`,
`@anysphere/device-local-tools`, `@anysphere/jpeg-napi`,
`@anysphere/sand-playwright-runtime`, `@sand/local-exec-daemon`,
`@sand/local-exec-protocol`, `@sand/primitives`, `@sand/shared-node`.

Added external: `qrcode` ^1.5.4, `sand-address-lookup` (`file:native/address-lookup`).
Bumped: `pele` 1.3.0 → 1.6.0. Removed: `mermaid`.

## Size of the main runtimes

| File | 0.75.8 | 0.77.0 |
| --- | --- | --- |
| `electron-main/main-app.cjs` | 3.18 MB | 3.37 MB (+6%) |
| `electron-main/main-core.cjs` | 0.96 MB | 0.98 MB |
| `electron-main/proto.cjs` | 1.34 MB | 1.41 MB (+5%) |
| `node-agent-coordinator/main.cjs` | 1.06 MB | 1.17 MB (+11%) |
| `local-exec-daemon/main.cjs` | 3.77 MB | 3.89 MB |
| `electron-preload/preload.cjs` | 114 KB | 130 KB (+14%) |

String literals: 2,491 new and 1,190 gone app-wide.

## New features (from new RPCs, events and strings)

- **Bot sharing / agent access invites:** `Create`/`Preview`/`Accept`/`Revoke`/`ListGrokBotAgentAccessInvite(s)`,
  with `sand.bot_share.invite_*` analytics events and a `cursor.com/grok-bot/link/v1/` deep link.
- **Phone messaging link:** `IssueGrokBotMessagingLinkCode`,
  `ListGrokBotMessagingLinkedPhones`, `UnlinkGrokBotMessagingPhone` and a
  `WhatsApp` channel. Probably what `qrcode` is for.
- **Outbound voice calls:** `HangUp`/`Transfer`/`RecordGrokBotOutboundCall`,
  `GetGrokBotVoiceCall`, `place_phone_call`, `RetryGrokBotOutboundCallRecording`.
- **Payments:** `Get`/`SetGrokBotDefaultPaymentMethod`, `GrokBotPaymentWallet`,
  `GrokBotVaultItemManager`, `GrokBotVaultCreateRefusal`, `stripe_link`,
  `x_money`, `vault_card`.
- **Places and addresses:** `SearchGrokBotPlacesArea`, `ResolveGrokBotAddress`,
  `SuggestGrokBotAddresses`, `OpenStreetMap`, backed by the new
  `sand_address_lookup.node` (MapKit). Also new agent tools `RestaurantSearch`,
  `ReserveTable`, `FlightSearch`, `FlightDetails`.
- **Delegated credentials and custom MCP per agent:**
  `Attach`/`RemoveGrokBotAgentDelegatedCredential`,
  `Get`/`UpdateGrokBotAgentCustomMcp`, `CallGrokBotMcpAppTool`.
- **Sandbox "banked resets":** `ListSandBankedResets`, `UseSandBankedReset`,
  `SandResetTooRecentError`, `SandResetAlreadyAppliedError`.
- **Networking and connectors:** `SetActiveTailnet` (Tailscale),
  `SetGrokConnectorEnabled`, `ClaimGrokBotSlackConnect`.
- **Other:** `Bonfire` invites/status, referral pages
  (`sand.desktop.referral_*`), `EditOwnSlackMessage`, `SetProactiveMessaging`,
  `JoinWaitlist`, canvas routines/runtimes (`sand-canvas-frame-run-routine`),
  automation webhooks (`sand-automation-webhook-run`), and internal admin RPCs
  (`AdminMintGrokBotInvite`, `AdminListGrokBotServiceAccountSessions`, …).

The main preload now also carries the full agent tool-name catalog
(`SendIMessage`, `MacReadMail`, `IOSReadReminders`, `JoinMeeting`, …) plus
voice-call telemetry fields (`barge_in_overlap_ms_*`, `mic_stall`, `car_session`).

## Removed

- **Chrome cookie import:** `dist/electron-main/chrome-import-worker.cjs` is
  gone, along with every `ChromeCookieImport*`, `ChromeSafeStorage*` and
  `CookieOriginApproval*` error and `RequestCookieOriginApproval`.
- **Mermaid diagrams:** the `mermaid` dependency and everything it pulled in
  (Langium grammars, Railroad/EBNF/PEG parsers, the VS Code language-server
  protocol types). This accounts for most of the 1,190 removed literals.
- **GitHub connect flow:** `Prepare`/`CompleteGithubConnectFlow` and
  `GetGithubRepoAccessStatus`.
- `EnsureGrokBotCursorMainBot`, `StartExternalBrowser`/`StopExternalBrowser`,
  `AndroidReadNotifications`, the macOS Full Disk Access / Finder automation
  pending errors.

## Native binaries

| Binary | Change |
| --- | --- |
| `CUGrokBotService` (Swift Computer Use helper) | **Code changed**, 3.88 → 4.07 MB (arm64 slice) |
| `sand_address_lookup.node` | **New.** C++/Obj-C N-API addon over MapKit, CoreLocation and Contacts: address autocomplete (`MKLocalSearchCompleter`-style `completions`, `placemark`, `postalAddress`) |
| `@anysphere/jpeg-napi` (`jpeg-napi.darwin-arm64.node`) | **New.** Rust napi-rs 3.8.4 addon exporting `renderJpegRendition`, built on `jpeg-decoder` 0.3.2, `jpeg-encoder` 0.6.1, `fast_image_resize` 5.5.0 |
| All other 8 | Re-signed only; `__TEXT,__text` is byte-identical |

### What changed in `CUGrokBotService`

Ghidra recovers 6,959 → 7,288 functions (+329). The linked frameworks are
unchanged. The new strings and Swift type names (`CUCore/*.swift`) point to one
theme: **keeping the person at the Mac in control while the agent drives it
remotely.**

- **Human takeover:** `CURemoteHumanInputTap` watches for local keyboard and
  mouse input. Computer use stops when the person at the Mac touches it, with
  the message "Computer use was stopped by the person at this Mac".
- **Visible controls:** a "remote control paused" pill
  (`CURemoteControlPausedPill`) and a window stop button
  (`CUWindowStopButton`, `CUWindowStopPillAction`).
- **Session awareness:** `CURemoteSessionWatch` and `CURemoteSessionState`
  refuse to act when the screen is locked, the display is asleep, the session is
  off-console, or "Another user is using this Mac".
- **Local RPC hardening:** `CULocalRPCListener` with a `CULocalRPCPeerPolicy`
  that checks who may connect.
- **Other:** an Accessibility-tree renderer (`CUAXTreeRenderer`), paged element
  snapshots (`child_offset`/`snapshot_id`), AppleEvents usage tracking, and an
  idle-quit lifecycle (`idle_quit start/cancel/refuse`).
