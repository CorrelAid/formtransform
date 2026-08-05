"""
Shared test helpers for the live-LimeSurvey suite.
Contains common fixtures, utilities, and validation functions.

Stack lifecycle (compose file, base URL, credentials, import+activate) lives in
`codegen.limesurvey_stack`, shared with `codegen --screenshots`.
"""

from collections.abc import Generator
from pathlib import Path
from typing import Any

import pytest
from citric import Client

from codegen import limesurvey_stack as ls_stack

# =========================
# COMMON FIXTURES
# =========================


@pytest.fixture(scope="module")
def limesurvey_url() -> str:
    """RemoteControl endpoint of the shared stack (expects it to be running)."""
    return ls_stack.RPC_URL


@pytest.fixture(scope="module")
def limesurvey_client() -> Generator[Client, None, None]:
    """Authenticated LimeSurvey client, once the shared stack answers."""
    ls_stack.wait_until_ready(timeout=120)
    yield ls_stack.client()


@pytest.fixture(scope="module")
def generated_files_dir() -> Path:
    """Directory containing generated TSV files."""
    return Path(__file__).parent / "output"


# =========================
# SURVEY IMPORT UTILITIES
# =========================


def import_survey_from_tsv(limesurvey_client: Client, tsv_path: Path, survey_name: str = "Test Survey") -> int:
    """
    Import a survey from TSV file and return the survey ID.

    Args:
        limesurvey_client: Authenticated citric client
        tsv_path: Path to TSV file
        survey_name: Name for the imported survey

    Returns:
        Survey ID of the imported survey

    Raises:
        Exception: If import fails
    """
    if not tsv_path.exists():
        raise FileNotFoundError(f"TSV file not found: {tsv_path}")

    with open(tsv_path, "rb") as f:
        survey_id = limesurvey_client.import_survey(
            f,
            file_type="txt",  # TSV format
            survey_name=survey_name,
        )

    if survey_id <= 0:
        raise Exception(f"Survey import failed, got invalid survey ID: {survey_id}")

    return survey_id


def verify_survey_import(
    limesurvey_client: Client,
    survey_id: int,
    expected_question_count: int | None = None,
    expected_group_count: int | None = None,
    expected_choice_count: int | None = None,
) -> dict[str, Any]:
    """
    Verify that a survey was imported successfully.

    Args:
        limesurvey_client: Authenticated citric client
        survey_id: Survey ID to verify
        expected_question_count: Expected number of questions (optional)
        expected_group_count: Expected number of groups (optional)
        expected_choice_count: Expected number of choices/answer options (optional)

    Returns:
        Dictionary with verification results

    Raises:
        AssertionError: If verification fails
    """
    # Verify survey properties
    properties = limesurvey_client.get_survey_properties(survey_id)
    assert properties is not None, "Survey properties should not be None"
    assert properties.get("sid") == survey_id or properties.get("surveyls_survey_id") == survey_id, "Survey ID mismatch"

    # Get questions and groups
    questions = limesurvey_client.list_questions(survey_id)
    groups = limesurvey_client.list_groups(survey_id)

    # Validate counts if provided
    if expected_question_count is not None:
        assert len(questions) == expected_question_count, (
            f"Expected {expected_question_count} questions, got {len(questions)}"
        )

    if expected_group_count is not None:
        assert len(groups) == expected_group_count, f"Expected {expected_group_count} groups, got {len(groups)}"

    # Validate choice count if provided
    if expected_choice_count is not None:
        actual_choice_count = get_imported_choice_count(limesurvey_client, survey_id)
        assert actual_choice_count == expected_choice_count, (
            f"Expected {expected_choice_count} choices, got {actual_choice_count}"
        )

    return {
        "survey_id": survey_id,
        "question_count": len(questions),
        "group_count": len(groups),
        "choice_count": get_imported_choice_count(limesurvey_client, survey_id),
        "properties": properties,
    }


def cleanup_survey(limesurvey_client: Client, survey_id: int) -> None:
    """
    Clean up a survey by deleting it.

    Args:
        limesurvey_client: Authenticated citric client
        survey_id: Survey ID to delete
    """
    try:
        limesurvey_client.delete_survey(survey_id)
    except Exception as e:
        print(f"Warning: Could not delete survey {survey_id}: {e}")


# =========================
# TSV CONTENT ANALYSIS
# =========================


def parse_tsv_choices(tsv_path: Path) -> dict[str, int]:
    """
    Parse a TSV file and count expected choices/answer options for each question.

    For multilingual surveys, counts unique answer codes per question rather than
    all answer rows, since LimeSurvey treats translations as the same choice.

    Args:
        tsv_path: Path to TSV file

    Returns:
        Dictionary mapping question names to expected choice counts
    """
    content = read_tsv_content(tsv_path)

    choices_by_question = {}
    current_question = None

    # Check if this is a multilingual survey
    is_multilingual = False
    languages = set()

    for line in content.split("\n"):
        if (line.startswith("S") or line.startswith("SL")) and len(line.split("\t")) >= 7:
            parts = line.split("\t")
            lang_code = parts[6].strip()  # language column is at index 6
            if len(lang_code) == 2:
                languages.add(lang_code)
                if len(languages) > 1:
                    is_multilingual = True
                    break

    # Track unique answer codes for multilingual surveys
    answer_codes_by_question = {}

    for line in content.split("\n"):
        if not line.strip():
            continue

        parts = line.split("\t")
        if len(parts) < 3:
            continue

        row_class = parts[0]
        parts[1] if len(parts) > 1 else ""
        row_name = parts[2] if len(parts) > 2 else ""

        if row_class == "Q":
            # This is a question - start tracking choices for it
            current_question = row_name
            choices_by_question[current_question] = 0
            answer_codes_by_question[current_question] = set()

        elif row_class == "A" and current_question:
            if is_multilingual:
                # For multilingual surveys, count unique answer codes
                answer_code = row_name
                if answer_code not in answer_codes_by_question[current_question]:
                    answer_codes_by_question[current_question].add(answer_code)
                    choices_by_question[current_question] += 1
            else:
                # For single-language surveys, count all answer rows
                choices_by_question[current_question] += 1

        elif row_class == "SQ" and current_question:
            # This is a subquestion - count as a choice for multiple-choice questions
            # Subquestions are not typically translated, so count them normally
            choices_by_question[current_question] += 1

    return choices_by_question


def get_expected_choice_count_from_tsv(tsv_path: Path) -> int:
    """
    Get the total expected number of choices/answer options from a TSV file.

    Args:
        tsv_path: Path to TSV file

    Returns:
        Total count of expected choices/answer options
    """
    choices_by_question = parse_tsv_choices(tsv_path)
    return sum(choices_by_question.values())


# =========================
# SURVEY STRUCTURE VALIDATION
# =========================


def get_survey_structure_stats(limesurvey_client: Client, survey_id: int) -> dict[str, int]:
    """
    Get detailed statistics about survey structure.

    Args:
        limesurvey_client: Authenticated citric client
        survey_id: Survey ID to analyze

    Returns:
        Dictionary with structure statistics
    """
    questions = limesurvey_client.list_questions(survey_id)
    groups = limesurvey_client.list_groups(survey_id)

    parent_questions = []
    subquestions = []
    answer_count = 0

    for question in questions:
        parent_qid = question.get("parent_qid") if isinstance(question, dict) else getattr(question, "parent_qid", 0)
        qid = question.get("qid") if isinstance(question, dict) else question.qid

        # If parent_qid is 0 or None, it's a parent question
        if not parent_qid or parent_qid == 0 or parent_qid == "0":
            parent_questions.append(question)

            # Count answer options for parent questions only
            try:
                props = limesurvey_client.get_question_properties(qid)

                # Check if question has answer options
                if props.get("answeroptions"):
                    # Filter out default/empty answer options
                    valid_answers = {
                        k: v for k, v in props["answeroptions"].items() if isinstance(v, dict) and v.get("answer")
                    }
                    answer_count += len(valid_answers)
            except Exception:
                pass
        else:
            subquestions.append(question)

    return {
        "groups": len(groups),
        "questions": len(parent_questions),
        "total_questions": len(questions),
        "subquestions": len(subquestions),
        "answers": answer_count,
    }


def get_imported_choice_count(limesurvey_client: Client, survey_id: int) -> int:
    """
    Get the total number of choices/answer options from an imported survey.

    Args:
        limesurvey_client: Authenticated citric client
        survey_id: Survey ID to analyze

    Returns:
        Total count of imported choices/answer options
    """
    questions = limesurvey_client.list_questions(survey_id)
    total_choices = 0

    for question in questions:
        qid = question.get("qid") if isinstance(question, dict) else question.qid
        parent_qid = question.get("parent_qid") if isinstance(question, dict) else getattr(question, "parent_qid", 0)

        # Only count choices for parent questions (not subquestions)
        if parent_qid and parent_qid != 0 and parent_qid != "0":
            continue

        try:
            props = limesurvey_client.get_question_properties(qid)

            # Count subquestions as choices for multiple-choice questions
            # We can count subquestions by looking at all questions with this question as parent
            subquestions = [
                q
                for q in questions
                if (q.get("parent_qid") if isinstance(q, dict) else getattr(q, "parent_qid", 0)) == qid
            ]

            if subquestions:
                # If this question has subquestions, count them as choices
                # Don't count available_answers for these questions to avoid double-counting
                total_choices += len(subquestions)
            else:
                # For questions without subquestions, check both available_answers and answeroptions
                counted_choices = False

                # First try available_answers field
                if props.get("available_answers"):
                    available_answers = props["available_answers"]

                    # Skip "No available answers" message
                    if available_answers == "No available answers":
                        pass  # Try answeroptions as fallback
                    else:
                        # available_answers can be a string with answer codes or a dict with answer mappings
                        if isinstance(available_answers, str) and available_answers.strip():
                            # Count non-empty answer codes
                            answer_codes = available_answers.strip().split()
                            valid_codes = [code for code in answer_codes if code and code != "0"]
                            total_choices += len(valid_codes)
                            counted_choices = True
                        elif isinstance(available_answers, dict):
                            # For dict format, count the keys that are not empty
                            valid_codes = [code for code in available_answers if code and code != "0"]
                            total_choices += len(valid_codes)
                            counted_choices = True
                        elif isinstance(available_answers, list):
                            # Some API versions return lists
                            valid_codes = [code for code in available_answers if code and code != "0"]
                            total_choices += len(valid_codes)
                            counted_choices = True

                # If available_answers didn't work, try answeroptions as fallback
                if not counted_choices and "answeroptions" in props and props["answeroptions"]:
                    answeroptions = props["answeroptions"]

                    # Skip "No available answers" message
                    if answeroptions == "No available answers":
                        continue

                    # answeroptions can be a dict or list
                    if isinstance(answeroptions, dict):
                        # Count valid answer options (those with 'answer' field)
                        valid_answers = {
                            k: v for k, v in answeroptions.items() if isinstance(v, dict) and v.get("answer")
                        }
                        total_choices += len(valid_answers)
                    elif isinstance(answeroptions, list):
                        # Some API versions return lists
                        valid_answers = [
                            item for item in answeroptions if isinstance(item, dict) and item.get("answer")
                        ]
                        total_choices += len(valid_answers)

        except Exception as e:
            print(f"Error counting choices for question {qid}: {e}")
            continue

    return total_choices


def verify_question_exists(limesurvey_client: Client, survey_id: int, expected_question_names: list[str]) -> None:
    """
    Verify that expected questions exist in a survey.

    Args:
        limesurvey_client: Authenticated citric client
        survey_id: Survey ID to check
        expected_question_names: List of question names that should exist

    Raises:
        AssertionError: If any expected question is not found
    """
    questions = limesurvey_client.list_questions(survey_id)
    question_names = [q.get("title") if isinstance(q, dict) else q.title for q in questions]

    missing_questions = []
    for expected_name in expected_question_names:
        if expected_name not in question_names:
            missing_questions.append(expected_name)

    if missing_questions:
        raise AssertionError(f"Missing questions: {missing_questions}. Available: {question_names}")


def verify_group_exists(limesurvey_client: Client, survey_id: int, expected_group_names: list[str]) -> None:
    """
    Verify that expected groups exist in a survey.

    Args:
        limesurvey_client: Authenticated citric client
        survey_id: Survey ID to check
        expected_group_names: List of group names that should exist

    Raises:
        AssertionError: If any expected group is not found
    """
    groups = limesurvey_client.list_groups(survey_id)
    group_names = [g.get("group_name") if isinstance(g, dict) else g.group_name for g in groups]

    missing_groups = []
    for expected_name in expected_group_names:
        if expected_name.lower() not in [g.lower() for g in group_names]:
            missing_groups.append(expected_name)

    if missing_groups:
        raise AssertionError(f"Missing groups: {missing_groups}. Available: {group_names}")


# =========================
# TSV FILE UTILITIES
# =========================


def get_tsv_files(generated_files_dir: Path) -> list[Path]:
    """
    Get list of TSV files in the generated files directory.

    Args:
        generated_files_dir: Directory containing TSV files

    Returns:
        List of Path objects for TSV files
    """
    return list(generated_files_dir.glob("*.tsv"))


def verify_tsv_file_exists(tsv_path: Path) -> None:
    """
    Verify that a TSV file exists.

    Args:
        tsv_path: Path to TSV file

    Raises:
        FileNotFoundError: If file doesn't exist
    """
    if not tsv_path.exists():
        raise FileNotFoundError(f"TSV file not found: {tsv_path}")


def read_tsv_content(tsv_path: Path) -> str:
    """
    Read content of a TSV file.

    Args:
        tsv_path: Path to TSV file

    Returns:
        Content of the TSV file as string
    """
    with open(tsv_path, encoding="utf-8") as f:
        return f.read()


def verify_tsv_contains_text(tsv_path: Path, expected_texts: list[str]) -> None:
    """
    Verify that TSV file contains expected text strings.

    Args:
        tsv_path: Path to TSV file
        expected_texts: List of text strings that should be present

    Raises:
        AssertionError: If any expected text is not found
    """
    content = read_tsv_content(tsv_path)

    missing_texts = []
    for text in expected_texts:
        if text not in content:
            missing_texts.append(text)

    if missing_texts:
        raise AssertionError(f"TSV file missing expected texts: {missing_texts}")


def verify_tsv_does_not_contain_text(tsv_path: Path, forbidden_texts: list[str]) -> None:
    """
    Verify that TSV file does not contain forbidden text strings.

    Args:
        tsv_path: Path to TSV file
        forbidden_texts: List of text strings that should NOT be present

    Raises:
        AssertionError: If any forbidden text is found
    """
    content = read_tsv_content(tsv_path)

    found_texts = []
    for text in forbidden_texts:
        if text in content:
            found_texts.append(text)

    if found_texts:
        raise AssertionError(f"TSV file contains forbidden texts: {found_texts}")


# =========================
# MULTILINGUAL UTILITIES
# =========================


def extract_languages_from_tsv(tsv_path: Path) -> list[str]:
    """
    Extract unique language codes from a TSV file.

    Args:
        tsv_path: Path to TSV file

    Returns:
        List of unique language codes found in the TSV
    """
    content = read_tsv_content(tsv_path)

    languages = set()
    for line in content.split("\n"):
        if line.startswith("SL"):  # Survey Language settings
            parts = line.split("\t")
            if len(parts) >= 3:
                # SL rows have format: SL\tsurveyls_title\t1\tTitle\t\tlanguage_code
                # The language code is in the last column
                lang_code = parts[-1].strip()
                if lang_code and len(lang_code) == 2:
                    languages.add(lang_code)
        elif line.startswith("Q"):  # Question rows also have language info
            parts = line.split("\t")
            if len(parts) >= 7:  # language column is typically around index 6
                lang_code = parts[6].strip()  # language column
                if lang_code and len(lang_code) == 2:
                    languages.add(lang_code)

    return sorted(list(languages))


def verify_multilingual_content(
    tsv_path: Path, expected_languages: list[str], expected_translations: dict[str, list[str]]
) -> None:
    """
    Verify that TSV file contains expected multilingual content.

    Args:
        tsv_path: Path to TSV file
        expected_languages: List of expected language codes
        expected_translations: Dictionary mapping language codes to expected text strings

    Raises:
        AssertionError: If expected content is not found
    """
    content = read_tsv_content(tsv_path)

    # Verify languages are present
    for lang in expected_languages:
        assert lang in content, f"Should contain language code '{lang}'"

    # Verify translations are present
    for lang, texts in expected_translations.items():
        for text in texts:
            assert text in content, f"Should contain {lang} translation: '{text}'"


def verify_language_ordering(tsv_path: Path, expected_default_language: str = "en") -> None:
    """
    Verify that languages in TSV are ordered correctly (default first, then alphabetical).

    Args:
        tsv_path: Path to TSV file
        expected_default_language: Expected default language code

    Raises:
        AssertionError: If language ordering is incorrect
    """
    content = read_tsv_content(tsv_path)

    # Extract all SL (Survey Language) rows
    sl_rows = []
    for line in content.split("\n"):
        if line.startswith("SL"):
            parts = line.split("\t")
            if len(parts) >= 7:  # Ensure we have enough columns
                sl_rows.append({"class": parts[0], "name": parts[2], "language": parts[6].strip()})

    # Extract unique languages in order of appearance
    languages_in_order = []
    for row in sl_rows:
        lang = row["language"]
        if lang and len(lang) == 2 and lang not in languages_in_order:
            languages_in_order.append(lang)

    # The default language should be first
    assert languages_in_order[0] == expected_default_language, (
        f"Default language '{expected_default_language}' should appear first"
    )

    # Remaining languages should be in alphabetical order
    remaining_languages = languages_in_order[1:]
    is_alphabetical = all(
        remaining_languages[i] <= remaining_languages[i + 1] for i in range(len(remaining_languages) - 1)
    )

    assert is_alphabetical, f"Remaining languages should be alphabetical: {remaining_languages}"


# =========================
# SURVEY VALIDATION UTILITIES
# =========================


def validate_survey_activation(limesurvey_client: Client, survey_id: int) -> bool:
    """
    Attempt to activate a survey and return success status.

    Args:
        limesurvey_client: Authenticated citric client
        survey_id: Survey ID to activate

    Returns:
        True if activation succeeded, False otherwise
    """
    try:
        limesurvey_client.activate_survey(survey_id)

        # Get activation status
        properties = limesurvey_client.get_survey_properties(survey_id, ["active"])
        is_active = properties.get("active") in ["Y", True, 1]

        return is_active

    except Exception as e:
        print(f"Survey activation failed: {e}")
        return False


def get_survey_logic_summary(limesurvey_client: Client, survey_id: int) -> dict[str, Any]:
    """
    Get a summary of survey logic (relevance, validation, mandatory fields).

    Args:
        limesurvey_client: Authenticated citric client
        survey_id: Survey ID to analyze

    Returns:
        Dictionary with logic summary
    """
    questions = limesurvey_client.list_questions(survey_id)

    logic_summary = {
        "questions_with_logic": 0,
        "questions_with_relevance": 0,
        "questions_with_validation": 0,
        "questions_mandatory": 0,
        "logic_details": [],
    }

    for question in questions:
        qid = question.get("qid") if isinstance(question, dict) else question.qid
        title = question.get("title") if isinstance(question, dict) else question.title

        try:
            props = limesurvey_client.get_question_properties(qid)

            has_logic = False
            logic_info = {"question": title, "qid": qid}

            # Check for relevance
            if props.get("relevance") and props["relevance"] not in ["1", ""]:
                logic_info["relevance"] = props["relevance"]
                logic_summary["questions_with_relevance"] += 1
                has_logic = True

            # Check for validation
            if props.get("preg"):
                logic_info["validation"] = props["preg"]
                logic_summary["questions_with_validation"] += 1
                has_logic = True

            # Check if mandatory
            if props.get("mandatory") == "Y":
                logic_info["mandatory"] = True
                logic_summary["questions_mandatory"] += 1
                has_logic = True

            if has_logic:
                logic_summary["questions_with_logic"] += 1
                logic_summary["logic_details"].append(logic_info)

        except Exception:
            continue

    return logic_summary


# =========================
# BATCH IMPORT UTILITIES
# =========================


def import_all_surveys_from_directory(
    limesurvey_client: Client, generated_files_dir: Path
) -> tuple[list[str], list[tuple[str, str]]]:
    """
    Import all TSV files from a directory and return results.

    Args:
        limesurvey_client: Authenticated citric client
        generated_files_dir: Directory containing TSV files

    Returns:
        Tuple of (successful_imports, failed_imports) where:
        - successful_imports: List of successfully imported filenames
        - failed_imports: List of tuples (filename, error_message) for failed imports
    """
    tsv_files = get_tsv_files(generated_files_dir)

    if not tsv_files:
        return [], []

    imported_successfully = []
    failed_imports = []

    for tsv_path in tsv_files:
        try:
            survey_id = import_survey_from_tsv(limesurvey_client, tsv_path, f"Test - {tsv_path.stem}")

            # Get expected choice count from TSV file
            expected_choice_count = get_expected_choice_count_from_tsv(tsv_path)

            # Quick verification with choice validation
            verify_survey_import(limesurvey_client, survey_id, expected_choice_count=expected_choice_count)

            # Cleanup
            cleanup_survey(limesurvey_client, survey_id)

            imported_successfully.append(tsv_path.name)

        except Exception as e:
            failed_imports.append((tsv_path.name, str(e)))

    return imported_successfully, failed_imports


def count_mandatory_fields_in_tsv(tsv_path: Path) -> int:
    """
    Count mandatory fields in a TSV file by parsing the mandatory column.

    Args:
        tsv_path: Path to TSV file

    Returns:
        Number of questions with mandatory='Y'
    """
    if not tsv_path.exists():
        return 0

    mandatory_count = 0

    with open(tsv_path, encoding="utf-8") as f:
        lines = f.readlines()

        # Find the header line to get column indices
        header_line = None
        for line in lines:
            if line.startswith("class"):
                header_line = line
                break

        if not header_line:
            return 0

        # Parse header to find mandatory column index
        headers = header_line.strip().split("\t")
        try:
            mandatory_index = headers.index("mandatory")
        except ValueError:
            return 0

        # Count lines where mandatory='Y' and class='Q' (questions)
        for line in lines:
            if line.startswith("Q\t"):  # Question lines
                parts = line.strip().split("\t")
                if len(parts) > mandatory_index and parts[mandatory_index] == "Y":
                    mandatory_count += 1

    return mandatory_count
