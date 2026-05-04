from __future__ import annotations

from typing import Any, Optional


class SiftGateError(Exception):
    """Raised for non-2xx SiftGate responses."""

    def __init__(
        self,
        message: str,
        *,
        status_code: int,
        body: Any,
        request_id: Optional[str] = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.body = body
        self.request_id = request_id
