"""Parser registry, signatures, and machine-readable worker error tests."""

from __future__ import annotations

from pathlib import Path

import pytest

from backend.app.importers import xrk_registry
from backend.app.importers.service import (
    AimImportError,
    parse_worker_error,
    validate_xrk_signature,
)
from backend.app.importers.xrk_registry import XrkParserRegistry


def test_registry_reports_installed_parser(monkeypatch: pytest.MonkeyPatch) -> None:
    """A successful native import should expose version and license."""
    monkeypatch.setattr(xrk_registry, "_import_libxrk", lambda: object())
    monkeypatch.setattr(xrk_registry, "_package_version", lambda _: "0.12.0")

    probe = XrkParserRegistry("auto", enabled=True).probe()

    assert probe.available is True
    assert probe.name == "libxrk"
    assert probe.version == "0.12.0"
    assert probe.license == "MIT"


@pytest.mark.parametrize(
    ("failure", "error_code"),
    [
        (ModuleNotFoundError("libxrk"), "XRK_PARSER_NOT_INSTALLED"),
        (ImportError("native extension"), "XRK_NATIVE_LIBRARY_MISSING"),
        (OSError("shared object missing"), "XRK_NATIVE_LIBRARY_MISSING"),
    ],
)
def test_registry_classifies_parser_load_failures(
    monkeypatch: pytest.MonkeyPatch,
    failure: Exception,
    error_code: str,
) -> None:
    """Capability probes should distinguish missing packages from native loading."""
    def fail() -> object:
        raise failure

    monkeypatch.setattr(xrk_registry, "_import_libxrk", fail)
    probe = XrkParserRegistry("libxrk", enabled=True).probe()

    assert probe.available is False
    assert probe.error_code == error_code


def test_registry_reports_disabled_and_unsupported_configuration() -> None:
    disabled = XrkParserRegistry("libxrk", enabled=False).probe()
    unsupported = XrkParserRegistry("unknown-parser", enabled=True).probe()

    assert disabled.error_code == "XRK_UPLOAD_REJECTED"
    assert disabled.status == "disabled"
    assert unsupported.error_code == "XRK_PLATFORM_UNSUPPORTED"


@pytest.mark.parametrize(
    "header",
    [b"<hCNFpayload", b"\x78\x01payload", b"\x78\x9cpayload", b"\x78\xdapayload"],
)
def test_signature_validation_accepts_native_and_compressed_headers(
    tmp_path: Path,
    header: bytes,
) -> None:
    source = tmp_path / "session.xrk"
    source.write_bytes(header)
    validate_xrk_signature(source)
    assert source.exists()


def test_signature_validation_removes_invalid_file(tmp_path: Path) -> None:
    source = tmp_path / "renamed.xrk"
    source.write_bytes(b"not-an-xrk")

    with pytest.raises(AimImportError) as error:
        validate_xrk_signature(source)

    assert error.value.error_code == "XRK_UNSUPPORTED_FORMAT"
    assert not source.exists()


def test_worker_error_parser_uses_json_not_stderr_text_matching() -> None:
    payload = parse_worker_error(
        b'native warning\n{"status":"error","status_code":503,'
        b'"error_code":"XRK_NATIVE_LIBRARY_MISSING","message":"native missing",'
        b'"error_type":"parser_capability"}\n'
    )

    assert payload == {
        "status_code": 503,
        "error_code": "XRK_NATIVE_LIBRARY_MISSING",
        "message": "native missing",
        "error_type": "parser_capability",
    }
