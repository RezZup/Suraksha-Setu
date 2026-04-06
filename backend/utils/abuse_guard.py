"""Lightweight in-memory abuse protection helpers."""

import asyncio
import time
from collections import defaultdict, deque
from typing import Optional

from fastapi import HTTPException, Request

_REQUEST_LOGS = defaultdict(deque)
_REQUEST_LOCK = asyncio.Lock()


def _extract_client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


async def enforce_rate_limit(
    request: Request,
    *,
    bucket: str,
    limit: int,
    window_seconds: int,
    key_hint: Optional[str] = None,
) -> None:
    """Enforce a simple sliding-window request limit per key."""
    if limit <= 0 or window_seconds <= 0:
        return

    key = (key_hint or "").strip() or _extract_client_ip(request)
    now = time.time()
    window_start = now - window_seconds
    request_key = f"{bucket}:{key}"

    async with _REQUEST_LOCK:
        timestamps = _REQUEST_LOGS[request_key]
        while timestamps and timestamps[0] < window_start:
            timestamps.popleft()

        if len(timestamps) >= limit:
            raise HTTPException(
                status_code=429,
                detail=f"Rate limit exceeded for {bucket}. Please retry later.",
            )

        timestamps.append(now)
