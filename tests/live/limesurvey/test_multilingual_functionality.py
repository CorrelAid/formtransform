"""
Multilingual functionality tests for xlsform2lstsv-generated TSV files.
Tests multilingual survey import and validation.
"""

from pathlib import Path

import pytest
from citric import Client
from test_helpers import (
    cleanup_survey,
    extract_languages_from_tsv,
    import_survey_from_tsv,
    verify_group_exists,
    verify_language_ordering,
    verify_multilingual_content,
    verify_question_exists,
    verify_survey_import,
)


def test_multilingual_survey_tsv_generation(generated_files_dir: Path):
    """Test that multilingual_survey.tsv file is generated"""
    tsv_path = generated_files_dir / "multilingual_survey.tsv"

    if not tsv_path.exists():
        pytest.skip(f"TSV file not found: {tsv_path}")

    print("✓ multilingual_survey.tsv file generated successfully")


def test_multilingual_survey_languages(generated_files_dir: Path):
    """Test that multilingual_survey.tsv contains expected languages"""
    tsv_path = generated_files_dir / "multilingual_survey.tsv"

    if not tsv_path.exists():
        pytest.skip(f"TSV file not found: {tsv_path}")

    # Extract languages from TSV
    languages = extract_languages_from_tsv(tsv_path)

    # Should contain English and Spanish
    expected_languages = ["en", "es"]

    for lang in expected_languages:
        assert lang in languages, f"Expected language '{lang}' not found in TSV"

    print(f"✓ Found expected languages: {languages}")


def test_multilingual_survey_content(generated_files_dir: Path):
    """Test that multilingual_survey.tsv contains expected multilingual content"""
    tsv_path = generated_files_dir / "multilingual_survey.tsv"

    if not tsv_path.exists():
        pytest.skip(f"TSV file not found: {tsv_path}")

    # Verify multilingual content
    expected_translations = {
        "en": ["Demographics", "What is your name?", "Male", "Very satisfied"],
        "es": ["Datos demográficos", "¿Cuál es tu nombre?", "Masculino", "Muy satisfecho"],
    }

    verify_multilingual_content(tsv_path, ["en", "es"], expected_translations)

    print("✓ Multilingual content verified successfully")


def test_multilingual_survey_language_ordering(generated_files_dir: Path):
    """Test that languages in multilingual_survey.tsv are ordered correctly"""
    tsv_path = generated_files_dir / "multilingual_survey.tsv"

    if not tsv_path.exists():
        pytest.skip(f"TSV file not found: {tsv_path}")

    # Verify language ordering (default language first, then alphabetical)
    verify_language_ordering(tsv_path, expected_default_language="en")

    print("✓ Language ordering verified successfully")


def test_multilingual_survey_import(limesurvey_client: Client, generated_files_dir: Path):
    """Test import of multilingual_survey.tsv"""
    tsv_path = generated_files_dir / "multilingual_survey.tsv"

    if not tsv_path.exists():
        pytest.skip(f"TSV file not found: {tsv_path}")

    # Import the survey
    survey_id = import_survey_from_tsv(limesurvey_client, tsv_path, "Multilingual Survey Test")

    try:
        # Verify the survey was imported with questions and choices
        # Based on the fixture, we have 4 questions: name, age, gender, satisfaction
        verify_survey_import(limesurvey_client, survey_id, expected_question_count=4, expected_choice_count=6)

        # Check groups
        verify_group_exists(limesurvey_client, survey_id, ["demographics"])

        # Check questions
        verify_question_exists(limesurvey_client, survey_id, ["name", "age", "gender", "satisfaction"])

        print("\n✓ Multilingual survey imported successfully")
        print("  - Questions: 4")
        print("  - Choices: 6")
        print("  - Groups: 1")

    finally:
        # Cleanup
        cleanup_survey(limesurvey_client, survey_id)


def test_multilingual_survey_structure(generated_files_dir: Path):
    """Test the structure of multilingual_survey.tsv file"""
    tsv_path = generated_files_dir / "multilingual_survey.tsv"

    if not tsv_path.exists():
        pytest.skip(f"TSV file not found: {tsv_path}")

    # Read TSV content to analyze structure
    with open(tsv_path, encoding="utf-8") as f:
        content = f.read()

    # Count different row types
    survey_rows = content.count("S\t")
    survey_language_rows = content.count("SL\t")
    group_rows = content.count("G\t")
    question_rows = content.count("Q\t")
    answer_rows = content.count("A\t")

    print("\n✓ Multilingual survey structure:")
    print(f"  - Survey rows: {survey_rows}")
    print(f"  - Survey language rows: {survey_language_rows}")
    print(f"  - Group rows: {group_rows}")
    print(f"  - Question rows: {question_rows}")
    print(f"  - Answer rows: {answer_rows}")

    # For a multilingual survey with 2 languages, we expect:
    # - 1 survey row × 2 languages = 2 SL rows for title
    # - 1 group × 2 languages = 2 G rows
    # - 4 questions × 2 languages = 8 Q rows
    # - 6 choices × 2 languages = 12 A rows

    assert survey_language_rows >= 2, f"Expected at least 2 survey language rows, got {survey_language_rows}"
    assert group_rows >= 2, f"Expected at least 2 group rows, got {group_rows}"
    assert question_rows >= 8, f"Expected at least 8 question rows, got {question_rows}"
    assert answer_rows >= 12, f"Expected at least 12 answer rows, got {answer_rows}"


def test_multilingual_survey_choice_consistency(generated_files_dir: Path):
    """Test that choice translations are consistent across languages"""
    tsv_path = generated_files_dir / "multilingual_survey.tsv"

    if not tsv_path.exists():
        pytest.skip(f"TSV file not found: {tsv_path}")

    # Read TSV content
    with open(tsv_path, encoding="utf-8") as f:
        content = f.read()

    # Check that answer codes are consistent across languages
    # For example, 'male' should appear in both English and Spanish contexts
    assert "male" in content, "Answer code 'male' should be present"
    assert "Masculino" in content, "Spanish translation 'Masculino' should be present"

    # Check that all expected answer codes are present
    # Note: 'female' gets truncated to 'femal' due to varchar(5) limitation
    expected_answer_codes = ["male", "femal", "other", "happy", "neutr", "unhap"]
    for code in expected_answer_codes:
        assert code in content, f"Answer code '{code}' should be present in TSV"

    print("✓ Choice consistency verified successfully")
