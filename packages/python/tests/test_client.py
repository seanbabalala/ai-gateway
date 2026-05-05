from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path
from typing import Mapping, Optional

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from siftgate import SiftGateClient, SiftGateError, SiftGateResponse  # noqa: E402


class FakeTransport:
    def __init__(self, response: Optional[SiftGateResponse] = None) -> None:
        self.calls: list[dict[str, object]] = []
        self.response = response or SiftGateResponse(
            status_code=200,
            headers={"content-type": "application/json", "x-request-id": "req_ok"},
            content=b'{"ok":true}',
            url="",
        )

    def __call__(
        self,
        method: str,
        url: str,
        headers: Mapping[str, str],
        body: Optional[bytes],
        timeout: Optional[float],
    ) -> SiftGateResponse:
        self.calls.append(
            {
                "method": method,
                "url": url,
                "headers": dict(headers),
                "body": body,
                "timeout": timeout,
            }
        )
        return SiftGateResponse(
            status_code=self.response.status_code,
            headers=self.response.headers,
            content=self.response.content,
            url=url,
        )


class SiftGateClientTest(unittest.TestCase):
    def test_models_uses_base_v1_without_duplicate_path(self) -> None:
        transport = FakeTransport()
        client = SiftGateClient(
            base_url="http://localhost:2099/v1",
            gateway_api_key="gw_sk_test",
            transport=transport,
            timeout=12,
        )

        self.assertEqual(client.models.list(), {"ok": True})
        call = transport.calls[0]
        self.assertEqual(call["method"], "GET")
        self.assertEqual(call["url"], "http://localhost:2099/v1/models")
        self.assertEqual(call["timeout"], 12)
        self.assertEqual(call["headers"]["authorization"], "Bearer gw_sk_test")

    def test_chat_create_sends_json_and_routing_hint(self) -> None:
        transport = FakeTransport()
        client = SiftGateClient(base_url="http://gateway", transport=transport)

        client.chat.completions.create(
            {"model": "auto", "messages": [{"role": "user", "content": "hi"}]},
            routing_hint={"tier": "standard", "optimization": "cost"},
        )

        call = transport.calls[0]
        self.assertEqual(call["url"], "http://gateway/v1/chat/completions")
        self.assertEqual(call["headers"]["content-type"], "application/json")
        self.assertEqual(call["headers"]["x-siftgate-routing-hint"], '{"tier":"standard","optimization":"cost"}')
        self.assertEqual(
            json.loads(call["body"].decode("utf-8")),
            {"model": "auto", "messages": [{"role": "user", "content": "hi"}]},
        )

    def test_all_json_endpoint_helpers_route_to_expected_paths(self) -> None:
        transport = FakeTransport()
        client = SiftGateClient(base_url="http://gateway", transport=transport)

        client.responses.create({"model": "auto", "input": "hello"})
        client.messages.create({"model": "auto", "max_tokens": 8, "messages": []})
        client.embeddings.create({"model": "auto", "input": "hello"})
        client.rerank.create({"model": "auto", "query": "q", "documents": ["d"]})
        client.images.generations.create({"model": "auto", "prompt": "p"})
        client.audio.speech.create({"model": "auto", "input": "hello"})
        client.video.generations.create({"model": "auto", "prompt": "clip"})

        self.assertEqual(
            [call["url"] for call in transport.calls],
            [
                "http://gateway/v1/responses",
                "http://gateway/v1/messages",
                "http://gateway/v1/embeddings",
                "http://gateway/v1/rerank",
                "http://gateway/v1/images/generations",
                "http://gateway/v1/audio/speech",
                "http://gateway/v1/videos/generations",
            ],
        )

    def test_video_job_helpers(self) -> None:
        transport = FakeTransport()
        client = SiftGateClient(base_url="http://gateway", transport=transport)

        client.video.jobs.retrieve("job_123")
        client.video.jobs.content("job_123")
        client.videos.jobs.cancel("job_123")

        self.assertEqual(
            [(call["method"], call["url"]) for call in transport.calls],
            [
                ("GET", "http://gateway/v1/videos/job_123"),
                ("GET", "http://gateway/v1/videos/job_123/content"),
                ("POST", "http://gateway/v1/videos/job_123/cancel"),
            ],
        )

    def test_multipart_media_request(self) -> None:
        transport = FakeTransport()
        client = SiftGateClient(base_url="http://gateway", transport=transport)

        client.audio.transcriptions.create(
            {"model": "auto", "response_format": "json"},
            files={"file": ("speech.wav", b"RIFF", "audio/wav")},
        )

        call = transport.calls[0]
        self.assertEqual(call["url"], "http://gateway/v1/audio/transcriptions")
        self.assertIn("multipart/form-data; boundary=siftgate-", call["headers"]["content-type"])
        body = call["body"]
        self.assertIsInstance(body, bytes)
        assert isinstance(body, bytes)
        self.assertIn(b'name="model"', body)
        self.assertIn(b"auto", body)
        self.assertIn(b'filename="speech.wav"', body)
        self.assertIn(b"RIFF", body)

    def test_non_json_success_returns_bytes(self) -> None:
        transport = FakeTransport(
            SiftGateResponse(
                status_code=200,
                headers={"content-type": "audio/mpeg"},
                content=b"\x00\x01audio",
                url="",
            )
        )
        client = SiftGateClient(base_url="http://gateway", transport=transport)

        self.assertEqual(client.audio.speech.create({"model": "auto", "input": "hi"}), b"\x00\x01audio")

    def test_error_parses_body_and_request_id(self) -> None:
        transport = FakeTransport(
            SiftGateResponse(
                status_code=429,
                headers={"content-type": "application/json", "x-request-id": "req_123"},
                content=b'{"error":{"message":"Budget exceeded"}}',
                url="",
            )
        )
        client = SiftGateClient(base_url="http://gateway", transport=transport)

        with self.assertRaises(SiftGateError) as ctx:
            client.models.list()

        self.assertEqual(str(ctx.exception), "Budget exceeded")
        self.assertEqual(ctx.exception.status_code, 429)
        self.assertEqual(ctx.exception.request_id, "req_123")
        self.assertEqual(ctx.exception.body, {"error": {"message": "Budget exceeded"}})

    def test_error_prefers_x_siftgate_request_id(self) -> None:
        transport = FakeTransport(
            SiftGateResponse(
                status_code=500,
                headers={
                    "content-type": "application/json",
                    "x-siftgate-request-id": "req_public_123",
                    "x-request-id": "req_legacy_123",
                    "x-correlation-id": "corr_123",
                },
                content=b'{"error":{"message":"Gateway failed"}}',
                url="",
            )
        )
        client = SiftGateClient(base_url="http://gateway", transport=transport)

        with self.assertRaises(SiftGateError) as ctx:
            client.models.list()

        self.assertEqual(ctx.exception.request_id, "req_public_123")


if __name__ == "__main__":
    unittest.main()
