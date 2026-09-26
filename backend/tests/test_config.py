from pytest import MonkeyPatch

from app.config import AppEnvironment, Settings


def test_settings_read_environment(monkeypatch: MonkeyPatch) -> None:
    # Avoid depending on the process environment in settings tests.
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("FRONTEND_ORIGIN", "http://example.com")

    settings = Settings()

    assert settings.app_env is AppEnvironment.TEST
    assert str(settings.frontend_origin) == "http://example.com/"
