# Background replay acquisition plan

The collector should observe the **official Steam Global client while the user plays**, then send race-only JSON to a local viewer. The user's priorities are Room Matches, shared replays and Champions Meetings. A separate authenticated API client can request its own data but does not observe the game's session; it is therefore not the acquisition architecture for this project.

The selected architecture is an external, process-scoped proxy. The passthrough routing probe succeeded, followed by an authorized HTTPS inspection test with a temporary Current User CA. One genuine saved Room Match passed through application-envelope decoding, inner replay parsing, portable JSON export and the local viewer. The user reported normal game operation. Capture was stopped and certificate trust removed after the test. See [the bounded live evidence](proxy-live-validation.md); this result does not establish all replay modes or future-version compatibility.

The preferred routing path is now the **regular localhost proxy with game-only environment configuration**, validated through a temporary Uma Steam launch wrapper. A second real replay was captured and displayed without administrator rights or a Windows-wide proxy change. Temporary certificate trust remains necessary for HTTPS inspection. Local capture remains the earlier tested alternative, but its privileged redirector is unnecessary for the successful regular-proxy path.

## Evidence and implications

| Approach | Evidence | Consequence |
| --- | --- | --- |
| Passive Wireshark capture | TLS application records, no plaintext or session secrets | Packets alone cannot feed the JSON viewer. |
| Game-only `SSLKEYLOGFILE` trial | Actual Steam child and fresh API connection verified; user ran a replay; key file stayed empty through shutdown | This standard environment setting did not export session keys on the tested build. No certificate-free decryption path was established. |
| Eden bootstrap | Attaches Frida to Unity TLS and obtains credentials for a separate client | Useful historical framing evidence, but does not match the desired observer workflow. |
| Historical Icarus | Own Steam ticket/game session and HTTP requests | Independent retrieval is possible historically; it is not capture of official gameplay. No such login is implemented here. |
| Installed game metadata | Room Match and Champions replay fields/endpoints | Concrete paths to observe during the user's normal replay actions. |
| Installed Unity player | Proxy and certificate-chain APIs linked | Justifies an ordinary proxy experiment; does not prove CA acceptance or absence of pinning. |
| Process-scoped passthrough probe | Actual API ClientHello reached the collector; user completed replay normally | Routing works for the observed connection; TLS inspection and application decoding remain separate tests. |
| Temporary HTTPS inspection | Accepted TLS handshake; 6 selected responses; 1 exported race; no decode failures; real data displayed in the viewer | Official-client background collection is demonstrated for this saved Room Match. No separate game login was needed. |
| Regular proxy through Steam wrapper | Unelevated game launch; API CONNECT and inspected TLS; 11 selected responses; 1 parsed/displayed replay; 0 decode failures | Administrator rights are not needed for this tested routing path. Integrate lifecycle and Steam launch setup into the app; retain explicit first-use certificate consent. |

The published [codec contract](proxy-codec.md) and [live validation record](proxy-live-validation.md) describe the implemented acquisition boundary. Machine-specific investigation notes remain local development artifacts.

## Observer flow

1. Launch the local viewer and process-scoped collector. The game continues to own authentication and every request. There is no second login, endpoint polling, request replay, or action automation.
2. Establish routing with original TLS passed through. A normal restart through Steam creates fresh connections. The bounded probe writes only counters and stops automatically.
3. Review the generated CA's exact thumbprint and current-user trust scope, then obtain explicit approval before installing it. Trust is wider than the collector's game-only traffic filter. Inspect only the exact API hostname while validating the upstream certificate normally. If the game rejects the certificate, investigate that boundary; do not silently disable validation or change the game.
4. Observe Room Match and Champions responses. The temporary matching request context contains only a derived IV. Attempt the bounded historical CBC/MessagePack decoder; unsupported formats fail without altering the game response or persisting raw bodies. This is distinct from the unlinked GCM/LZ4 export found in `libnative`.
5. Copy explicit replay/runner fields into atomic JSON files in `captures/inbox`. The viewer validates the inner compressed replay and displays the latest capture. Portable export keeps the same-response horseACT graph; shareable export still omits trainer fields. Auth/session envelopes stay out.
6. Validate one real Room Match end to end before claiming automatic capture works. Then verify shared replays and Champions history, including whether a separate metadata response requires an explicit race-identity join.

The successful regular mode removes the Windows capture-helper elevation requirement. First-use certificate consent and Steam launch integration still mean that "launch the app" cannot yet be promised as a zero-setup installation. A future installer could generate a distinct CA locally, present the trust change once, and provide removal; never ship a shared CA private key. The app should start its listener before the game, preserve Steam options, and handle proxy shutdown/crash recovery. No anti-cheat compatibility or undetectability guarantee is established. The test does not hook, patch or read the game process.

## Replay contracts observed statically

These are installed metadata literals, not requests made by the collector. Their HTTP path is expected beneath the game API prefix, as in the historical client, pending a real inspected response.

| Endpoint | Request fields declared on subtype | Declared response/use |
| --- | --- | --- |
| `/room_match/get_saved_race_result_list` | None | `race_result_array`, `room_user_array`; saved-race listing. |
| `/room_match/get_saved_race_result` | `saved_room_id`, `register_id` | `race_scenario`, `race_horse_data_array`, `trained_chara_array`, conditions/results; best complete first fixture. |
| `/champions/get_race_history_info` | Inherited context not established | `race_history_info_array`; each history item declares `race_num` and `room_info`, whose schema declares `race_scenario`. |
| `/champions/get_race_result_chart` | `race_num` | Runner/trained-character arrays and room-user metadata; no direct scenario declared. |

The importer accepts the inferred Champions history structure. The collector does not combine chart-only data by arrival order, frame order alone or array index. Future joins require matching explicit race identities in actual responses. Shared codes, retention and authorization remain unverified; the user operates those controls in the official game.

## Implemented and remaining

Implemented: replay results/replay/telemetry viewer; Global inner replay parser; decoded JSON/MessagePack/HAR/log import; safe portable JSON export; local folder bridge; bounded proxy addon with race allowlist and counters; historical offline envelope codec. The codec/addon tests use synthetic data, not a captured race.

Remaining work: test Champions Meeting and shared-replay paths, enrich character/skill/course metadata, handle any explicit cross-response metadata joins, and package first-run consent plus capture/viewer lifecycle into the application. First-use CA trust is still necessary for this approach. See [proxy setup and operation](proxy-capture.md) for the concrete launcher and test lifecycle.
