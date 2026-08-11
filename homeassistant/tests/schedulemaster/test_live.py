"""Live smoke test against the real ScheduleMaster JSON API.

Skipped unless SM_TEST_USERNAME / SM_TEST_PASSWORD are set (and aiohttp is
installed), so it never blocks the offline unit run. Wired into the weekly
``schedulemaster-regression`` workflow to catch API-contract drift — the same
role the sm-client smoke suite plays for the login-scrape flow.
"""

from __future__ import annotations

import asyncio
import os
from datetime import UTC, datetime, timedelta

import pytest

pytestmark = pytest.mark.skipif(
    not (os.environ.get("SM_TEST_USERNAME") and os.environ.get("SM_TEST_PASSWORD")),
    reason="SM_TEST_USERNAME / SM_TEST_PASSWORD not set",
)

aiohttp = pytest.importorskip("aiohttp")

from sm_under_test import api as sm_api  # noqa: E402


def test_live_token_and_schlist():
    async def run():
        async with aiohttp.ClientSession() as session:
            client = sm_api.ScheduleMasterApi(
                session,
                os.environ["SM_TEST_USERNAME"],
                os.environ["SM_TEST_PASSWORD"],
                os.environ.get("SM_TEST_BASE_URL", "https://smapi.schedulemaster.com"),
            )
            token = await client.async_get_token()
            assert token, "expected a non-empty token"

            now = datetime.now(UTC)
            reservations = await client.async_list_reservations(
                now, now + timedelta(days=7)
            )
            # We can't assert on specific bookings, only that the shape holds.
            assert isinstance(reservations, list)

    asyncio.run(run())
