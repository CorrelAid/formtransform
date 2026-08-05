"""
Basic functionality tests for xlsform2lstsv-generated TSV files.
Tests file generation and basic import capabilities.
"""

from pathlib import Path

import pytest
from citric import Client
from test_helpers import (
    cleanup_survey,
    count_mandatory_fields_in_tsv,
    get_tsv_files,
    import_survey_from_tsv,
    verify_question_exists,
    verify_survey_import,
)


def test_generated_files_exist(generated_files_dir: Path):
    """Verify that TSV files were generated from fixtures."""
    tsv_files = get_tsv_files(generated_files_dir)
    assert len(tsv_files) > 0, f"No TSV files found in {generated_files_dir}"
    print(f"\nFound {len(tsv_files)} generated TSV files:")
    for f in tsv_files:
        print(f"  - {f.name}")


def test_basic_survey_import(limesurvey_client: Client, generated_files_dir: Path):
    """Test import of basic_survey.tsv"""
    tsv_path = generated_files_dir / "basic_survey.tsv"

    if not tsv_path.exists():
        pytest.skip(f"TSV file not found: {tsv_path}")

    # Import the survey
    survey_id = import_survey_from_tsv(limesurvey_client, tsv_path, "Basic Survey Test")

    try:
        # Verify the survey was imported with questions and choices
        verify_survey_import(limesurvey_client, survey_id, expected_question_count=4, expected_choice_count=2)

        # Check questions
        verify_question_exists(limesurvey_client, survey_id, ["respondentname", "age", "consent"])

        print("\n✓ Basic survey imported successfully")
        print("  - Questions: 4")
        print("  - Choices: 2")

    finally:
        # Cleanup
        cleanup_survey(limesurvey_client, survey_id)


def test_mandatory_fields_in_generated_tsv(generated_files_dir: Path):
    """Test that mandatory fields are correctly set in generated TSV files"""

    # Test basic survey - should have 3 mandatory questions
    basic_tsv = generated_files_dir / "basic_survey.tsv"
    if basic_tsv.exists():
        mandatory_count = count_mandatory_fields_in_tsv(basic_tsv)
        expected_count = 3  # respondent_name, age, consent
        assert mandatory_count == expected_count, (
            f"Expected {expected_count} mandatory questions in basic_survey.tsv, got {mandatory_count}"
        )
        print(f"✓ basic_survey.tsv: {mandatory_count} mandatory questions (expected {expected_count})")

    # Test complex survey - should have 1 mandatory question
    complex_tsv = generated_files_dir / "complex_survey.tsv"
    if complex_tsv.exists():
        mandatory_count = count_mandatory_fields_in_tsv(complex_tsv)
        expected_count = 1  # full_name only
        assert mandatory_count == expected_count, (
            f"Expected {expected_count} mandatory questions in complex_survey.tsv, got {mandatory_count}"
        )
        print(f"✓ complex_survey.tsv: {mandatory_count} mandatory questions (expected {expected_count})")

    print("✓ Mandatory field handling validated successfully")


def test_xpath_survey_import(limesurvey_client: Client, generated_files_dir: Path):
    """Test import of complex_xpath_survey.tsv with relevance expressions"""
    tsv_path = generated_files_dir / "complex_xpath_survey.tsv"

    if not tsv_path.exists():
        pytest.skip(f"TSV file not found: {tsv_path}")

    # Import the survey
    survey_id = import_survey_from_tsv(limesurvey_client, tsv_path, "XPath Survey Test")

    try:
        # Verify the survey was imported
        verify_survey_import(limesurvey_client, survey_id)

        # Check that questions with relevance expressions were imported
        verify_question_exists(limesurvey_client, survey_id, ["consent", "age", "country"])

        print("\n✓ XPath survey imported successfully")
        print("  - Survey with relevance expressions imported")

    finally:
        # Cleanup
        cleanup_survey(limesurvey_client, survey_id)


def test_validation_relevance_survey_import(limesurvey_client: Client, generated_files_dir: Path):
    """Test import of validation_relevance_survey.tsv with comprehensive validation and relevance"""
    tsv_path = generated_files_dir / "validation_relevance_survey.tsv"

    if not tsv_path.exists():
        pytest.skip(f"TSV file not found: {tsv_path}")

    # Import the survey
    survey_id = import_survey_from_tsv(limesurvey_client, tsv_path, "Validation Relevance Test")

    try:
        # Verify the survey was imported
        verify_survey_import(limesurvey_client, survey_id)

        # Check that questions with validation and relevance were imported
        # Note: Field names are sanitized (underscores removed)
        verify_question_exists(
            limesurvey_client, survey_id, ["username", "age", "consent", "adultinfo", "complexrelevance"]
        )

        print("\n✓ Validation/Relevance survey imported successfully")
        print("  - Survey with comprehensive validation and relevance imported")

    finally:
        # Cleanup
        cleanup_survey(limesurvey_client, survey_id)
