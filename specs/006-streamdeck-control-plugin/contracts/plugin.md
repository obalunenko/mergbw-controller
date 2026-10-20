# Stream Deck Plugin Contract

## Identity and manifest

| Field | Value |
| --- | --- |
| UUID / directory | com.obalunenko.mergbw / com.obalunenko.mergbw.sdPlugin |
| Version | 0.1.0.0 for first local delivery |
| Name / Category | MeRGBW |
| SDKVersion | 3 |
| Nodejs.Version | 24 |
| Software.MinimumVersion | 7.1 |
| OS | mac, MinimumVersion 13.5 only |
| CodePath | bin/plugin.js |
| PropertyInspectorPath | ui/index.html |

Five stable action UUIDs: com.obalunenko.mergbw.on, .off, .color, .brightness, .preset. Every action supports Controllers:["Keypad"], one state and no automatic toggling. Disable automatic states explicitly if applicable; SupportedInMultiActions:false avoids undocumented macro/duplicate execution semantics in this release. Icons/assets and paths must pass pinned CLI validation. No supplied profile with credentials, automatic launch of sunset or BLE imports.

Action-list names default to English (On/Off/Color/Brightness/Preset) with bilingual descriptions. PI fields, error/recovery text and default runtime labels use explicitly selected en/ru. Dictionaries are packaged locally; no remote localization requests.

## Import and save connection

Input is a single trimmed command URL from streamdeck-buttons.txt:
http://<literal-host>:<port>/<token>/<existing-action>.

Literal host is case-insensitive localhost or exact 127.0.0.1, normalized to fixed IPv4 address. Explicit numeric port 1024–65535 and token /^[A-Za-z0-9_-]{24,128}$/ are required. Accepted routes: on, off, color/<six hex digits>, brightness/<one-to-three digits 0–100>, preset/<valid id>. Reject credentials, HTTPS, alternate IP representations, IPv6, encoded segments, percent escapes, backslashes, path traversal/normalization, trailing slash, query (even ?), fragment and multiple lines. Validate raw syntax before a general URL parser can normalize these differences.

Parsing and saving never request the imported command URL. Only connection values persist; the imported command does not silently configure the selected action. Clear import/password fields on completion. Saved token is never echoed. Port edit with blank replacement token keeps old token; absent token on first setup is unconfigured.

Requests ignore user proxy environment and never use caller-supplied Host/origin. Fixed node:http options: hostname 127.0.0.1, family 4, selected port; Host follows canonical address. POST commands carry no query/body and Content-Length:0. 3xx are final failures, never followed. Read responses with bounded bytes, header/content type and runtime schema validation.

## PI/backend messages v1

Transport: SDPI streamDeckClient.send("sendToPlugin", envelope), SDK onSendToPlugin handler, SDK ui.sendToPropertyInspector response, PI sendToPropertyInspector subscription. Use SDK-associated context, not a payload-selected target.

Envelope: {v:1, sessionId:string, requestId:string, type:string, payload:object}. session/request IDs are short generated opaque identifiers, not credentials. Only types below are accepted; malformed version/type/context returns a safe local error. Replies match v/sessionId/requestId and type result, without original secret input.

| Type | Payload | Reply / side effect |
| --- | --- | --- |
| inspector.get | {} | sanitized snapshot of connection, assignment, check, catalog, operation and language |
| connection.import | {url} | validated save of connection; no lamp/HTTP command |
| connection.save | {port, replacementToken?} | serialized validated save; blank replacement keeps token |
| connection.check | {} | GET health and catalog, each <=5s; three independent check states |
| presets.refresh | {} | GET catalog; no command, no implicit preset substitution |
| assignment.save | {settings} | validate only current UUID schema, persist allowlist |
| language.save | {language:en/ru} | preserve connection and assignments; rerender dictionary |
| inspector.close | {} | stop this session subscriptions; does not cancel command |

Sanitized snapshot connection = {configured,port,hasToken}; no token, URL, raw settings or server error. Assignment reply contains only its persisted schema. Preset labels use safe text rendering; no innerHTML. Secret fields have no setting attribute and never call setSettings/getGlobalSettings from PI. Host global-change notifications are ignored by view rendering and never logged; backend emits sanitized replacement snapshots.

Backend serializes global saves, validates runtime types and uses revisions/generations to reject stale snapshots. A late check/catalog response cannot paint a newer connection or session. Reopening PI may inspect current pending operation but cannot replay it. No test/send lamp button in PI: actual commands come only from keyDown.

## Key events and feedback

onKeyDown is the only command trigger. Acquire per-context busy synchronously, snapshot validated assignment/connection, start total deadline, then perform POST. onKeyUp, onWillAppear/disappear, settings receipt and PI messages do not send commands.

A second press while busy only shows attention/«Выполняется» and sends no POST. Other keys may submit concurrently; controller determines action ordering. Guard survives inspector/profile visibility changes until terminal result/deadline. Render only to matching operation/context and current assignment/connection revision; old completion cannot display current success.

Normal default title/image describes configured command, never physical power/state. Show a brief standard attention overlay at activation, with PI text «Выполняется / Executing». This means attention/processing, not error or success by itself; runtime busy graphic is supplemental because custom images/titles outrank it. ShowOk only after valid sent confirmation. Rejection/unknown uses showAlert with precise PI explanation; temporary feedback returns to default/custom appearance while last explanation remains inspectable.

Manual acceptance must verify initial attention with custom title/image, comprehension and <=300ms target. Do not implement fictional showBusy or overwrite host custom settings. SDK feedback visibility alone never proves lamp state.

## Timeout and response contract

Command observation deadline is 45s from activation, including setup/headers/body; enforce via one total timer, not socket idle timeout alone. Read-only calls use 5s. Body caps: health/command 64 KiB, catalog 1 MiB. Oversized/truncated/invalid responses finalize safely and free resources.

Success requires 200 JSON with sent:true, exact canonical action and physical_state_verified:false. Failure taxonomy follows [HTTP contract](http-api.md). 503 is backend failure with possibly partial/unknown outcome; no parsing localized strings. Unknown text explains possible late execution and offers one conscious subsequent press. All command outcomes have zero automatic retries.

## Secret-safe diagnostics

Set SDK logger INFO before connect in production and development. Do not enable trace/payload logging; do not pass raw errors, request objects, settings, URLs or PI events to logger. Safe events: plugin.ready, connection.checked, presets.loaded/failed, action.started/sent/rejected/unknown. Fields: local operation id, action kind, status category, duration, decimal X-Request-ID <=32 characters.

Use localized static errors with next step, not arbitrary server text. As defense in depth redact current and outstanding old tokens from remaining display strings and user catalog labels. Request IDs failing allowlist are omitted. Data for an old connection cannot leak into new diagnostics. SDK logs are local to plugin logs/; distribution excludes them.

## Settings lifecycle and export

[data-model.md](../data-model.md) is authoritative for schemaVersion 1. Profile export includes assignments only; import into installation without global connection is unconfigured, not auto-activated. Existing global connection on the same installation is reused. Empty new actions get documented defaults; corrupt/unknown-version actions do not silently reset. No migration of controller files or old Website keys is needed.
