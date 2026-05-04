from __future__ import annotations

import asyncio

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


async def main() -> None:
    try:
        from agents import (
            Agent,
            AsyncOpenAI,
            OpenAIChatCompletionsModel,
            Runner,
            set_tracing_disabled,
        )
    except ImportError as exc:
        raise RuntimeError(
            "Install the example dependencies with: pip install -r examples/agents/requirements.txt"
        ) from exc

    print_run_context("openai-agents-sdk")

    # Keep OpenAI-hosted tracing off. SiftGate records local request, route, cost,
    # fallback, and route-decision metadata through the gateway instead.
    set_tracing_disabled(disabled=True)

    client = AsyncOpenAI(
        base_url=siftgate_v1_base_url(),
        api_key=gateway_api_key(),
        default_headers=siftgate_headers(),
    )

    model = OpenAIChatCompletionsModel(
        model=model_name(),
        openai_client=client,
    )

    agent = Agent(
        name="SiftGate Route Observer",
        instructions=(
            "Return a concise structured summary. Mention cost visibility, "
            "fallback visibility, route explanation, session correlation, and namespace policy."
        ),
        model=model,
        output_type=AgentRunSummary,
    )

    result = await Runner.run(
        agent,
        input="Explain why an agent framework should call SiftGate instead of a provider directly.",
    )
    final_output = result.final_output
    if hasattr(final_output, "model_dump_json"):
        print(final_output.model_dump_json(indent=2))
    else:
        print(final_output)


if __name__ == "__main__":
    asyncio.run(main())
