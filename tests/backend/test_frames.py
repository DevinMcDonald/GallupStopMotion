import importlib
import io
import os
import sys

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    # point storage to a temp dir and lower frame cap for faster tests
    monkeypatch.setenv("FRAMES_DIR", str(tmp_path))
    monkeypatch.setenv("MAX_FRAMES", "3")

    # ensure we import a fresh app with the new env
    sys.modules.pop("backend.main", None)
    main = importlib.import_module("backend.main")
    return TestClient(main.app)


def make_frame_bytes():
    # small valid JPEG header + padding
    return b"\xff\xd8\xff" + b"\x00" * 10


def test_upload_increments_and_returns_count(client):
    res1 = client.post(
        "/api/frames",
        files={"frame": ("f1.jpg", io.BytesIO(make_frame_bytes()), "image/jpeg")},
    )
    assert res1.status_code == 200
    body1 = res1.json()
    assert body1["id"] == 1
    assert body1["count"] == 1

    res2 = client.post(
        "/api/frames",
        files={"frame": ("f2.jpg", io.BytesIO(make_frame_bytes()), "image/jpeg")},
    )
    assert res2.status_code == 200
    body2 = res2.json()
    assert body2["id"] == 2
    assert body2["count"] == 2


def test_frame_limit_enforced(client):
    # hit the configured cap (3)
    for _ in range(3):
        assert (
            client.post(
                "/api/frames",
                files={"frame": ("f.jpg", io.BytesIO(make_frame_bytes()), "image/jpeg")},
            ).status_code
            == 200
        )

    over = client.post(
        "/api/frames",
        files={"frame": ("f4.jpg", io.BytesIO(make_frame_bytes()), "image/jpeg")},
    )
    assert over.status_code == 429
    assert "Frame limit" in over.text


def test_delete_last_returns_new_count(client):
    for _ in range(2):
        client.post(
            "/api/frames",
            files={"frame": ("f.jpg", io.BytesIO(make_frame_bytes()), "image/jpeg")},
        )

    res = client.delete("/api/frames/last")
    assert res.status_code in (200, 204)
    if res.status_code == 200:
        assert res.json()["count"] == 1
    else:
        # If the API returns 204, re-check count via upload
        res2 = client.post(
            "/api/frames",
            files={"frame": ("f2.jpg", io.BytesIO(make_frame_bytes()), "image/jpeg")},
        )
        assert res2.status_code == 200
        assert res2.json()["id"] == 2
