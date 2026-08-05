"""
Integration tests for ConversionConfig settings.
Compares settings_survey.tsv (defaults) with settings_survey_disabled.tsv
(all conversion settings disabled) to verify each setting's effect.
Also validates that both variants import successfully into LimeSurvey.
"""

from pathlib import Path

import pytest
from citric import Client
from test_helpers import (
    cleanup_survey,
    import_survey_from_tsv,
    read_tsv_content,
    verify_question_exists,
    verify_survey_import,
    verify_tsv_contains_text,
    verify_tsv_does_not_contain_text,
)

# ===========================
# Helper
# ===========================


def _parse_tsv(tsv_path: Path):
    """Parse TSV into list of dicts keyed by header columns."""
    content = read_tsv_content(tsv_path)
    lines = content.strip().split("\n")
    headers = lines[0].split("\t")
    rows = []
    for line in lines[1:]:
        values = line.split("\t")
        row = {h: (values[i] if i < len(values) else "") for i, h in enumerate(headers)}
        rows.append(row)
    return rows


def _rows_by_class(rows, cls):
    return [r for r in rows if r.get("class") == cls]


# ===========================
# TSV content tests (no LimeSurvey needed)
# ===========================


class TestDefaultSettings:
    """Tests for settings_survey.tsv generated with default settings (all enabled)."""

    @pytest.fixture(autouse=True)
    def setup(self, generated_files_dir: Path):
        self.tsv_path = generated_files_dir / "settings_survey.tsv"
        if not self.tsv_path.exists():
            pytest.skip(f"TSV file not found: {self.tsv_path}")
        self.rows = _parse_tsv(self.tsv_path)

    def test_welcome_note_promoted_to_sl(self):
        """convertWelcomeNote=true: welcome note becomes surveyls_welcometext SL row."""
        sl_rows = _rows_by_class(self.rows, "SL")
        welcome = [r for r in sl_rows if r["name"] == "surveyls_welcometext"]
        assert len(welcome) == 1
        assert "Welcome" in welcome[0]["text"]

    def test_welcome_not_a_question(self):
        """convertWelcomeNote=true: welcome note is NOT emitted as a Q row."""
        q_rows = _rows_by_class(self.rows, "Q")
        assert not any(r["name"] == "welcome" for r in q_rows)

    def test_end_note_promoted_to_sl(self):
        """convertEndNote=true: end note becomes surveyls_endtext SL row."""
        sl_rows = _rows_by_class(self.rows, "SL")
        end = [r for r in sl_rows if r["name"] == "surveyls_endtext"]
        assert len(end) == 1
        assert "Thank you" in end[0]["text"]

    def test_end_not_a_question(self):
        """convertEndNote=true: end note is NOT emitted as a Q row."""
        q_rows = _rows_by_class(self.rows, "Q")
        assert not any(r["name"] == "end" for r in q_rows)

    def test_other_pattern_detected(self):
        """convertOtherPattern=true: fav_color question has other=Y."""
        q_rows = _rows_by_class(self.rows, "Q")
        fav = [r for r in q_rows if r["name"] == "favcolor"]
        assert len(fav) >= 1
        assert fav[0]["other"] == "Y"

    def test_other_choice_removed(self):
        """convertOtherPattern=true: 'other' choice removed from answer list."""
        a_rows = _rows_by_class(self.rows, "A")
        assert not any(r["name"] == "other" for r in a_rows)

    def test_markdown_converted_to_html(self):
        """convertMarkdown=true: markdown in labels becomes HTML."""
        verify_tsv_contains_text(self.tsv_path, ["<strong>Welcome</strong>"])
        verify_tsv_contains_text(self.tsv_path, ["<em>favorite</em>"])
        verify_tsv_contains_text(self.tsv_path, ["<strong>comments</strong>"])


class TestDisabledSettings:
    """Tests for settings_survey_disabled.tsv generated with all settings disabled."""

    @pytest.fixture(autouse=True)
    def setup(self, generated_files_dir: Path):
        self.tsv_path = generated_files_dir / "settings_survey_disabled.tsv"
        if not self.tsv_path.exists():
            pytest.skip(f"TSV file not found: {self.tsv_path}")
        self.rows = _parse_tsv(self.tsv_path)

    def test_no_welcome_sl_row(self):
        """convertWelcomeNote=false: no surveyls_welcometext SL row."""
        sl_rows = _rows_by_class(self.rows, "SL")
        assert not any(r["name"] == "surveyls_welcometext" for r in sl_rows)

    def test_welcome_is_a_question(self):
        """convertWelcomeNote=false: welcome stays as a regular Q row."""
        q_rows = _rows_by_class(self.rows, "Q")
        welcome = [r for r in q_rows if r["name"] == "welcome"]
        assert len(welcome) >= 1

    def test_no_end_sl_row(self):
        """convertEndNote=false: no surveyls_endtext SL row."""
        sl_rows = _rows_by_class(self.rows, "SL")
        assert not any(r["name"] == "surveyls_endtext" for r in sl_rows)

    def test_end_is_a_question(self):
        """convertEndNote=false: end stays as a regular Q row."""
        q_rows = _rows_by_class(self.rows, "Q")
        end = [r for r in q_rows if r["name"] == "end"]
        assert len(end) >= 1

    def test_other_pattern_not_detected(self):
        """convertOtherPattern=false: fav_color question does NOT have other=Y."""
        q_rows = _rows_by_class(self.rows, "Q")
        fav = [r for r in q_rows if r["name"] == "favcolor"]
        assert len(fav) >= 1
        assert fav[0]["other"] == ""

    def test_other_choice_kept(self):
        """convertOtherPattern=false: 'other' choice remains in answer list."""
        a_rows = _rows_by_class(self.rows, "A")
        assert any(r["name"] == "other" for r in a_rows)

    def test_no_markdown_conversion(self):
        """convertMarkdown=false: labels contain raw markdown, no HTML."""
        verify_tsv_contains_text(self.tsv_path, ["**Welcome**"])
        verify_tsv_contains_text(self.tsv_path, ["_favorite_"])
        verify_tsv_contains_text(self.tsv_path, ["**comments**"])
        verify_tsv_does_not_contain_text(self.tsv_path, ["<strong>"])
        verify_tsv_does_not_contain_text(self.tsv_path, ["<em>"])


# ===========================
# LimeSurvey import tests
# ===========================


def test_default_settings_import(limesurvey_client: Client, generated_files_dir: Path):
    """settings_survey.tsv (defaults) imports successfully into LimeSurvey."""
    tsv_path = generated_files_dir / "settings_survey.tsv"
    if not tsv_path.exists():
        pytest.skip(f"TSV file not found: {tsv_path}")

    survey_id = import_survey_from_tsv(limesurvey_client, tsv_path, "Settings Default Test")
    try:
        verify_survey_import(limesurvey_client, survey_id)
        verify_question_exists(limesurvey_client, survey_id, ["favcolor", "comment"])
        print("\n✓ Settings survey (defaults) imported successfully")
    finally:
        cleanup_survey(limesurvey_client, survey_id)


def test_disabled_settings_import(limesurvey_client: Client, generated_files_dir: Path):
    """settings_survey_disabled.tsv (all disabled) imports successfully into LimeSurvey."""
    tsv_path = generated_files_dir / "settings_survey_disabled.tsv"
    if not tsv_path.exists():
        pytest.skip(f"TSV file not found: {tsv_path}")

    survey_id = import_survey_from_tsv(limesurvey_client, tsv_path, "Settings Disabled Test")
    try:
        verify_survey_import(limesurvey_client, survey_id)
        verify_question_exists(limesurvey_client, survey_id, ["welcome", "favcolor", "comment", "end"])
        print("\n✓ Settings survey (all disabled) imported successfully")
    finally:
        cleanup_survey(limesurvey_client, survey_id)
