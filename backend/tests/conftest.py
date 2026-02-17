"""Pytest configuration and shared fixtures for GridMind tests."""

import sys
from pathlib import Path

import pytest

# Add backend to path for imports
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

