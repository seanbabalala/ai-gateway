from __future__ import annotations

from openai import OpenAI

from shared import (
    chat_response_format,
    gateway_api_key,
    model_name,
    print_run_context,
    siftgate_headers,
    siftgate_v1_base_url,
)


def main() -> None:
    print_run_context("openai-sdk-base-url")

    client = OpenAI(
        base_url=siftgate_v1_base_url(),
        api_key=gateway_api_key(),
        default_headers=siftgate_headers(),
    )

    response = client.chat.completions.create(
        model=model_name(),
        messages=[
            {
                "role": "system",
                "content": "Return only data that matches the requested JSON schema.",
            },
            {
                "role": "user",
                "content": "Summarize why agent traffic should go through SiftGate.",
            },
        ],
        response_format=chat_response_format(),
    )

    print(response.choices[0].message.content)


if __name__ == "__main__":
    main()
