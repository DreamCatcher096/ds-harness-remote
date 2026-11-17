# Pi Web Remote

**A native Android window into the same Pi Web session—not another Agent.**

[中文](README.zh.md) · [English](README.en.md) · [日本語](README.ja.md)

Pi Web Remote is an independent fork of [DSH Remote](https://github.com/liguobao/ds-harness-remote). It reuses the upstream encrypted transport, protocols, and Android UI to provide native chat and complete questionnaires for Pi Web, rather than extending a general-purpose DSH or multi-Agent client.

> **This is a source project under development, not a ready-to-use mobile remote solution.** Isolated source integration, contract tests, and offline Android emulator validation are complete. Real accounts, Hosts, cross-network connections, physical phones, and production deployment remain unvalidated. Upstream App and npm releases do not include this fork's Pi Web changes.

## Why this project exists

After using Pi Web on a computer, you should be able to leave the desk and access **the same running session and Agent instance** from your phone, keeping its tools, project context, and tasks—not starting a separate Pi on the phone or Host.

The goals are:

- **Same-instance access**: an independent Host bridges the original SDK/Agent owned by the existing Pi Web instance. It does not launch `pi`, `pi-acp`, or a second SDK session to simulate synchronization.
- **Native chat**: browse sessions and history, display streamed text, thinking, and ordinary tool results, and explicitly send text or stop the original task from Android.
- **Complete native questionnaires**: single choice, multiple choice, free text, whole-form submission, cancellation, explicit receipts, and invalidation when another client completes the call—not numeric answers or a redirect to a web page.
- **Reuse encrypted networking**: retain Remote's Noise end-to-end encrypted channel, preferring P2P with TURN/Relay fallback, without occupying Android's VPN slot.
- **A later web entry point**: embed Pi Web over the same encrypted network. WebView is not implemented or enabled at this stage.

## Current status

### Implemented and validated in isolation

- The `pi-web.*` protocol, independent Pi Web Host, client-core state machine, and a dedicated Pi Web entry point in Android.
- Contracts for original-instance binding, session browsing/history, streaming, send/stop, and questionnaire submission/cancellation.
- Operations correlated with real session, instance, call, and question/option identifiers. An uncertain receipt is shown as `unknown`; query the original operation instead of automatically resending writes.
- Reuse of the original App's top bar, messages, composer, drawer, and questionnaire styling rather than a temporary demo screen.
- Native interactions in an offline emulator, including send/stop, whole-form answers, reconnect-and-query after a lost cancellation receipt, cross-client invalidation, and instance replacement.

Evidence and limitations are recorded in the [P3 source and contract results](docs/pi-web-remote/P3-RESULTS.md) and [P3.1 offline emulator results](docs/pi-web-remote/P3.1-RESULTS.md). These are historical execution records, not tests rerun for this README update.

### Not yet completed or validated

- Independent Host admission, account requirements, and pricing for the upstream author's hosted service, plus real P2P/TURN/Relay and cellular connections.
- Normal App login and real Host integration, physical-phone acceptance, real original-instance/model operations, and production deployment.
- Embedded Pi Web/WebView.
- Model/provider switching, attachments/images, session creation/restoration, general file access, and terminals in the native Pi Web entry point. Upstream support does not mean these features are wired into this fork's Pi Web backend.

The existing test APK is an **x86_64 offline emulator build with no INTERNET permission**, not a network-enabled build for ordinary ARM phones. Emulator tests with in-memory fake RPC are not real end-to-end validation.

## How it connects

This is the intended application path; real network integration remains pending:

```text
Native Android Pi Web screen
  ↕ Remote Noise encrypted channel (P2P / TURN / Relay)
Independent Pi Web Host
  ↕ Restricted HTTP / SSE, fixed target 127.0.0.1:30141
Existing Pi Web + minimal bridge changes
  ↕ Original SDK / Agent instance
Original session, tools, and tasks
```

The Host does not execute models, start the original DSH Host runtime, or present Pi Web as an ACP backend. Pi Web and the questionnaire plugin also need matching bridge changes. This repository includes [portable patches and execution records](docs/pi-web-remote/MINIMAL-BRIDGE-RESULTS.md); those changes have not been installed in production.

## Where to start

The customized source lives on [`m2/pi-web-remote`](https://github.com/DreamCatcher096/ds-harness-remote/tree/m2/pi-web-remote), not the fork's `main` branch:

```sh
git clone --branch m2/pi-web-remote --single-branch https://github.com/DreamCatcher096/ds-harness-remote.git pi-web-remote
cd pi-web-remote
```

This only retrieves source. It does not install dependencies, register accounts, or start services. Before developing further, read:

- [Project entry point and current status](docs/pi-web-remote/README.md)
- [Implementation plan](docs/pi-web-remote/IMPLEMENTATION-PLAN.md) and [acceptance boundaries](docs/pi-web-remote/ACCEPTANCE.md)
- [Native chat and questionnaire decisions](docs/pi-web-remote/P3-ADR.md), [Host design](docs/pi-web-remote/HOST-ADR.md), and [wire protocol](docs/protocol.md)
- [Source provenance and pinned baselines](docs/pi-web-remote/SOURCE-BASELINE.md)
- [Development and security rules](AGENTS.md)

Most detailed development documents are currently in Chinese. Main source areas: `apps/pi-web-host/` for the independent Host, `apps/android/` for Android, `packages/protocol/` and `packages/client-core/` for contracts and client state, and `docs/pi-web-remote/patches/` for companion bridge patches.

Other retained subprojects and historical documents may still describe upstream DSH Remote features, installation, or release workflows. They are not availability promises or one-command installation instructions for Pi Web Remote.

## Security and development boundaries

- New Hosts and Apps use independent identities, not existing DSH device identities, private keys, or login state.
- The Pi Web target is fixed at `127.0.0.1:30141`. It must not become an arbitrary LAN, CONNECT, or general TCP proxy; cross-network application traffic must not fall back to plaintext.
- Disconnecting, leaving a screen, or reconnecting does not automatically resend prompts, questionnaire answers, or other writes, and does not automatically stop the original task.
- Users log in themselves; real application tests require step-by-step confirmation. Do not put tokens, cookies, private keys, session files, or full conversations in issues, logs, or the repository.
- Configuration isolation is not an OS sandbox. A future embedded web entry point carries Pi Web's own privileges; hiding native buttons is not permission isolation.

## Upstream attribution and license

This project is forked from [liguobao/ds-harness-remote](https://github.com/liguobao/ds-harness-remote), with development pinned to [`0a0ac9a1a647a171b79b19998d24bdd43bae9ea0`](https://github.com/liguobao/ds-harness-remote/tree/0a0ac9a1a647a171b79b19998d24bdd43bae9ea0). Thanks to the upstream author and contributors for the protocol, cryptography, transport, and Android UI foundations.

The project retains the [MIT license](LICENSE) and original copyright notice: `Copyright (c) 2026 DSH Remote contributors`. Submodule and third-party licenses and NOTICE files must also be respected; rewriting the README does not change those obligations.

Pi Web Remote is an independent derivative, not an official release or endorsement by DSH Remote, Pi Web, or DeepSeek. Names and trademarks belong to their respective owners.
