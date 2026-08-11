"""Thin async client for the ScheduleMaster JSON API.

Two endpoints, both GET on ``<base_url>/SMapi.aspx``:

  findToken   ?c=findToken&username=&pwd=            -> {response:{accounts:[{token}]}}
  schlist     ?t=<token>&c=schlist&res_list=&st_date=&en_date=&uid=0&purge=F

Tokens are short-lived, so ``async_list_reservations`` fetches a fresh token on
every call. ``parse_reservation`` is a pure helper so it can be unit-tested
against captured payloads without a live account.
"""

from __future__ import annotations

from datetime import UTC, datetime, tzinfo

import aiohttp

from .const import RES_LIST
from .models import Reservation, parse_reservation, yymmdd

__all__ = [
    "Reservation",
    "ScheduleMasterApi",
    "ScheduleMasterAuthError",
    "ScheduleMasterError",
    "parse_reservation",
    "yymmdd",
]


class ScheduleMasterError(Exception):
    """Base error for ScheduleMaster API problems."""


class ScheduleMasterAuthError(ScheduleMasterError):
    """Credentials were rejected / no token returned."""


class ScheduleMasterApi:
    """Fetches reservations from ScheduleMaster."""

    def __init__(
        self,
        session: aiohttp.ClientSession,
        username: str,
        password: str,
        base_url: str,
    ) -> None:
        self._session = session
        self._username = username
        self._password = password
        self._base_url = base_url.rstrip("/")

    async def _get_json(self, params: dict[str, str]) -> dict:
        url = f"{self._base_url}/SMapi.aspx"
        try:
            async with self._session.get(url, params=params) as resp:
                resp.raise_for_status()
                # The API serves JSON but sometimes with a non-JSON content-type,
                # so don't let aiohttp's content-type guard reject it.
                return await resp.json(content_type=None)
        except aiohttp.ClientError as err:
            raise ScheduleMasterError(f"ScheduleMaster request failed: {err}") from err

    async def async_get_token(self) -> str:
        data = await self._get_json(
            {"c": "findToken", "username": self._username, "pwd": self._password}
        )
        accounts = (data.get("response") or {}).get("accounts") or []
        token = accounts[0].get("token") if accounts else None
        if not token:
            raise ScheduleMasterAuthError(
                "ScheduleMaster returned no token (check username/password)"
            )
        return str(token)

    async def async_list_reservations(
        self, start: datetime, end: datetime, tz: tzinfo = UTC
    ) -> list[Reservation]:
        token = await self.async_get_token()
        data = await self._get_json(
            {
                "t": token,
                "c": "schlist",
                "res_list": RES_LIST,
                "st_date": yymmdd(start),
                "en_date": yymmdd(end),
                "uid": "0",
                "purge": "F",
            }
        )
        rows = data.get("response") or []
        if not isinstance(rows, list):
            raise ScheduleMasterError("schlist response was not a list")
        parsed = (parse_reservation(r, tz) for r in rows if isinstance(r, dict))
        return [r for r in parsed if r is not None]
