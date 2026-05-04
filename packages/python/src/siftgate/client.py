from __future__ import annotations

import json
import mimetypes
import uuid
from pathlib import Path
from typing import Any, Mapping, Optional
from urllib import error, request

from .errors import SiftGateError
from .types import FileInput, Headers, JsonDict, JsonValue, RoutingHint, SiftGateResponse, Transport


class SiftGateClient:
    """Synchronous stdlib-only client for the SiftGate open-source data plane."""

    def __init__(
        self,
        *,
        base_url: str = "http://localhost:2099",
        gateway_api_key: Optional[str] = None,
        headers: Optional[Headers] = None,
        timeout: Optional[float] = None,
        transport: Optional[Transport] = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.gateway_api_key = gateway_api_key
        self.headers = dict(headers or {})
        self.timeout = timeout
        self._transport = transport or _urllib_transport

        self.models = ModelsResource(self)
        self.chat = ChatResource(self)
        self.responses = ResponsesResource(self)
        self.messages = MessagesResource(self)
        self.embeddings = EmbeddingsResource(self)
        self.rerank = RerankResource(self)
        self.images = ImagesResource(self)
        self.audio = AudioResource(self)
        self.video = VideoResource(self)
        self.videos = self.video

    def request(
        self,
        method: str,
        path: str,
        body: Optional[JsonDict] = None,
        *,
        headers: Optional[Headers] = None,
        routing_hint: Optional[RoutingHint] = None,
        timeout: Optional[float] = None,
        files: Optional[Mapping[str, FileInput]] = None,
    ) -> JsonValue:
        response = self.request_raw(
            method,
            path,
            body,
            headers=headers,
            routing_hint=routing_hint,
            timeout=timeout,
            files=files,
        )
        return _parse_response_body(response)

    def request_raw(
        self,
        method: str,
        path: str,
        body: Optional[JsonDict] = None,
        *,
        headers: Optional[Headers] = None,
        routing_hint: Optional[RoutingHint] = None,
        timeout: Optional[float] = None,
        files: Optional[Mapping[str, FileInput]] = None,
    ) -> SiftGateResponse:
        url = self._resolve_url(path)
        request_headers = self._build_headers(headers, routing_hint)

        if files:
            payload, content_type = _encode_multipart(body or {}, files)
            request_headers.setdefault("content-type", content_type)
        elif body is None:
            payload = None
        else:
            payload = json.dumps(body).encode("utf-8")
            request_headers.setdefault("content-type", "application/json")

        request_headers.setdefault("accept", "application/json")
        response = self._transport(method.upper(), url, request_headers, payload, timeout or self.timeout)

        if response.status_code < 200 or response.status_code >= 300:
            raise _to_siftgate_error(response)

        return response

    def _resolve_url(self, path: str) -> str:
        normalized_path = path if path.startswith("/") else f"/{path}"
        if self.base_url.endswith("/v1") and normalized_path.startswith("/v1/"):
            return f"{self.base_url}{normalized_path[len('/v1'):]}"
        return f"{self.base_url}{normalized_path}"

    def _build_headers(
        self,
        headers: Optional[Headers],
        routing_hint: Optional[RoutingHint],
    ) -> dict[str, str]:
        result = {key.lower(): value for key, value in self.headers.items()}
        if self.gateway_api_key and "authorization" not in result:
            result["authorization"] = f"Bearer {self.gateway_api_key}"
        for key, value in (headers or {}).items():
            result[key.lower()] = value
        if routing_hint is not None:
            result["x-siftgate-routing-hint"] = (
                routing_hint if isinstance(routing_hint, str) else json.dumps(routing_hint, separators=(",", ":"))
            )
        return result


class ModelsResource:
    def __init__(self, client: SiftGateClient) -> None:
        self._client = client

    def list(self, **options: Any) -> JsonValue:
        return self._client.request("GET", "/v1/models", **options)


class ChatCompletionsResource:
    def __init__(self, client: SiftGateClient) -> None:
        self._client = client

    def create(self, body: JsonDict, **options: Any) -> JsonValue:
        return self._client.request("POST", "/v1/chat/completions", body, **options)


class ChatResource:
    def __init__(self, client: SiftGateClient) -> None:
        self.completions = ChatCompletionsResource(client)


class ResponsesResource:
    def __init__(self, client: SiftGateClient) -> None:
        self._client = client

    def create(self, body: JsonDict, **options: Any) -> JsonValue:
        return self._client.request("POST", "/v1/responses", body, **options)


class MessagesResource:
    def __init__(self, client: SiftGateClient) -> None:
        self._client = client

    def create(self, body: JsonDict, **options: Any) -> JsonValue:
        return self._client.request("POST", "/v1/messages", body, **options)


class EmbeddingsResource:
    def __init__(self, client: SiftGateClient) -> None:
        self._client = client

    def create(self, body: JsonDict, **options: Any) -> JsonValue:
        return self._client.request("POST", "/v1/embeddings", body, **options)


class RerankResource:
    def __init__(self, client: SiftGateClient) -> None:
        self._client = client

    def create(self, body: JsonDict, **options: Any) -> JsonValue:
        return self._client.request("POST", "/v1/rerank", body, **options)


class _CreateResource:
    def __init__(self, client: SiftGateClient, path: str) -> None:
        self._client = client
        self._path = path

    def create(
        self,
        body: Optional[JsonDict] = None,
        *,
        files: Optional[Mapping[str, FileInput]] = None,
        **options: Any,
    ) -> JsonValue:
        return self._client.request("POST", self._path, body or {}, files=files, **options)


class ImagesResource:
    def __init__(self, client: SiftGateClient) -> None:
        self.generations = _CreateResource(client, "/v1/images/generations")
        self.edits = _CreateResource(client, "/v1/images/edits")
        self.variations = _CreateResource(client, "/v1/images/variations")


class AudioResource:
    def __init__(self, client: SiftGateClient) -> None:
        self.transcriptions = _CreateResource(client, "/v1/audio/transcriptions")
        self.translations = _CreateResource(client, "/v1/audio/translations")
        self.speech = _CreateResource(client, "/v1/audio/speech")


class VideoGenerationsResource:
    def __init__(self, client: SiftGateClient) -> None:
        self._client = client

    def create(self, body: JsonDict, **options: Any) -> JsonValue:
        return self._client.request("POST", "/v1/videos/generations", body, **options)


class VideoJobsResource:
    def __init__(self, client: SiftGateClient) -> None:
        self._client = client

    def retrieve(self, job_id: str, **options: Any) -> JsonValue:
        return self._client.request("GET", f"/v1/videos/{job_id}", **options)

    def content(self, job_id: str, **options: Any) -> JsonValue:
        return self._client.request("GET", f"/v1/videos/{job_id}/content", **options)

    def cancel(self, job_id: str, **options: Any) -> JsonValue:
        return self._client.request("POST", f"/v1/videos/{job_id}/cancel", {}, **options)


class VideoResource:
    def __init__(self, client: SiftGateClient) -> None:
        self.generations = VideoGenerationsResource(client)
        self.jobs = VideoJobsResource(client)


def _urllib_transport(
    method: str,
    url: str,
    headers: Mapping[str, str],
    body: Optional[bytes],
    timeout: Optional[float],
) -> SiftGateResponse:
    req = request.Request(url, data=body, headers=dict(headers), method=method)
    try:
        with request.urlopen(req, timeout=timeout) as resp:
            return SiftGateResponse(
                status_code=resp.status,
                headers=dict(resp.headers.items()),
                content=resp.read(),
                url=url,
            )
    except error.HTTPError as exc:
        return SiftGateResponse(
            status_code=exc.code,
            headers=dict(exc.headers.items()),
            content=exc.read(),
            url=url,
        )


def _parse_response_body(response: SiftGateResponse) -> JsonValue:
    content_type = _header(response.headers, "content-type")
    if not response.content:
        return None
    if content_type and "json" in content_type.lower():
        return response.json()
    if content_type and (content_type.startswith("text/") or "charset=" in content_type.lower()):
        return response.text
    return response.content


def _to_siftgate_error(response: SiftGateResponse) -> SiftGateError:
    body = _parse_response_body(response)
    request_id = _header(response.headers, "x-request-id") or _header(response.headers, "x-correlation-id")
    message = _extract_error_message(body, response.status_code)
    return SiftGateError(message, status_code=response.status_code, body=body, request_id=request_id)


def _extract_error_message(body: JsonValue, status_code: int) -> str:
    if isinstance(body, Mapping):
        error_body = body.get("error")
        if isinstance(error_body, Mapping) and isinstance(error_body.get("message"), str):
            return error_body["message"]
        if isinstance(body.get("message"), str):
            return body["message"]
    if isinstance(body, str) and body.strip():
        return body
    return f"SiftGate request failed with status {status_code}"


def _header(headers: Mapping[str, str], name: str) -> Optional[str]:
    lowered = name.lower()
    for key, value in headers.items():
        if key.lower() == lowered:
            return value
    return None


def _encode_multipart(fields: JsonDict, files: Mapping[str, FileInput]) -> tuple[bytes, str]:
    boundary = f"siftgate-{uuid.uuid4().hex}"
    chunks: list[bytes] = []

    for name, value in fields.items():
        chunks.extend(
            [
                f"--{boundary}\r\n".encode("utf-8"),
                f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8"),
                _field_value(value) + b"\r\n",
            ]
        )

    for name, file_value in files.items():
        filename, content, content_type = _coerce_file(file_value, name)
        chunks.extend(
            [
                f"--{boundary}\r\n".encode("utf-8"),
                (
                    f'Content-Disposition: form-data; name="{name}"; '
                    f'filename="{filename}"\r\nContent-Type: {content_type}\r\n\r\n'
                ).encode("utf-8"),
                content,
                b"\r\n",
            ]
        )

    chunks.append(f"--{boundary}--\r\n".encode("utf-8"))
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def _field_value(value: JsonValue) -> bytes:
    if isinstance(value, (dict, list)):
        return json.dumps(value, separators=(",", ":")).encode("utf-8")
    if value is None:
        return b""
    return str(value).encode("utf-8")


def _coerce_file(file_value: FileInput, field_name: str) -> tuple[str, bytes, str]:
    if isinstance(file_value, tuple):
        filename = file_value[0]
        raw = file_value[1]
        content_type = file_value[2] if len(file_value) > 2 else _guess_content_type(filename)
        return filename, _read_file_content(raw), content_type

    if isinstance(file_value, (str, Path)):
        path = Path(file_value)
        return path.name, path.read_bytes(), _guess_content_type(path.name)

    filename = getattr(file_value, "name", field_name)
    return Path(str(filename)).name, _read_file_content(file_value), _guess_content_type(str(filename))


def _read_file_content(raw: Any) -> bytes:
    if isinstance(raw, bytes):
        return raw
    if isinstance(raw, bytearray):
        return bytes(raw)
    data = raw.read()
    return data if isinstance(data, bytes) else bytes(data)


def _guess_content_type(filename: str) -> str:
    return mimetypes.guess_type(filename)[0] or "application/octet-stream"
