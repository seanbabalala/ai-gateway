from __future__ import annotations

import json
import os
import uuid
from typing import Any

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover - examples can run without python-dotenv.
    load_dotenv = None

if load_dotenv:
    load_dotenv()


DEFAULT_BASE_URL = "http://localhost:2099"
DEFAULT_MODEL = "auto"
DEFAULT_ROUTING_HINT = {
    "tier": "standard",
    "optimization": "balanced",
    "capabilities": ["structured_output"],
}


def env(name: str, default: str | None = None) -> str | None:
    value = os.getenv(name)
    if value is None or value == "":
        return default
    return value


def gateway_api_key() -> str:
    value = env("SIFTGATE_API_KEY")
    if not value or value == "replace-with-dashboard-gateway-key":
        raise RuntimeError(
            "Set SIFTGATE_API_KEY to a Gateway API key created in the SiftGate Dashboard."
        )
    return value


def model_name() -> str:
    return env("SIFTGATE_MODEL", DEFAULT_MODEL) or DEFAULT_MODEL


def siftgate_base_url() -> str:
    return (env("SIFTGATE_BASE_URL", DEFAULT_BASE_URL) or DEFAULT_BASE_URL).rstrip("/")


def siftgate_v1_base_url() -> str:
    base_url = siftgate_base_url()
    return base_url if base_url.endswith("/v1") else f"{base_url}/v1"


def namespace_label() -> str:
    return env("SIFTGATE_NAMESPACE", "default") or "default"


def session_id() -> str:
    return env("SIFTGATE_SESSION_ID", "agent-demo-local-session") or "agent-demo-local-session"


def trace_id() -> str:
    return env("SIFTGATE_TRACE_ID", "agent-demo-local-trace") or "agent-demo-local-trace"


def traceparent() -> str:
    explicit = env("SIFTGATE_TRACEPARENT")
    if explicit:
        return explicit
    trace_hex = uuid.uuid5(uuid.NAMESPACE_URL, trace_id()).hex
    span_hex = uuid.uuid5(uuid.NAMESPACE_URL, f"{trace_id()}:span").hex[:16]
    return f"00-{trace_hex}-{span_hex}-01"


def routing_hint_header() -> str:
    raw = env("SIFTGATE_ROUTING_HINT")
    if not raw:
        return json.dumps(DEFAULT_ROUTING_HINT, separators=(",", ":"))
    try:
        parsed = json.loads(raw)
        return json.dumps(parsed, separators=(",", ":"))
    except json.JSONDecodeError:
        return raw


def siftgate_headers() -> dict[str, str]:
    return {
        "x-siftgate-routing-hint": routing_hint_header(),
        "x-session-id": session_id(),
        "x-trace-id": trace_id(),
        "traceparent": traceparent(),
        "x-siftgate-namespace": namespace_label(),
    }


def agent_summary_json_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "framework": {
                "type": "string",
                "description": "Agent framework used by this example.",
            },
            "route_goal": {
                "type": "string",
                "description": "Why this request was routed through SiftGate.",
            },
            "confidence": {
                "type": "number",
                "minimum": 0,
                "maximum": 1,
            },
            "next_steps": {
                "type": "array",
                "items": {"type": "string"},
                "minItems": 1,
            },
            "risk_notes": {
                "type": "array",
                "items": {"type": "string"},
            },
        },
        "required": [
            "framework",
            "route_goal",
            "confidence",
            "next_steps",
            "risk_notes",
        ],
    }


def chat_response_format() -> dict[str, Any]:
    return {
        "type": "json_schema",
        "json_schema": {
            "name": "agent_run_summary",
            "strict": True,
            "schema": agent_summary_json_schema(),
        },
    }


def responses_text_format() -> dict[str, Any]:
    return {
        "format": {
            "type": "json_schema",
            "name": "agent_run_summary",
            "strict": True,
            "schema": agent_summary_json_schema(),
        }
    }


def print_run_context(framework: str) -> None:
    print(
        json.dumps(
            {
                "framework": framework,
                "base_url": siftgate_v1_base_url(),
                "model": model_name(),
                "namespace_label": namespace_label(),
                "session_id": session_id(),
                "trace_id": trace_id(),
                "routing_hint": routing_hint_header(),
            },
            indent=2,
        )
    )
