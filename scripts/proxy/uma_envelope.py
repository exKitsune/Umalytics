"""Bounded offline decoder for one historical Global HTTP-body format.

This does not make requests, decrypt TLS, load game code, or guess other ciphers.
Successful decoding establishes a structurally valid candidate, not authenticity
or compatibility with the current game. The caller must redact exported data.
"""

from __future__ import annotations

import base64
import binascii
import math
import struct
from dataclasses import dataclass, field
from typing import Any

import msgpack
from cryptography.hazmat.primitives import padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes


MAX_DECODED_BYTES = 8 * 1024 * 1024
MAX_WIRE_BYTES = 4 * ((MAX_DECODED_BYTES + 2) // 3) + 16
MAX_COLLECTION_ENTRIES = 100_000
MAX_OBJECT_NODES = 200_000
MAX_OBJECT_DEPTH = 64

# Field widths observed independently in the historical source. No fixed
# protocol prefix, salt, SID, authentication key, or account identifier is copied.
_PREFIX_BYTES = 52
_SID_BYTES = 16
_UDID_BYTES = 16
_NONCE_BYTES = 32
_KEY_BYTES = 32
_BLOCK_BYTES = 16
_HEADER_WITHOUT_AUTH = _PREFIX_BYTES + _SID_BYTES + _UDID_BYTES + _NONCE_BYTES
_SUPPORTED_HEADER_LENGTHS = frozenset({_HEADER_WITHOUT_AUTH, _HEADER_WITHOUT_AUTH + 48})

_ERROR_MESSAGES = {
    "body_type": "HTTP body must be bytes or ASCII text.",
    "size_limit": "HTTP body exceeds the codec size limit.",
    "base64": "HTTP body is not canonical base64 for the supported envelope.",
    "request_layout": "Request header layout is not supported by this codec.",
    "cbc_length": "Envelope ciphertext or appended-key length is invalid.",
    "request_context": "A valid context from this request is required.",
    "decryption": "Response could not be decoded with the historical CBC format.",
    "padding": "Response has invalid CBC padding for the selected request context.",
    "plaintext_length": "Response MessagePack length does not match its plaintext framing.",
    "messagepack": "Response is not one complete supported MessagePack value.",
    "response_shape": "Decoded response is not a supported object.",
    "structure_limit": "Decoded response exceeds the structure limits.",
}


class EnvelopeDecodeError(ValueError):
    """Only fixed diagnostic text is retained; backend exceptions are discarded."""

    def __init__(self, code: str):
        self.code = code if code in _ERROR_MESSAGES else "response_shape"
        super().__init__(_ERROR_MESSAGES[self.code])


@dataclass(frozen=True, slots=True, repr=False)
class RequestContext:
    """Short-lived IV only. Keep local to one intercepted HTTP request/response."""

    _iv: bytes = field(repr=False)

    def __post_init__(self) -> None:
        if type(self._iv) is not bytes or len(self._iv) != _BLOCK_BYTES:
            raise EnvelopeDecodeError("request_context")

    def __repr__(self) -> str:
        return "RequestContext(<redacted>)"

    def __reduce__(self):
        # Discourage accidental persistence of a per-flow value.
        raise TypeError("Request contexts cannot be serialized.")


def _body_bytes(body: bytes | str) -> bytes:
    if not isinstance(body, (bytes, str)):
        raise EnvelopeDecodeError("body_type")
    if len(body) > MAX_WIRE_BYTES:
        raise EnvelopeDecodeError("size_limit")
    if isinstance(body, str):
        encoded = None
        try:
            encoded = body.encode("ascii")
        except UnicodeEncodeError:
            pass
        # Raise outside the handler so an exception cannot retain the input text.
        if encoded is None:
            raise EnvelopeDecodeError("body_type")
        body = encoded
    return body.strip(b" \t\r\n")


def _decode_base64(body: bytes | str) -> bytes:
    encoded = _body_bytes(body)
    if not encoded or len(encoded) % 4:
        raise EnvelopeDecodeError("base64")
    decoded = None
    try:
        decoded = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        pass
    if decoded is None or base64.b64encode(decoded) != encoded:
        raise EnvelopeDecodeError("base64")
    if len(decoded) > MAX_DECODED_BYTES:
        raise EnvelopeDecodeError("size_limit")
    return decoded


def _check_cipher_length(length: int) -> None:
    if length < _KEY_BYTES + _BLOCK_BYTES or (length - _KEY_BYTES) % _BLOCK_BYTES:
        raise EnvelopeDecodeError("cbc_length")


def extract_request_context(request_body: bytes | str) -> RequestContext:
    """Derive only the response IV from a structurally recognized request.

    The historical request has a four-byte header length, a 52-byte fixed prefix,
    SID(16), raw UDID(16), nonce(32), and either no auth suffix or a 48-byte suffix.
    The prefix bytes are not matched, so this is candidate layout recognition.
    Neither the request payload nor SID/authentication fields are interpreted.
    """
    raw = _decode_base64(request_body)
    if len(raw) < 4:
        raise EnvelopeDecodeError("request_layout")
    header_length = struct.unpack_from("<I", raw)[0]
    if header_length not in _SUPPORTED_HEADER_LENGTHS:
        raise EnvelopeDecodeError("request_layout")
    header_end = 4 + header_length
    if len(raw) < header_end:
        raise EnvelopeDecodeError("request_layout")
    _check_cipher_length(len(raw) - header_end)
    start = 4 + _PREFIX_BYTES + _SID_BYTES
    # get_iv in the documented format uses ASCII hexadecimal, not raw UUID bytes.
    # Only the first eight raw UDID bytes contribute to its sixteen-byte IV.
    iv = raw[start : start + (_UDID_BYTES // 2)].hex().encode("ascii")
    return RequestContext(iv)


def _unique_map(pairs: list[tuple[Any, Any]]) -> dict:
    result = {}
    for key, value in pairs:
        if type(key) not in (str, bytes, int) or key in result:
            raise ValueError("Unsupported map key structure.")
        result[key] = value
    return result


def _reject_extension(_code: int, _data: bytes):
    raise ValueError("MessagePack extensions are not supported.")


def _check_structure(response: dict) -> None:
    if any(type(key) is not str for key in response):
        raise EnvelopeDecodeError("response_shape")
    stack = [(response, 0)]
    nodes = 0
    while stack:
        current, depth = stack.pop()
        nodes += 1
        if nodes > MAX_OBJECT_NODES or depth > MAX_OBJECT_DEPTH:
            raise EnvelopeDecodeError("structure_limit")
        if type(current) is dict:
            stack.extend((value, depth + 1) for value in current.values())
        elif type(current) is list:
            stack.extend((value, depth + 1) for value in current)
        elif type(current) is float:
            if not math.isfinite(current):
                raise EnvelopeDecodeError("response_shape")
        elif type(current) not in (str, bytes, int, bool, type(None)):
            raise EnvelopeDecodeError("response_shape")


def decode_response_body(response_body: bytes | str, context: RequestContext) -> dict:
    """Return a candidate decoded map, or a fixed-text EnvelopeDecodeError.

    Input is a plaintext HTTP body after HTTP content decoding, not TLS records.
    No GCM/LZ4 fallback, key discovery, login, or network activity is performed.
    CBC framing has no authentication check; schema validation remains necessary.
    """
    if type(context) is not RequestContext:
        raise EnvelopeDecodeError("request_context")
    raw = _decode_base64(response_body)
    _check_cipher_length(len(raw))
    ciphertext, key = raw[:-_KEY_BYTES], raw[-_KEY_BYTES:]
    padded = None
    try:
        decryptor = Cipher(algorithms.AES(key), modes.CBC(context._iv)).decryptor()
        padded = decryptor.update(ciphertext) + decryptor.finalize()
    except (ValueError, TypeError):
        pass
    if padded is None:
        raise EnvelopeDecodeError("decryption")
    plaintext = None
    try:
        unpadder = padding.PKCS7(_BLOCK_BYTES * 8).unpadder()
        plaintext = unpadder.update(padded) + unpadder.finalize()
    except ValueError:
        pass
    if plaintext is None:
        raise EnvelopeDecodeError("padding")
    if len(plaintext) < 5:
        raise EnvelopeDecodeError("plaintext_length")
    length = struct.unpack_from("<I", plaintext)[0]
    if length == 0 or length != len(plaintext) - 4:
        raise EnvelopeDecodeError("plaintext_length")

    response = None
    unpacked = False
    try:
        response = msgpack.unpackb(
            plaintext[4:],
            raw=False,
            strict_map_key=False,
            object_pairs_hook=_unique_map,
            ext_hook=_reject_extension,
            max_str_len=MAX_DECODED_BYTES,
            max_bin_len=MAX_DECODED_BYTES,
            max_array_len=MAX_COLLECTION_ENTRIES,
            max_map_len=MAX_COLLECTION_ENTRIES,
            max_ext_len=0,
        )
        unpacked = True
    except (ValueError, TypeError, msgpack.exceptions.UnpackException):
        pass
    # In particular, do not chain msgpack.ExtraData: it retains decoded values.
    if not unpacked:
        raise EnvelopeDecodeError("messagepack")
    if type(response) is not dict:
        raise EnvelopeDecodeError("response_shape")
    _check_structure(response)
    return response


def decode_exchange(request_body: bytes | str, response_body: bytes | str) -> dict:
    """Convenience API retaining request-derived context for this call only."""
    return decode_response_body(response_body, extract_request_context(request_body))
