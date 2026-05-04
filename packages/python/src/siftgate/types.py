from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, BinaryIO, Callable, Mapping, Optional, Tuple, Union

JsonValue = Any
JsonDict = Mapping[str, JsonValue]
Headers = Mapping[str, str]
RoutingHint = Union[str, Mapping[str, JsonValue]]
FileContent = Union[bytes, bytearray, BinaryIO]
FileInput = Union[
    str,
    Path,
    bytes,
    bytearray,
    BinaryIO,
    Tuple[str, FileContent],
    Tuple[str, FileContent, str],
]


@dataclass(frozen=True)
class SiftGateResponse:
    """Raw HTTP response returned by request_raw."""

    status_code: int
    headers: Mapping[str, str]
    content: bytes
    url: str

    @property
    def text(self) -> str:
        return self.content.decode("utf-8", errors="replace")

    def json(self) -> JsonValue:
        import json

        return json.loads(self.text)


Transport = Callable[[str, str, Mapping[str, str], Optional[bytes], Optional[float]], SiftGateResponse]
