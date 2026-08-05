"""
Survey structure tests for xlsform2lstsv-generated TSV files.
Tests groups, questions, subquestions, and answer structure validation.
"""

from pathlib import Path

import pytest
from citric import Client
from test_helpers import (
    cleanup_survey,
    get_survey_logic_summary,
    get_survey_structure_stats,
    import_survey_from_tsv,
    verify_group_exists,
    verify_question_exists,
    verify_survey_import,
)


def test_complex_survey_import(limesurvey_client: Client, generated_files_dir: Path):
    """Test import of complex_survey.tsv with groups and logic"""
    tsv_path = generated_files_dir / "complex_survey.tsv"

    if not tsv_path.exists():
        pytest.skip(f"TSV file not found: {tsv_path}")

    # Import the survey
    survey_id = import_survey_from_tsv(limesurvey_client, tsv_path, "Complex Survey Test")

    try:
        # Verify survey properties with questions and choices
        verify_survey_import(limesurvey_client, survey_id, expected_choice_count=9)

        # Check groups
        verify_group_exists(limesurvey_client, survey_id, ["demographics", "preferences"])

        # Check questions
        verify_question_exists(
            limesurvey_client, survey_id, ["fullname", "age", "gender", "favoritecolors", "satisfactionlevel"]
        )

        # Get detailed survey statistics
        stats = get_survey_structure_stats(limesurvey_client, survey_id)

        # Validate counts based on survey structure
        assert stats["groups"] == 3, f"Expected 3 question groups, got {stats['groups']}"
        assert stats["questions"] == 7, f"Expected 7 parent questions, got {stats['questions']}"
        assert stats["subquestions"] == 4, f"Expected 4 subquestions, got {stats['subquestions']}"
        assert stats["answers"] == 5, f"Expected 5 answer options (3 gender + 2 satisfaction), got {stats['answers']}"

        print("\n✓ Complex survey imported successfully")
        print(f"  - Question groups: {stats['groups']}")
        print(f"  - Questions: {stats['questions']}")
        print(f"  - Subquestions: {stats['subquestions']}")
        print(f"  - Answers: {stats['answers']}")
        print("  - Choices: 9")

        # Verify relevance/conditions (if supported by citric)
        # Note: This may need to be checked differently depending on citric's API

        # Test mandatory field handling
        logic_summary = get_survey_logic_summary(limesurvey_client, survey_id)
        print("\n✓ Logic summary:")
        print(f"  - Questions with logic: {logic_summary['questions_with_logic']}")
        print(f"  - Questions with relevance: {logic_summary['questions_with_relevance']}")
        print(f"  - Questions with validation: {logic_summary['questions_with_validation']}")
        print(f"  - Mandatory questions: {logic_summary['questions_mandatory']}")

        # Based on the complex_survey.json fixture, we expect 1 mandatory question (full_name)
        expected_mandatory_count = 1
        assert logic_summary["questions_mandatory"] == expected_mandatory_count, (
            f"Expected {expected_mandatory_count} mandatory questions, got {logic_summary['questions_mandatory']}"
        )

    finally:
        # Cleanup
        cleanup_survey(limesurvey_client, survey_id)


def test_basic_survey_mandatory_fields(limesurvey_client: Client, generated_files_dir: Path):
    """Test mandatory field handling in basic_survey.tsv"""
    tsv_path = generated_files_dir / "basic_survey.tsv"

    if not tsv_path.exists():
        pytest.skip(f"TSV file not found: {tsv_path}")

    # Import the survey
    survey_id = import_survey_from_tsv(limesurvey_client, tsv_path, "Basic Survey Mandatory Test")

    try:
        # Verify survey properties
        verify_survey_import(limesurvey_client, survey_id, expected_question_count=4, expected_choice_count=2)

        # Test mandatory field handling
        logic_summary = get_survey_logic_summary(limesurvey_client, survey_id)
        print("\n✓ Basic survey logic summary:")
        print(f"  - Questions with logic: {logic_summary['questions_with_logic']}")
        print(f"  - Questions with relevance: {logic_summary['questions_with_relevance']}")
        print(f"  - Questions with validation: {logic_summary['questions_with_validation']}")
        print(f"  - Mandatory questions: {logic_summary['questions_mandatory']}")

        # Based on the basic_survey.json fixture, we expect 3 mandatory questions:
        # respondent_name (required), age (required), consent (required)
        # Note: thank_you is a note and cannot be mandatory
        expected_mandatory_count = 3
        assert logic_summary["questions_mandatory"] == expected_mandatory_count, (
            f"Expected {expected_mandatory_count} mandatory questions, got {logic_summary['questions_mandatory']}"
        )

        # Verify that the mandatory questions are correctly identified
        mandatory_questions = [q for q in logic_summary["logic_details"] if q.get("mandatory")]
        assert len(mandatory_questions) == expected_mandatory_count

        print(f"✓ Successfully validated {expected_mandatory_count} mandatory questions")

    finally:
        # Cleanup
        cleanup_survey(limesurvey_client, survey_id)
