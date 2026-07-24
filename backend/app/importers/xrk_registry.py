"""Parser selection and native capability probing for AiM logger imports."""

from __future__ import annotations

import platform
from dataclasses import asdict, dataclass
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any, Protocol

from .xrk import XrkImportError

PARSER_LICENSE = "MIT"
PARSER_STATUS = "beta"


@dataclass(frozen=True)
class ParserProbe:
    """Serializable parser capability returned to API clients."""

    name: str
    available: bool
    version: str | None
    license: str | None
    status: str
    platform: str
    error_code: str | None = None
    message: str | None = None

    def as_dict(self) -> dict[str, Any]:
        """Return a JSON-ready capability payload."""
        return asdict(self)


class XrkParserAdapter(Protocol):
    """Adapter contract shared by cross-platform and official parsers."""

    name: str

    def probe(self) -> ParserProbe:
        """Check whether this parser can load on the current host."""

    def inspect_and_extract(self, source: Path, output_dir: Path) -> dict[str, Any]:
        """Inspect a logger file and create normalized temporary artifacts."""


@dataclass(frozen=True)
class LibXrkAdapter:
    """Cross-platform libxrk implementation used by the public Demo."""

    name: str = "libxrk"

    def probe(self) -> ParserProbe:
        """Import the package and its native extension before accepting uploads."""
        try:
            _import_libxrk()
        except ModuleNotFoundError:
            return ParserProbe(
                name=self.name,
                available=False,
                version=None,
                license=PARSER_LICENSE,
                status=PARSER_STATUS,
                platform=platform.system().lower(),
                error_code="XRK_PARSER_NOT_INSTALLED",
                message="The server XRK parser is not installed.",
            )
        except (ImportError, OSError) as exc:
            return ParserProbe(
                name=self.name,
                available=False,
                version=_package_version("libxrk"),
                license=PARSER_LICENSE,
                status=PARSER_STATUS,
                platform=platform.system().lower(),
                error_code="XRK_NATIVE_LIBRARY_MISSING",
                message=f"The XRK parser native library could not be loaded ({type(exc).__name__}).",
            )
        return ParserProbe(
            name=self.name,
            available=True,
            version=_package_version("libxrk"),
            license=PARSER_LICENSE,
            status=PARSER_STATUS,
            platform=platform.system().lower(),
        )

    def inspect_and_extract(self, source: Path, output_dir: Path) -> dict[str, Any]:
        """Use the existing normalized libxrk extraction implementation."""
        from .xrk_inspection import inspect_xrk_file

        return inspect_xrk_file(source, output_dir)


@dataclass(frozen=True)
class AimOfficialDllAdapter:
    """Documented compatibility target for the Windows-only AiM SDK."""

    name: str = "aim_official_dll"

    def probe(self) -> ParserProbe:
        """Report that the official SDK is intentionally not bundled."""
        return ParserProbe(
            name=self.name,
            available=False,
            version=None,
            license="AiM proprietary",
            status="not_bundled",
            platform=platform.system().lower(),
            error_code="XRK_PLATFORM_UNSUPPORTED",
            message=(
                "The AiM official DLL adapter is not bundled in this service. "
                "Use the cross-platform libxrk adapter."
            ),
        )

    def inspect_and_extract(self, source: Path, output_dir: Path) -> dict[str, Any]:
        """Refuse use until a Windows native converter is installed."""
        del source, output_dir
        raise XrkImportError(
            "The AiM official DLL adapter is not available in this deployment."
        )


@dataclass(frozen=True)
class UnsupportedAdapter:
    """Explicit failure adapter for unknown configuration values."""

    configured_name: str
    name: str = "unsupported"

    def probe(self) -> ParserProbe:
        """Expose a readable configuration failure."""
        return ParserProbe(
            name=self.configured_name,
            available=False,
            version=None,
            license=None,
            status="unsupported",
            platform=platform.system().lower(),
            error_code="XRK_PLATFORM_UNSUPPORTED",
            message=f"Configured XRK parser '{self.configured_name}' is not supported.",
        )

    def inspect_and_extract(self, source: Path, output_dir: Path) -> dict[str, Any]:
        """Refuse parsing for an unknown adapter."""
        del source, output_dir
        raise XrkImportError(
            f"Configured XRK parser '{self.configured_name}' is not supported."
        )


class XrkParserRegistry:
    """Select a parser without coupling routes to a third-party package."""

    def __init__(self, configured_parser: str = "auto", enabled: bool = True) -> None:
        self.configured_parser = configured_parser.strip().lower() or "auto"
        self.enabled = enabled

    def selected_adapter(self) -> XrkParserAdapter:
        """Return the configured parser adapter."""
        if self.configured_parser in {"auto", "libxrk"}:
            return LibXrkAdapter()
        if self.configured_parser in {"aim", "aim_official_dll"}:
            return AimOfficialDllAdapter()
        return UnsupportedAdapter(self.configured_parser)

    def probe(self) -> ParserProbe:
        """Return the effective server import capability."""
        adapter = self.selected_adapter()
        if not self.enabled:
            base = adapter.probe()
            return ParserProbe(
                name=base.name,
                available=False,
                version=base.version,
                license=base.license,
                status="disabled",
                platform=base.platform,
                error_code="XRK_UPLOAD_REJECTED",
                message="XRK server imports are disabled in this deployment.",
            )
        return adapter.probe()

    def require_available(self) -> XrkParserAdapter:
        """Return the parser or raise a machine-readable worker error."""
        probe = self.probe()
        if not probe.available:
            raise ParserUnavailableError(probe)
        return self.selected_adapter()


class ParserUnavailableError(XrkImportError):
    """Raised in the worker when parser capability probing fails."""

    def __init__(self, probe: ParserProbe) -> None:
        super().__init__(probe.message or "XRK parser is unavailable.")
        self.probe = probe


def _package_version(package: str) -> str:
    """Return an installed package version without failing capability checks."""
    try:
        return version(package)
    except PackageNotFoundError:
        return "unknown"


def _import_libxrk() -> Any:
    """Import the native-backed callable in a patchable probe boundary."""
    from libxrk import aim_xrk

    return aim_xrk
