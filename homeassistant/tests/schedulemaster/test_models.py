"""Tests for reservation parsing (dependency-free)."""

from __future__ import annotations

from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from sm_under_test import models

EASTERN = ZoneInfo("America/New_York")

# A representative schlist row (trimmed from the API docs).
ROW = {
    "sch_id": 17283279,
    "orig_key": "abc123",
    "sch_start": "2026-07-29T06:00:00",
    "sec_start": 1785304800,
    "sch_end": "2026-07-29T21:00:00",
    "destination": "Cross Country:Chicago",
    "N_NO": "628FN",
    "made_by_user": 119421,
    "lastname": "Murry",
    "firstname": "Steven",
    "email": "stevenjmurry@gmail.com",
}


def test_parse_valid_utc():
    res = models.parse_reservation(ROW, UTC)
    assert res is not None
    assert res.key == "abc123"  # orig_key preferred
    assert res.n_number == "628FN"
    # sch_start "06:00" interpreted as UTC.
    assert res.start == datetime(2026, 7, 29, 6, 0, tzinfo=UTC)
    assert res.end == datetime(2026, 7, 29, 21, 0, tzinfo=UTC)
    assert res.pilot_name == "Steven Murry"
    assert res.pilot_email == "stevenjmurry@gmail.com"
    assert res.destination == "Cross Country:Chicago"
    assert res.user_id == "119421"


def test_parse_localizes_wall_time_to_tz():
    # "06:00" Eastern (EDT, UTC-4 in July) -> 10:00 UTC.
    res = models.parse_reservation(ROW, EASTERN)
    assert res is not None
    assert res.start == datetime(2026, 7, 29, 10, 0, tzinfo=UTC)


def test_parse_falls_back_to_sch_id_without_orig_key():
    row = {k: v for k, v in ROW.items() if k != "orig_key"}
    res = models.parse_reservation(row, UTC)
    assert res is not None
    assert res.key == "17283279"


def test_parse_missing_sch_start_returns_none():
    row = {k: v for k, v in ROW.items() if k != "sch_start"}
    assert models.parse_reservation(row, UTC) is None


def test_parse_missing_nnumber_returns_none():
    row = {**ROW, "N_NO": ""}
    assert models.parse_reservation(row, UTC) is None


def test_parse_optional_end_missing():
    row = {k: v for k, v in ROW.items() if k != "sch_end"}
    res = models.parse_reservation(row, UTC)
    assert res is not None
    assert res.end is None


def test_yymmdd():
    assert models.yymmdd(datetime(2026, 7, 29, 6, 0, tzinfo=UTC)) == "260729"
