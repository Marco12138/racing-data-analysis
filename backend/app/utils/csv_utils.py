"""CSV upload helpers."""

from __future__ import annotations

from io import BytesIO

import pandas as pd
from fastapi import UploadFile


class CsvUploadError(ValueError):
    """Raised when an uploaded CSV is invalid or exceeds configured limits."""


async def read_upload_csv(file: UploadFile | None, max_bytes: int) -> pd.DataFrame:
    """Validate and read an uploaded CSV file into a dataframe."""
    if file is None:
        return pd.DataFrame()
    filename = file.filename or "upload.csv"
    if not filename.lower().endswith(".csv"):
        raise CsvUploadError("Only CSV files are accepted.")
    content = await file.read(max_bytes + 1)
    if len(content) > max_bytes:
        raise CsvUploadError(f"CSV file exceeds the {max_bytes // (1024**2)} MB limit.")
    if not content:
        raise CsvUploadError("CSV file is empty.")
    try:
        return pd.read_csv(BytesIO(content))
    except (pd.errors.ParserError, UnicodeDecodeError) as exc:
        raise CsvUploadError("CSV file could not be parsed as UTF-8 tabular data.") from exc
