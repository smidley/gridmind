"""Tests for GridMind Optimize functionality."""

import pytest
from datetime import datetime
from unittest.mock import patch
from zoneinfo import ZoneInfo


class TestOptimizerState:
    """Test optimizer state management."""

    def test_get_state_returns_expected_fields(self):
        """Test get_state returns all expected fields."""
        with patch("automation.optimizer.setup_store") as mock_store:
            mock_store.get.return_value = None
            mock_store.get_timezone.return_value = "America/Los_Angeles"

            from automation.optimizer import get_state, _state

            # Reset state
            _state["enabled"] = False
            _state["phase"] = "idle"

            state = get_state()

            assert "enabled" in state
            assert "phase" in state
            assert "peak_start_hour" in state
            assert "peak_end_hour" in state
            assert "buffer_minutes" in state
            assert "min_reserve_pct" in state

    def test_phase_persists_to_store(self):
        """Test _set_phase persists phase to setup_store."""
        with patch("automation.optimizer.setup_store") as mock_store:
            mock_store.get_timezone.return_value = "America/Los_Angeles"

            from automation.optimizer import _set_phase, _state

            _set_phase("dumping")

            mock_store.set.assert_any_call("gridmind_optimize_phase", "dumping")
            assert _state["phase"] == "dumping"


class TestTOUPeriodDetection:
    """Test TOU period detection logic."""

    def test_on_peak_detected_correctly(self):
        """Test ON_PEAK is detected during peak hours (uses manual fallback)."""
        with patch("tesla.commands._cached_site_config", None):
            from automation.optimizer import _get_tou_peak_info, _state

            _state["peak_start_hour"] = 17
            _state["peak_end_hour"] = 21

            tz = ZoneInfo("America/Los_Angeles")
            peak_time = datetime(2024, 1, 15, 18, 0, tzinfo=tz)

            result = _get_tou_peak_info(peak_time)

            assert result["in_peak"] is True
            assert result["source"] == "manual"

    def test_off_peak_detected_correctly(self):
        """Test OFF_PEAK (night) is detected correctly."""
        with patch("tesla.commands._cached_site_config", None):
            from automation.optimizer import _get_tou_peak_info, _state

            _state["peak_start_hour"] = 17
            _state["peak_end_hour"] = 21

            tz = ZoneInfo("America/Los_Angeles")
            off_peak_time = datetime(2024, 1, 15, 22, 0, tzinfo=tz)

            result = _get_tou_peak_info(off_peak_time)

            assert result["in_peak"] is False
            assert result["source"] == "manual"

    def test_before_peak_not_in_peak(self):
        """Test time before peak is not detected as peak."""
        with patch("tesla.commands._cached_site_config", None):
            from automation.optimizer import _get_tou_peak_info, _state

            _state["peak_start_hour"] = 17
            _state["peak_end_hour"] = 21

            tz = ZoneInfo("America/Los_Angeles")
            before_peak = datetime(2024, 1, 15, 10, 0, tzinfo=tz)

            result = _get_tou_peak_info(before_peak)

            assert result["in_peak"] is False

