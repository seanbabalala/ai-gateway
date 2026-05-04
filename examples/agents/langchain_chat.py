from __future__ import annotations

from pydantic import BaseModel, Field

from shared import (
    gateway_api_key,
    model_name,
    print_run_context,
    siftgate_headers,
    siftgate_v1_base_url,
)


class AgentRunSummary(BaseModel):
    framework: str = Field(description="Agent framework used by this example.")
    route_goal: str = Field(description="Why this request was routed through SiftGate.")
    confidence: float = Field(ge=0, le=1)
    next_steps: list[str]
    risk_notes: list[str]


def main() -> None:
    try:
        from langchain_openai import ChatOpenAI
    except ImportError as exc:
        raise RuntimeError(
            "Install the example dependencies with: pip install -r examples/agents/requirements.txt"
        ) from exc

    print_run_context("langchain")

    llm = ChatOpenAI(
        model=model_name(),
        base_url=siftgate_v1_base_url(),
        api_key=gateway_api_key(),
        default_headers=siftgate_headers(),
        temperature=0,
    )

    structured_llm = llm.with_structured_output(
        AgentRunSummary,
        method="json_schema",
        strict=True,
    )

    result = structured_llm.invoke(
        "Return a short structured summary of how SiftGate helps agent routing."
    )
    print(result.model_dump_json(indent=2))


if __name__ == "__main__":
    main()
