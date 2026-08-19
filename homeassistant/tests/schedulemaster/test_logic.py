"""Tests for the pure projection logic (dependency-free)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sm_under_test import logic
from sm_under_test.logic import HeaterRef
from sm_under_test.models import Reservation

LEAD = timedelta(hours=2)
FLIGHT = datetime(2026, 1, 15, 14, 0, tzinfo=UTC)  # cold January flight
MAP = {"N123AB": HeaterRef("input_boolean.heater_1", "C172")}


def _res(key="k1", n="N123AB", start=FLIGHT, maint=False):
    return Reservation(
        key=key,
        n_number=n,
        start=start,
        end=start + timedelta(hours=2),
        pilot_first="Amy",
        pilot_last="Aviator",
        pilot_email="amy@example.com",
        destination="KJYO",
        user_id="42",
        maint=maint,
    )


def test_build_nnumber_map_normalizes_and_ignores_blanks():
    entities = [
        ("input_boolean.heater_1", {"n_number": " n123ab ", "aircraft_type": "C172"}),
        ("switch.heater_2", {"n_number": "N9525D"}),
        ("switch.other", {}),
        ("sensor.heater_1_power", {"n_number": None}),
    ]
    m = logic.build_nnumber_map(entities)
    assert m == {
        "N123AB": HeaterRef("input_boolean.heater_1", "C172"),
        "N9525D": HeaterRef("switch.heater_2", None),
    }


def test_project_maps_and_applies_lead():
    events = logic.project_events(
        [_res()], MAP, set(), None, preheat_lead=LEAD, warm_threshold_f=45.0
    )
    assert len(events) == 1
    ev = events[0]
    assert ev.entity_id == "input_boolean.heater_1"
    assert ev.start == FLIGHT - LEAD
    assert ev.end == FLIGHT
    assert ev.flight_start == FLIGHT
    assert ev.flight_end == FLIGHT + timedelta(hours=2)
    assert ev.uid == "sm-k1"
    assert ev.username == "Amy Aviator"
    assert ev.user_id == "42"
    assert ev.user_email == "amy@example.com"
    assert ev.n_number == "N123AB"
    assert ev.aircraft_type == "C172"
    assert ev.comment == "KJYO"


def test_project_skips_maintenance_reservations():
    events = logic.project_events(
        [_res(maint=True)], MAP, set(), None,
        preheat_lead=LEAD, warm_threshold_f=45.0,
    )
    assert events == []


def test_project_skips_unmapped_tail():
    events = logic.project_events(
        [_res(n="N000ZZ")], MAP, set(), None,
        preheat_lead=LEAD, warm_threshold_f=45.0,
    )
    assert events == []


def test_project_skips_suppressed():
    events = logic.project_events(
        [_res(key="k1")], MAP, {"k1"}, None, preheat_lead=LEAD, warm_threshold_f=45.0
    )
    assert events == []


def test_project_omits_warm_flight():
    warm = lambda when: 60.0  # noqa: E731 — above threshold
    events = logic.project_events(
        [_res()], MAP, set(), warm, preheat_lead=LEAD, warm_threshold_f=45.0
    )
    assert events == []


def test_project_keeps_cold_flight():
    cold = lambda when: 20.0  # noqa: E731
    events = logic.project_events(
        [_res()], MAP, set(), cold, preheat_lead=LEAD, warm_threshold_f=45.0
    )
    assert len(events) == 1


def test_project_keeps_when_forecast_unknown():
    unknown = lambda when: None  # noqa: E731 — fail toward preheating
    events = logic.project_events(
        [_res()], MAP, set(), unknown, preheat_lead=LEAD, warm_threshold_f=45.0
    )
    assert len(events) == 1


def test_make_forecast_lookup_nearest_within_gap():
    pts = [
        (datetime(2026, 1, 15, 13, 0, tzinfo=UTC), 18.0),
        (datetime(2026, 1, 15, 14, 0, tzinfo=UTC), 22.0),
        (datetime(2026, 1, 15, 15, 0, tzinfo=UTC), 25.0),
    ]
    lookup = logic.make_forecast_lookup(pts, timedelta(minutes=90))
    assert lookup(datetime(2026, 1, 15, 14, 10, tzinfo=UTC)) == 22.0


def test_make_forecast_lookup_returns_none_beyond_gap():
    pts = [(datetime(2026, 1, 15, 14, 0, tzinfo=UTC), 22.0)]
    lookup = logic.make_forecast_lookup(pts, timedelta(minutes=90))
    # Query 5 hours away — outside the max gap.
    assert lookup(datetime(2026, 1, 15, 19, 0, tzinfo=UTC)) is None
