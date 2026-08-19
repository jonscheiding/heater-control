"""Tests for the pure heater logic (dependency-free)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from hc_under_test import logic
from hc_under_test.logic import AutoOff

NOW = datetime(2026, 1, 15, 14, 0, tzinfo=UTC)
TWO_HOURS = 2 * 60 * 60


# --- value normalization ----------------------------------------------------


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("N628FN", "628FN"),
        ("628fn", "628FN"),
        ("  n628fn  ", "628FN"),
        ("628FN", "628FN"),
        ("", None),
        (None, None),
        ("N", "N"),  # too short to be an N-prefix; leave it alone
    ],
)
def test_normalize_tail(value, expected):
    assert logic.normalize_tail(value) == expected


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("02:00:00", TWO_HOURS),
        ("3h", 3 * 3600),
        ("90m", 90 * 60),
        (TWO_HOURS, TWO_HOURS),
        ("7200", TWO_HOURS),
        ({"hours": 2, "minutes": 0, "seconds": 0}, TWO_HOURS),
        ({"minutes": 90}, 90 * 60),
        ({}, 0),
        (0, 0),
        (-5, 0),
    ],
)
def test_parse_duration_accepts_every_spelling(value, expected):
    assert logic.parse_duration(value) == expected


@pytest.mark.parametrize("value", ["", "nope", None, True, "1:2"])
def test_parse_duration_rejects_garbage(value):
    with pytest.raises(ValueError):
        logic.parse_duration(value)


def test_format_duration_round_trips():
    assert logic.format_duration(TWO_HOURS) == "02:00:00"
    assert logic.parse_duration(logic.format_duration(5400)) == 5400


# --- reading the source entities --------------------------------------------


@pytest.mark.parametrize(
    ("state", "unit", "expected"),
    [
        ("1200", None, 1200.0),
        ("1200.44", None, 1200.4),
        (1200, None, 1200.0),
        ("1.2", "kW", 1200.0),
        ("1200000", "mW", 1200.0),
        ("unavailable", None, None),
        ("unknown", None, None),
        ("", None, None),
        (None, None, None),
        ("n/a", None, None),
        ("1,200", None, None),  # thousands separator is not a float
    ],
)
def test_parse_power(state, unit, expected):
    assert logic.parse_power(state, unit) == expected


def test_is_reachable_prefers_the_node_status_sensor():
    # Z-Wave JS leaves the switch "on" and available after the node dies, so a
    # configured node-status sensor is the only signal that counts.
    assert logic.is_reachable("on", "dead") is False
    assert logic.is_reachable("on", "alive") is True
    for status in ("alive", "awake", "asleep"):
        assert logic.is_reachable("on", status) is True
    for status in ("dead", "unknown", "unavailable", ""):
        assert logic.is_reachable("on", status) is False


def test_is_reachable_falls_back_to_the_switch_without_a_node_sensor():
    assert logic.is_reachable("on") is True
    assert logic.is_reachable("off") is True
    assert logic.is_reachable("unavailable") is False
    assert logic.is_reachable("unknown") is False
    assert logic.is_reachable(None) is False


def test_mirror_is_on():
    assert logic.mirror_is_on("on") is True
    assert logic.mirror_is_on("off") is False
    assert logic.mirror_is_on("unavailable") is None
    assert logic.mirror_is_on(None) is None


# --- the auto-off state machine ---------------------------------------------


def _armed(at=NOW, duration=TWO_HOURS):
    return AutoOff(at, at + timedelta(seconds=duration))


def test_turning_on_arms_a_deadline():
    d = logic.on_source_state(
        logic.CLEARED, old_state="off", new_state="on", now=NOW, duration_s=TWO_HOURS
    )
    assert d.state == _armed()
    assert d.turn_off is False


def test_turning_off_clears_the_deadline():
    d = logic.on_source_state(
        _armed(), old_state="on", new_state="off", now=NOW, duration_s=TWO_HOURS
    )
    assert d.state == logic.CLEARED


def test_attribute_only_change_holds_the_deadline():
    prev = _armed()
    d = logic.on_source_state(
        prev, old_state="on", new_state="on", now=NOW, duration_s=TWO_HOURS
    )
    assert d.state == prev


def test_going_unavailable_holds_the_deadline():
    # A flapping node is still physically drawing power; dropping the deadline
    # would let it run unbounded.
    prev = _armed()
    d = logic.on_source_state(
        prev, old_state="on", new_state="unavailable", now=NOW, duration_s=TWO_HOURS
    )
    assert d.state == prev


def test_recovering_from_unavailable_does_not_restart_the_clock():
    # The blueprint's `to: "on"` trigger restarted the timer here, so a flapping
    # heater silently extended its own runtime.
    prev = _armed(NOW - timedelta(minutes=30))
    later = NOW + timedelta(minutes=1)
    d = logic.on_source_state(
        prev,
        old_state="unavailable",
        new_state="on",
        now=later,
        duration_s=TWO_HOURS,
    )
    assert d.state == prev


def test_recovering_from_unavailable_arms_when_the_deadline_already_passed():
    prev = _armed(NOW - timedelta(hours=5))
    d = logic.on_source_state(
        prev, old_state="unavailable", new_state="on", now=NOW, duration_s=TWO_HOURS
    )
    assert d.state == _armed()


def test_zero_duration_disables_auto_off():
    d = logic.on_source_state(
        logic.CLEARED, old_state="off", new_state="on", now=NOW, duration_s=0
    )
    assert d.state.turned_on_at == NOW
    assert d.state.auto_off_at is None


def test_startup_turns_off_a_heater_whose_deadline_passed_while_down():
    # The case the blueprint's startup sweep caught: HA was down past the
    # deadline, so the heater has been running unattended.
    prev = AutoOff(NOW - timedelta(hours=5), NOW - timedelta(hours=3))
    d = logic.on_startup(prev, source_state="on", now=NOW, duration_s=TWO_HOURS)
    assert d.turn_off is True
    assert d.state == logic.CLEARED


def test_startup_restores_a_deadline_still_in_the_future():
    prev = _armed(NOW - timedelta(minutes=30))
    d = logic.on_startup(prev, source_state="on", now=NOW, duration_s=TWO_HOURS)
    assert d.state == prev
    assert d.turn_off is False


def test_startup_arms_a_heater_we_have_never_tracked():
    # No stored deadline means a freshly added entry (or one switched on before
    # this component existed) — arming beats yanking power out from under it.
    d = logic.on_startup(logic.CLEARED, source_state="on", now=NOW, duration_s=TWO_HOURS)
    assert d.turn_off is False
    assert d.state == _armed()


def test_startup_defers_while_the_source_is_still_unknown():
    # Z-Wave is often mid-interview at startup; sweeping now would fail-safe
    # every heater off on every cold boot.
    d = logic.on_startup(_armed(), source_state="unavailable", now=NOW, duration_s=TWO_HOURS)
    assert d.defer is True
    assert d.turn_off is False


def test_startup_clears_an_off_heater():
    d = logic.on_startup(_armed(), source_state="off", now=NOW, duration_s=TWO_HOURS)
    assert d.state == logic.CLEARED


def test_deadline_turns_off_a_running_heater():
    d = logic.on_deadline(_armed(), source_state="on", now=NOW)
    assert d.turn_off is True
    assert d.state == logic.CLEARED


def test_deadline_on_an_already_off_heater_is_a_no_op():
    d = logic.on_deadline(_armed(), source_state="off", now=NOW)
    assert d.turn_off is False


def test_tick_catches_a_deadline_whose_callback_never_fired():
    prev = _armed(NOW - timedelta(hours=3))
    assert logic.on_tick(prev, source_state="on", now=NOW).turn_off is True


def test_tick_leaves_a_future_deadline_alone():
    prev = _armed()
    d = logic.on_tick(prev, source_state="on", now=NOW + timedelta(minutes=5))
    assert d.turn_off is False
    assert d.state == prev


def test_shortening_the_duration_can_retire_a_running_heater():
    prev = _armed(NOW - timedelta(hours=3))
    d = logic.on_duration_changed(
        prev, source_state="on", now=NOW, duration_s=TWO_HOURS
    )
    assert d.turn_off is True


def test_lengthening_the_duration_measures_from_when_it_turned_on():
    on_at = NOW - timedelta(hours=1)
    d = logic.on_duration_changed(
        AutoOff(on_at, on_at + timedelta(seconds=TWO_HOURS)),
        source_state="on",
        now=NOW,
        duration_s=3 * 3600,
    )
    assert d.state.auto_off_at == on_at + timedelta(hours=3)


# --- persistence ------------------------------------------------------------


def test_auto_off_round_trips_through_storage():
    state = _armed()
    assert logic.load_auto_off(logic.dump_auto_off(state)) == state


@pytest.mark.parametrize(
    "data", [None, {}, {"auto_off_at": "not a date"}, {"auto_off_at": 5}]
)
def test_load_auto_off_tolerates_garbage(data):
    assert logic.load_auto_off(data) == logic.CLEARED


# --- config payloads --------------------------------------------------------


def test_normalize_heater_from_a_yaml_roster_entry():
    got = logic.normalize_heater(
        {
            "name": "N628FN",
            "switch": "switch.zooz_plug",
            "power": "sensor.zooz_plug_power",
            "node_status": "sensor.node_2_node_status",
            "n_number": "N628FN",
            "aircraft_type": " C182 ",
            "auto_off": "3h",
        }
    )
    assert got == {
        "name": "N628FN",
        "mode": "real",
        "source_entity": "switch.zooz_plug",
        "power_entity": "sensor.zooz_plug_power",
        "node_status_entity": "sensor.node_2_node_status",
        "n_number": "628FN",
        "aircraft_type": "C182",
        "auto_off": 3 * 3600,
        "virtual_watts": 0,
    }


def test_normalize_heater_virtual_drops_source_entities():
    got = logic.normalize_heater(
        {"name": "N9525D", "virtual": True, "switch": "switch.ignored"}
    )
    assert got["mode"] == "virtual"
    assert got["source_entity"] is None
    assert got["virtual_watts"] == 1200
    assert got["auto_off"] == 2 * 60 * 60


def test_plan_import_creates_updates_and_removes():
    plan = logic.plan_import(
        desired={"import:a": {"name": "A"}, "import:b": {"name": "B2"}},
        existing={"import:b": {"name": "B1"}, "import:c": {"name": "C"}},
    )
    assert plan.create == [("import:a", {"name": "A"})]
    assert plan.update == [("import:b", {"name": "B2"})]
    assert plan.remove == ["import:c"]


def test_plan_import_leaves_unchanged_entries_alone():
    same = {"import:a": {"name": "A"}}
    plan = logic.plan_import(desired=same, existing=same)
    assert plan == logic.ImportPlan(create=[], update=[], remove=[])


def test_import_unique_id_is_stable_across_a_storage_wipe():
    assert logic.import_unique_id("heater_1") == logic.import_unique_id("heater_1")


# --- the SPA contract -------------------------------------------------------


def test_heater_attributes_always_publish_every_key():
    attrs = logic.heater_attributes(
        n_number="628FN",
        aircraft_type="C182",
        power_w=1200.0,
        reachable=True,
        auto_off_at=NOW,
        source_entity="switch.zooz_plug",
    )
    assert attrs == {
        "heater": True,
        "n_number": "628FN",
        "aircraft_type": "C182",
        "power_w": 1200.0,
        "reachable": True,
        "auto_off_at": "2026-01-15T14:00:00+00:00",
        "source_entity": "switch.zooz_plug",
    }


def test_heater_attributes_keep_their_shape_when_empty():
    attrs = logic.heater_attributes(
        n_number=None,
        aircraft_type=None,
        power_w=None,
        reachable=False,
        auto_off_at=None,
        source_entity=None,
    )
    assert attrs["heater"] is True
    assert attrs["auto_off_at"] is None
    assert set(attrs) == {
        "heater",
        "n_number",
        "aircraft_type",
        "power_w",
        "reachable",
        "auto_off_at",
        "source_entity",
    }


def test_auto_off_at_carries_an_explicit_offset():
    # A zone-less timestamp is read in the browser's own zone by `new Date(...)`.
    attrs = logic.heater_attributes(
        n_number=None,
        aircraft_type=None,
        power_w=None,
        reachable=True,
        auto_off_at=NOW,
        source_entity=None,
    )
    assert attrs["auto_off_at"].endswith("+00:00")
