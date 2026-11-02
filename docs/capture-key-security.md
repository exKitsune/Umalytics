# Capture identity

The collector uses a fixed TLS server certificate for the single API hostname
defined in `desktop/capture_identity.py`. Its key is separate from the CA key,
its Basic Constraints mark it as a non-CA, its key usage excludes certificate
signing, and its only extended usage is TLS server authentication.

The root has critical Name Constraints permitting only the API DNS name, excluding
its descendants and all IPv4/IPv6 SANs. Its EKU permits only TLS server authentication.
Windows chain and SSL-policy tests reject out-of-scope certificates signed with a
simulated stolen key, including a replacement unconstrained root supplied by the
server. Trust-anchor constraints are not universally enforced by all clients, so
this is additional protection, not a substitute for discarding the CA key.

Fresh setup creates the root signing key in memory. It writes only the public
root certificate, public server certificate, and a user-scoped DPAPI-encrypted
server key. It never writes a fresh CA private key. The capture directory has a
protected Windows ACL granting access to the current user and SYSTEM.

Existing installations must retire the exact old public root from CurrentUser
Root, create a new root, and explicitly approve the new Windows trust prompt.
No existing CA signing key is reused. Removal can require Windows confirmation;
if it is denied or fails, migration stops and capture stays unavailable.

Only public retired-root certificates are journaled, so removal can be retried
after a crash. The old PEM and PKCS12 private keys and old server identity are
removed after retirement. A versioned identity record distinguishes fresh,
in-memory-only roots from earlier installations, including the earlier local
prototype. Missing or damaged committed identities fail closed. Existing backups
and cloud copies are outside cleanup; deleting files is not forensic erasure.
Removing trust in the old root also disables those old key copies on this user
account. No new root is silently trusted.

Initialization is serialized between supervisor and collector. Missing,
corrupt, mismatched or expired identities fail closed instead of silently
generating a different root. The server certificate expires with its root, preserving the existing setup
lifetime. Renewal needs explicit creation and trust of a new root because the
old CA can no longer sign.

The TLS store returns the existing certificate only for the API hostname; it
does not generate certificates dynamically or accept custom certificate files.
Other HTTPS connections still pass through under the observer's existing filter.
Upstream certificate verification remains enabled.

DPAPI and these permissions do not isolate the key from malware already running
as the same user. Such malware could decrypt the server key and impersonate the
API host. It would not possess this identity's CA signing key for other sites.

## Local verification

Run with `.cache/proxy-venv/Scripts/python.exe` on Windows:

1. `tests/capture-identity-workflow.py`: fresh and concurrent setup, process
   restart, encrypted key, rejected unrelated host, damaged/incomplete identity,
   and migration of both legacy CA-key formats.
2. `tests/capture-inspection-workflow.py`: real HTTPS through the collector to a
   loopback upstream, TLS verification, sanitized replay export, and development
   capture on/off, with no CA private key left on disk.
3. `tests/portable-storage-workflow.py`: service/storage lifecycle and collector
   startup after legacy migration.

4. `tests/root-constraints-workflow.py`: adversarial Windows chain and SSL policy
   with a custom in-memory trust store, including unrelated DNS, descendants,
   IPv4/IPv6, mixed SANs, CN-only leaves and a forged unconstrained root.

These tests use disposable data and explicit test-client trust. They do not
modify Windows trust or exercise the live game. Live game verification remains
required before release.
