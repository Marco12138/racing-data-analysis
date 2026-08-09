"""Ownership context shared by persistence adapters and future auth dependencies."""

from __future__ import annotations

from dataclasses import dataclass


ANONYMOUS_OWNER_ID = "anonymous-public-demo"


@dataclass(frozen=True, slots=True)
class ActorContext:
    """Identify the owner scope applied to one persistence operation."""

    owner_id: str
    authenticated: bool

    def __post_init__(self) -> None:
        """Reject unusable owner identifiers before they reach a repository."""
        normalized = self.owner_id.strip()
        if not normalized or len(normalized) > 255:
            raise ValueError("owner_id must contain between 1 and 255 characters.")
        object.__setattr__(self, "owner_id", normalized)

    @classmethod
    def anonymous(cls) -> "ActorContext":
        """Return the stable owner used by the current anonymous Demo."""
        return cls(owner_id=ANONYMOUS_OWNER_ID, authenticated=False)

    @classmethod
    def authenticated_user(cls, subject: str) -> "ActorContext":
        """Create a future authenticated owner from a verified identity subject."""
        normalized = subject.strip()
        if not normalized:
            raise ValueError("Authenticated identity subject cannot be empty.")
        return cls(owner_id=f"user:{normalized}", authenticated=True)


ANONYMOUS_ACTOR = ActorContext.anonymous()
