import os
import uuid

import httpx
import pytest


BASE_URL = os.getenv("BACKEND_BASE_URL", "http://localhost:8000")


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
    with httpx.Client(base_url=BASE_URL, timeout=15) as client:
        r = client.post(
            "/api/users/register-phone",
            json={
                "uid": uid,
                "phone": "+919876543210",
                "email": f"{uid}@test.com",
                "name": "Test User",
            },
        )
        assert r.status_code in (200, 201)

        r = client.get("/api/users/phone-count")
        assert r.status_code == 200

        r = client.get("/api/sms/status")
        assert r.status_code == 200

        r = client.get("/api/sms/audit-log")
        assert r.status_code == 200

        r = client.get("/admin/safety/status")
        assert r.status_code == 200

        r = client.get("/admin/alerts/pending")
        assert r.status_code == 200
