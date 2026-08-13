"""Tests for scripts/verify_llm_config.py (no secrets are ever printed)."""

from __future__ import annotations

import sys
from pathlib import Path

import httpx
import pytest

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / "scripts"))

import verify_llm_config as verify  # noqa: E402


def client_with(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def ok_handler(request: httpx.Request) -> httpx.Response:
    return httpx.Response(
        200,
        json={"choices": [{"message": {"content": "Hello"}}]},
    )


def test_missing_variables_raise() -> None:
    with pytest.raises(verify.VerifyError, match="LLM_BASE_URL"):
        verify.config_from_env({})
    with pytest.raises(verify.VerifyError, match="LLM_API_KEY"):
        verify.config_from_env({"LLM_BASE_URL": "https://x", "LLM_MODEL": "m"})


def test_success_returns_verdict_without_key() -> None:
    with client_with(ok_handler) as client:
        result = verify.verify_connectivity(
            "https://api.deepseek.com/v1",
            "super-secret-key-123",
            "deepseek-chat",
            client=client,
        )
    assert result.ok is True
    assert result.status_code == 200
    assert result.latency_ms is not None
    assert "通过" in result.message
    assert "super-secret-key-123" not in repr(result)


@pytest.mark.parametrize("status_code", [401, 500])
def test_http_failures_are_reported(status_code: int) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status_code, json={"error": "boom"})

    with client_with(handler) as client:
        result = verify.verify_connectivity(
            "https://api.deepseek.com/v1",
            "secret",
            "deepseek-chat",
            client=client,
        )
    assert result.ok is False
    assert result.status_code == status_code
    assert "secret" not in result.message


def test_malformed_response_is_rejected() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"choices": [{"message": {}}]})

    with client_with(handler) as client:
        result = verify.verify_connectivity(
            "https://api.deepseek.com/v1",
            "secret",
            "deepseek-chat",
            client=client,
        )
    assert result.ok is False
    assert "格式错误" in result.message


def test_deepseek_model_on_openai_endpoint_warns() -> None:
    with client_with(ok_handler) as client:
        result = verify.verify_connectivity(
            "https://api.openai.com/v1",
            "secret",
            "deepseek-chat",
            client=client,
        )
    assert result.ok is True
    assert any("deepseek-chat 在 api.openai.com 不可用" in warning for warning in result.warnings)


def test_network_error_is_reported_without_key() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    with client_with(handler) as client:
        result = verify.verify_connectivity(
            "https://api.deepseek.com/v1",
            "super-secret-key",
            "deepseek-chat",
            client=client,
        )
    assert result.ok is False
    assert "super-secret-key" not in repr(result)
    assert "请求失败" in result.message


def test_non_ascii_key_is_reported_without_traceback() -> None:
    with client_with(ok_handler) as client:
        result = verify.verify_connectivity(
            "https://api.deepseek.com/v1",
            "密钥-非-ascii",
            "deepseek-chat",
            client=client,
        )
    assert result.ok is False
    assert "非 ASCII" in result.message
    assert "密钥-非-ascii" not in repr(result)
