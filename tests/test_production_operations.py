import app as app_module
from supabase_store import SupabaseStore


def test_liveness_is_public_and_correlated():
    response = app_module.app.test_client().get("/healthz")
    assert response.status_code == 200
    assert response.get_json()["status"] == "ok"
    assert response.headers["X-Request-ID"]


def test_readiness_returns_503_when_dependency_is_not_ready(monkeypatch):
    monkeypatch.setattr(
        "runtime_health.check_readiness",
        lambda **_kwargs: {
            "status": "not_ready",
            "checks": {"database": {"ok": False, "detail": "unreachable"}},
        },
    )
    response = app_module.app.test_client().get("/readyz")
    assert response.status_code == 503
    assert response.get_json()["status"] == "not_ready"


def test_maintenance_mode_blocks_user_traffic_but_keeps_health(monkeypatch):
    monkeypatch.setattr(app_module, "MAINTENANCE_MODE", True)
    client = app_module.app.test_client()

    health = client.get("/healthz")
    readiness = client.get("/readyz")
    api = client.get("/api/videos", headers={"Accept": "application/json"})
    page = client.get("/")

    assert health.status_code == 200
    assert readiness.status_code == 503
    assert readiness.get_json()["status"] == "maintenance"
    assert api.status_code == 503
    assert api.get_json()["error"] == "maintenance"
    assert page.status_code == 503
    assert b"Sharpening" in page.data
    assert page.headers["Retry-After"] == "300"


def test_supabase_readiness_checks_database_and_private_storage(monkeypatch):
    store = SupabaseStore()
    store.enabled = True
    store.url = "https://example.supabase.co"
    store.secret_key = "server-key"
    requested = []

    class Response:
        status_code = 200

    def fake_get(url, **kwargs):
        requested.append((url, kwargs))
        return Response()

    monkeypatch.setattr("httpx.get", fake_get)
    result = store.readiness()
    assert result["database"]["ok"] is True
    assert result["storage"]["ok"] is True
    assert requested[0][0].endswith("/rest/v1/plan_catalog")
    assert requested[1][0].endswith("/storage/v1/bucket/video-assets")
    assert requested[0][1]["headers"]["Authorization"] == "Bearer server-key"
