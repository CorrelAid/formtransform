"""
Integration tests for the multipage_survey fixture.
Verifies that style=pages in XLSForm settings produces format=G in the TSV output,
and that field-list groups become separate LimeSurvey groups (pages).
"""

from pathlib import Path

import pytest
from citric import Client
from test_helpers import (
    cleanup_survey,
    get_survey_structure_stats,
    import_survey_from_tsv,
    read_tsv_content,
    verify_group_exists,
    verify_question_exists,
    verify_survey_import,
)


def _parse_tsv(tsv_path: Path):
    """Parse TSV into list of dicts keyed by header columns."""
    content = read_tsv_content(tsv_path)
    lines = content.strip().split("\n")
    headers = lines[0].split("\t")
    rows = []
    for line in lines[1:]:
        parts = line.split("\t")
        row = {headers[i]: (parts[i] if i < len(parts) else "") for i in range(len(headers))}
        rows.append(row)
    return rows


# ===========================
# TSV generation tests
# ===========================


def test_multipage_tsv_generated(generated_files_dir: Path):
    """Verify that multipage_survey.tsv was generated."""
    tsv_path = generated_files_dir / "multipage_survey.tsv"
    assert tsv_path.exists(), f"multipage_survey.tsv was not generated in {generated_files_dir}"


def test_format_is_G(generated_files_dir: Path):
    """Verify that style=pages produces format=G in the TSV output."""
    tsv_path = generated_files_dir / "multipage_survey.tsv"
    if not tsv_path.exists():
        pytest.skip("multipage_survey.tsv not found")

    rows = _parse_tsv(tsv_path)
    format_row = next((r for r in rows if r["class"] == "S" and r["name"] == "format"), None)
    assert format_row is not None, "No 'format' row found in S rows"
    assert format_row["text"] == "G", f"Expected format=G for style=pages survey, got '{format_row['text']}'"
    print("✓ format=G set correctly for style=pages")


def test_two_groups_present(generated_files_dir: Path):
    """Verify that both field-list groups are present as LimeSurvey groups."""
    tsv_path = generated_files_dir / "multipage_survey.tsv"
    if not tsv_path.exists():
        pytest.skip("multipage_survey.tsv not found")

    rows = _parse_tsv(tsv_path)
    group_names = {r["name"] for r in rows if r["class"] == "G"}
    assert "Page One" in group_names, f"'Page One' group missing. Groups: {group_names}"
    assert "Page Two" in group_names, f"'Page Two' group missing. Groups: {group_names}"
    assert len(group_names) == 2, f"Expected exactly 2 groups, got {len(group_names)}: {group_names}"
    print(f"✓ Both page groups present: {sorted(group_names)}")


def test_questions_in_correct_groups(generated_files_dir: Path):
    """Verify questions appear in their respective page groups."""
    tsv_path = generated_files_dir / "multipage_survey.tsv"
    if not tsv_path.exists():
        pytest.skip("multipage_survey.tsv not found")

    rows = _parse_tsv(tsv_path)
    current_group = ""
    question_group = {}
    for r in rows:
        if r["class"] == "G":
            current_group = r["name"]
        elif r["class"] == "Q" and r["name"] not in question_group:
            question_group[r["name"]] = current_group

    assert question_group.get("name") == "Page One", (
        f"'name' should be in 'Page One', got '{question_group.get('name')}'"
    )
    assert question_group.get("age") == "Page One", f"'age' should be in 'Page One', got '{question_group.get('age')}'"
    assert question_group.get("favcolor") == "Page Two", (
        f"'favcolor' should be in 'Page Two', got '{question_group.get('favcolor')}'"
    )
    assert question_group.get("thankyou") == "Page Two", (
        f"'thankyou' should be in 'Page Two', got '{question_group.get('thankyou')}'"
    )
    print("✓ Questions correctly assigned to page groups")


# ===========================
# LimeSurvey import tests
# ===========================


def test_multipage_import(limesurvey_client: Client, generated_files_dir: Path):
    """Import multipage_survey.tsv into LimeSurvey and verify group/page structure."""
    tsv_path = generated_files_dir / "multipage_survey.tsv"
    if not tsv_path.exists():
        pytest.skip("multipage_survey.tsv not found")

    survey_id = import_survey_from_tsv(limesurvey_client, tsv_path, "Multi-Page Survey Test")

    try:
        verify_survey_import(limesurvey_client, survey_id)

        verify_group_exists(limesurvey_client, survey_id, ["Page One", "Page Two"])
        verify_question_exists(limesurvey_client, survey_id, ["name", "age", "favcolor", "thankyou"])

        stats = get_survey_structure_stats(limesurvey_client, survey_id)
        assert stats["groups"] == 2, f"Expected 2 groups, got {stats['groups']}"

        print(f"\n✓ Multi-page survey imported successfully (ID: {survey_id})")
        print(f"  - Groups (pages): {stats['groups']}")
        print(f"  - Questions: {stats['questions']}")
    finally:
        cleanup_survey(limesurvey_client, survey_id)
