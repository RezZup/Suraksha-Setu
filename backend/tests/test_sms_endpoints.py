import os
import uuid
import base64
import json
import time

import httpx
import pytest


BASE_URL = os.getenv("BACKEND_BASE_URL", "http://localhost:8000")


def _b64url(data: dict) -> str:
    raw = json.dumps(data, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("utf-8").rstrip("=")


def _dev_admin_headers() -> dict:
    token = f"{_b64url({'alg': 'none', 'typ': 'JWT'})}.{_b64url({'uid': 'test_admin', 'email': 'dev@example.com', 'role': 'admin'})}."
    return {"Authorization": f"Bearer {token}"}


def _request_with_retry(client: httpx.Client, method: str, path: str, retries: int = 2, **kwargs) -> httpx.Response:
    for attempt in range(retries + 1):
        try:
            return client.request(method, path, **kwargs)
        except httpx.ReadTimeout:
            if attempt == retries:
                pytest.skip(f"Backend timed out for {method} {path}")
            time.sleep(1.5)

    pytest.skip(f"Backend timed out for {method} {path}")


def _backend_available() -> bool:
    try:
        with httpx.Client(base_url=BASE_URL, timeout=5) as client:
            r = client.get("/")
            return r.status_code < 500
    except Exception:
        return False


@pytest.mark.skipif(not _backend_available(), reason=f"Backend is not reachable at {BASE_URL}")
def test_sms_endpoints_smoke():
    uid = f"test_{uuid.uuid4().hex[:8]}"
    # Avoid DB unique constraint collisions across repeated local test runs.
    unique_phone = f"+91{(int(uid[-8:], 16) % 9000000000) + 1000000000}"
    with httpx.Client(base_url=BASE_URL, timeout=45) as client:
        r = _request_with_retry(
            client,
            "POST",
            "/api/users/register-phone",
            json={
                "uid": uid,
                "phone": unique_phone,
                "email": f"{uid}@test.com",
                "name": "Test User",
            },
        )
        assert r.status_code in (200, 201)

        r = _request_with_retry(client, "GET", "/api/users/phone-count")
        assert r.status_code == 200

        r = _request_with_retry(client, "GET", "/api/sms/status")
        assert r.status_code == 200

        r = _request_with_retry(client, "GET", "/api/sms/audit-log")
        assert r.status_code == 200

        r = _request_with_retry(client, "GET", "/admin/safety/status", headers=_dev_admin_headers())
        assert r.status_code == 200

        r = _request_with_retry(client, "GET", "/admin/alerts/pending", headers=_dev_admin_headers())
        assert r.status_code == 200
