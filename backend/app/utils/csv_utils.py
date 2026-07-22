"""CSV upload helpers."""

from __future__ import annotations

from io import BytesIO

import pandas as pd
from fastapi import UploadFile


async def read_upload_csv(file: UploadFile | None) -> pd.DataFrame:
    """Read an uploaded CSV file into a dataframe."""
    if file is None:
        return pd.DataFrame()
    content = await file.read()
    return pd.read_csv(BytesIO(content))

