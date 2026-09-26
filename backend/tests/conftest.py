from pathlib import Path

import pytest
from pytest import MonkeyPatch

from app.config import Settings


@pytest.fixture(autouse=True)
def isolate_settings_sources(monkeypatch: MonkeyPatch, tmp_path: Path) -> None:
    for field_name in Settings.model_fields:
        monkeypatch.delenv(field_name.upper(), raising=False)
    monkeypatch.chdir(tmp_path)
