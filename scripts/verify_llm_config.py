#!/usr/bin/env python3
"""Verify the optional LLM configuration without exposing the API key.

Reads LLM_BASE_URL / LLM_API_KEY / LLM_MODEL from the environment, sends one
minimal /chat/completions probe, and prints a non-secret verdict. The API key
is only ever placed in the request header and is never written to files, logs,
or error messages.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass, field
from typing import Any

import httpx

DEEPSEEK_MODEL = "deepseek-chat"
OPENAI_OFFICIAL_HOSTS = ("api.openai.com",)


class VerifyError(RuntimeError):
    """Raised when required configuration is missing."""


@dataclass
class VerifyResult:
    ok: bool
    model: str | None = None
    base_url: str | None = None
    latency_ms: int | None = None
    message: str = ""
    warnings: list[str] = field(default_factory=list)
    status_code: int | None = None


def config_from_env(env: dict[str, str] | None = None) -> tuple[str, str, str]:
    """Return (base_url, api_key, model) or raise VerifyError."""
    source = env if env is not None else os.environ
    values = {
        name: str(source.get(name, "")).strip()
        for name in ("LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL")
    }
    missing = [name for name, value in values.items() if not value]
    if missing:
        raise VerifyError(
            "缺少环境变量：" + ", ".join(missing)
            + "。请在 Railway Dashboard 的后端服务 Variables 中设置，然后重新 Deploy。"
        )
    return values["LLM_BASE_URL"], values["LLM_API_KEY"], values["LLM_MODEL"]


def base_url_warnings(base_url: str, model: str) -> list[str]:
    warnings: list[str] = []
    try:
        host = httpx.URL(base_url).host or ""
    except Exception:
        return warnings
    if model == DEEPSEEK_MODEL and any(openai_host in host for openai_host in OPENAI_OFFICIAL_HOSTS):
        warnings.append(
            "model 是 deepseek-chat，但 base_url 指向 OpenAI 官方 endpoint。"
            "deepseek-chat 在 api.openai.com 不可用，请检查 LLM_BASE_URL。"
        )
    if model == DEEPSEEK_MODEL and "deepseek.com" in host and not base_url.rstrip("/").endswith("/v1"):
        warnings.append("deepseek 的典型 endpoint 以 /v1 结尾：https://api.deepseek.com/v1")
    return warnings


def verify_connectivity(
    base_url: str,
    api_key: str,
    model: str,
    client: httpx.Client | None = None,
) -> VerifyResult:
    """Send one minimal probe and return a non-secret verdict."""
    endpoint = base_url.rstrip("/") + "/chat/completions"
    payload: dict[str, Any] = {
        "model": model,
        "messages": [{"role": "user", "content": "Hello"}],
        "max_tokens": 5,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    warnings = base_url_warnings(base_url, model)
    owned_client = client is None
    active_client = client or httpx.Client(timeout=20.0)
    started_at = time.monotonic()
    try:
        response = active_client.post(endpoint, headers=headers, json=payload)
        latency_ms = round((time.monotonic() - started_at) * 1000)
        if response.status_code != 200:
            return VerifyResult(
                ok=False,
                model=model,
                base_url=base_url,
                latency_ms=latency_ms,
                message=f"HTTP {response.status_code}；请检查 API key、模型名与 base_url。",
                warnings=warnings,
                status_code=response.status_code,
            )
        try:
            data = response.json()
            choices = data.get("choices") if isinstance(data, dict) else None
            first_choice = choices[0] if isinstance(choices, list) and choices else None
            message = first_choice.get("message") if isinstance(first_choice, dict) else None
            content = message.get("content") if isinstance(message, dict) else None
        except ValueError:
            content = None
        if not isinstance(content, str) or not content.strip():
            return VerifyResult(
                ok=False,
                model=model,
                base_url=base_url,
                latency_ms=latency_ms,
                message="响应格式错误：缺少 choices[0].message.content。",
                warnings=warnings,
                status_code=response.status_code,
            )
        return VerifyResult(
            ok=True,
            model=model,
            base_url=base_url,
            latency_ms=latency_ms,
            message="配置正确，连通性验证通过。",
            warnings=warnings,
            status_code=response.status_code,
        )
    except UnicodeEncodeError:
        return VerifyResult(
            ok=False,
            model=model,
            base_url=base_url,
            message=(
                "API key 或 base_url 包含非 ASCII 字符。"
                "请确认 LLM_API_KEY 是有效的 ASCII 字符串（例如 sk- 开头的真实 key）。"
            ),
            warnings=warnings,
        )
    except httpx.HTTPError as exc:
        return VerifyResult(
            ok=False,
            model=model,
            base_url=base_url,
            message=f"请求失败：{type(exc).__name__}（网络或 TLS 问题）。",
            warnings=warnings,
        )
    finally:
        if owned_client:
            active_client.close()


def verify_from_env(
    env: dict[str, str] | None = None,
    client: httpx.Client | None = None,
) -> VerifyResult:
    """Load configuration and perform the same connectivity probe as the CLI."""
    base_url, api_key, model = config_from_env(env)
    return verify_connectivity(base_url, api_key, model, client=client)


def main() -> int:
    try:
        result = verify_from_env()
    except VerifyError as exc:
        print(f"错误：{exc}")
        return 2
    print("=== LLM 配置验证 ===")
    print(f"状态：{'通过' if result.ok else '失败'}")
    print(f"model：{result.model}")
    print(f"base_url：{result.base_url}")
    if result.latency_ms is not None:
        print(f"首 token 延迟（近似，整体响应耗时）：{result.latency_ms} ms")
    print(f"说明：{result.message}")
    for warning in result.warnings:
        print(f"警告：{warning}")
    if not result.ok:
        print("未打印 API key。请先在 Railway Dashboard 检查变量后重试。")
    return 0 if result.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
