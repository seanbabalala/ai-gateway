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


def crewai_model_name() -> str:
    model = model_name()
    return model if "/" in model else f"openai/{model}"


def main() -> None:
    try:
        from crewai import Agent, Crew, LLM, Process, Task
    except ImportError as exc:
        raise RuntimeError(
            "Install the example dependencies with: pip install -r examples/agents/requirements.txt"
        ) from exc

    print_run_context("crewai")

    llm = LLM(
        model=crewai_model_name(),
        api_key=gateway_api_key(),
        base_url=siftgate_v1_base_url(),
        extra_headers=siftgate_headers(),
        temperature=0,
    )

    researcher = Agent(
        role="SiftGate integration researcher",
        goal="Explain how SiftGate improves agent routing observability.",
        backstory="You help platform teams run agents through a local AI gateway.",
        llm=llm,
        verbose=False,
    )

    task = Task(
        description=(
            "Return a JSON object that matches the AgentRunSummary schema. "
            "Focus on cost, fallback, route explanation, session tracing, and namespace policy."
        ),
        expected_output="A valid AgentRunSummary JSON object.",
        output_pydantic=AgentRunSummary,
        agent=researcher,
    )

    crew = Crew(
        agents=[researcher],
        tasks=[task],
        process=Process.sequential,
        verbose=False,
    )

    result = crew.kickoff()
    print(result)


if __name__ == "__main__":
    main()
