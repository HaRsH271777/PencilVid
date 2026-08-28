import httpx

from supabase_store import SupabaseStore


def test_safe_executes_callback_when_client_exists():
    store = SupabaseStore()
    store.client = object()

    assert store._safe("test operation", lambda: "persisted") == "persisted"


def test_safe_contains_persistence_failures():
    store = SupabaseStore()
    store.client = object()

    assert store._safe("test operation", lambda: 1 / 0, default="fallback") == "fallback"


def test_safe_skips_callback_without_client():
    store = SupabaseStore()
    store.enabled = False
    store.client = None
    called = False

    def callback():
        nonlocal called
        called = True

    assert store._safe("test operation", callback, default="offline") == "offline"
    assert called is False


def test_authenticate_validates_bearer_token_with_auth_server(monkeypatch):
    store = SupabaseStore()
    store.enabled = True
    store.url = "https://example.supabase.co"
    store.secret_key = "server-key"

    class Response:
        status_code = 200

        @staticmethod
        def raise_for_status():
            return None

        @staticmethod
        def json():
            return {"id": "user-id"}

    def fake_get(url, *, headers, timeout):
        assert url == "https://example.supabase.co/auth/v1/user"
        assert headers == {"apikey": "server-key", "Authorization": "Bearer access-token"}
        assert timeout == 10.0
        return Response()

    monkeypatch.setattr(httpx, "get", fake_get)
    assert store.authenticate("Bearer access-token") == ("user-id", None)


def test_authenticate_rejects_expired_session(monkeypatch):
    store = SupabaseStore()
    store.enabled = True
    store.url = "https://example.supabase.co"
    store.secret_key = "server-key"

    class Response:
        status_code = 401

    monkeypatch.setattr(httpx, "get", lambda *args, **kwargs: Response())
    assert store.authenticate("Bearer expired") == (None, "Invalid or expired session")
