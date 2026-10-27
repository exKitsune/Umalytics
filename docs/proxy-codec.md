# Historical HTTP envelope codec

`scripts/proxy/uma_envelope.py` is an independently written, offline decoder for one application-envelope layout described by the historical Eden/Icarus source. It uses standard `cryptography` and `msgpack` libraries. It does not import or execute either project, copy their fixed header/salt literals, make requests, authenticate, or inspect a process. Their source implementations have not been reused.

This codec has now decoded a **genuine saved Room Match response from the installed Steam Global build**, followed by successful inner replay parsing and browser display. See [the live test record](proxy-live-validation.md). That is not proof of compatibility with every endpoint or future version. At the codec boundary a successful decode establishes structural validity, not cryptographic authentication or server origin; upstream TLS validation supplies the transport check during capture. AES-CBC does not provide an integrity check here. This codec does not attempt the separate GCM/LZ4 format found in `libnative`.

## Integration contract

```python
from uma_envelope import (
    EnvelopeDecodeError,
    extract_request_context,
    decode_response_body,
)

# Bodies must already be plaintext HTTP content after HTTP content decoding.
# They must belong to the same intercepted request/response pair.
try:
    context = extract_request_context(request_body)
    response = decode_response_body(response_body, context)
except EnvelopeDecodeError as error:
    # Fixed error.code / str(error) are safe diagnostics. Do not log body/locals.
    status = error.code
```

`decode_exchange(request_body, response_body)` is a convenience form. Returned response objects may still contain account fields; only the collector's explicit race-field allowlist reaches exported race JSON. The local response archive retains decoded fields after removing authentication/session fields. Separately, the opt-in [full development capture](desktop-package.md#full-development-capture) preserves raw exchanges, including credentials, for local protocol diagnosis. Neither archive belongs in shared diagnostic logs.

`RequestContext` contains only the sixteen-byte response IV derived from the request. It contains no SID, auth key, request payload, or complete UDID. Its representation is redacted and pickling is refused. Keep it local to one flow, discard it after decoding, and never put it in serialized flow metadata. Python immutable bytes are not guaranteed to be zeroized; this module does not claim secure-memory erasure. A caller can still accidentally retain bodies or decoded data, so the addon must avoid flow dumps and secret-bearing logs.

## Request-layout recognition

Both inspected historical clients use these field widths in their request header:

```text
uint32 little-endian header length
52-byte fixed prefix | 16-byte SID | 16-byte raw UDID | 32-byte nonce
optional 48-byte auth suffix
CBC ciphertext (at least one 16-byte block) | 32-byte key
```

All bytes above are inside base64 at the HTTP-body level. Supported header lengths are exactly 116 (no auth suffix) and 164 (48-byte suffix). The UDID begins at decoded byte offset 72. Only its first eight bytes are transformed to sixteen lowercase ASCII hex characters to form the historical response IV. This matches the historical `get_iv` rule; it is not the UUID bytes themselves.

The fixed prefix's **contents are deliberately not copied or matched**. This parser therefore recognizes a constrained candidate layout, not a magic signature or authenticated request. It checks the body size, canonical base64, header length, header bounds, and remaining CBC/key lengths, and does not decode the request payload. Unknown auth suffix/header sizes are rejected, including a hypothetical 32-byte auth variant that was not established by the inspected flow. It does not guess offsets from arbitrary lengths.

Evidence: `research/eden-source/uma_api/client.py:183–189` and `research/icarus/historical-client.py:213–219` construct the same fields; their fixed-prefix literals measure 52 bytes. Eden's game-capture path requires a 48-byte auth length (`main.py:2212`), and its request parser independently identifies the same UDID position from the header end (`main.py:65–72`). These are historical static observations, not a current intercepted message.

## Response checks

The decoder requires base64 containing aligned AES-CBC ciphertext followed by a 32-byte application key. It decrypts using the same request's derived IV, validates PKCS#7 padding, and requires the four-byte little-endian plaintext length to exactly match the remaining MessagePack bytes. It accepts only one complete MessagePack value with a dictionary root and string root keys.

Limits are 8 MiB after base64 decoding, 100,000 entries per collection, 2,000,000 traversed object nodes, and depth 64. Traversal uses depth-bounded iterators. Encoded-body size is checked before decoding. Leading/trailing HTTP whitespace is permitted; internal whitespace, noncanonical base64, malformed padding, trailing bytes, duplicate map keys, unsupported extensions/types, nonfinite floats, and unknown layouts are rejected. The selected format does not require decompression at this layer; inner `race_scenario` decompression belongs to the existing bounded replay parser.

`EnvelopeDecodeError` retains only a fixed code and generic text. Lower-level exceptions are not chained, because MessagePack errors such as `ExtraData` can retain plaintext values. Do not log exception tracebacks with local variables. Unsupported data fails closed; there is no algorithm, key, IV or header-offset guessing.

## System validation

Runtime integration was exercised through the scoped proxy capture of one genuine replay. Current validation uses the offline import CLI, HTTP bridge, launcher and packaged-service system checks. This codec alone does not decode TLS packet captures; it consumes HTTP bodies after TLS inspection. Other replay modes still need live validation.
