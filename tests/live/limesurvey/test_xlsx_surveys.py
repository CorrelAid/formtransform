"""
Integration tests for XLSX-based survey fixtures.
Tests TSV generation from real-world XLSX files and validates structure.
"""

from pathlib import Path

import pytest
from citric import Client
from test_helpers import (
    cleanup_survey,
    extract_languages_from_tsv,
    import_survey_from_tsv,
    read_tsv_content,
    verify_group_exists,
    verify_survey_import,
)

# ===========================
# testA.xlsx TSV tests
# ===========================


def test_testA_tsv_not_generated(generated_files_dir: Path):
    """Verify that testA.tsv was NOT generated (contains unimplemented 'range' type)."""
    tsv_path = generated_files_dir / "testA.tsv"
    assert not tsv_path.exists(), (
        "testA.tsv should not be generated because testA.xlsx contains an unimplemented 'range' type"
    )
    print("✓ testA.tsv correctly not generated (unimplemented 'range' type)")


# ===========================
# testB.xlsx TSV tests
# ===========================


def test_testB_tsv_generated(generated_files_dir: Path):
    """Verify that testB.tsv was generated from testB.xlsx."""
    tsv_path = generated_files_dir / "testB.tsv"
    assert tsv_path.exists(), f"testB.tsv was not generated in {generated_files_dir}"
    print("✓ testB.tsv generated successfully")


def test_testB_languages(generated_files_dir: Path):
    """Verify testB.tsv contains both German and English."""
    tsv_path = generated_files_dir / "testB.tsv"
    if not tsv_path.exists():
        pytest.skip("testB.tsv not found")

    languages = extract_languages_from_tsv(tsv_path)
    assert "de" in languages, "Expected German (de) language"
    assert "en" in languages, "Expected English (en) language"
    print(f"✓ Found languages: {languages}")


def test_testB_no_metadata_types(generated_files_dir: Path):
    """Verify start/end metadata types are not in the output."""
    tsv_path = generated_files_dir / "testB.tsv"
    if not tsv_path.exists():
        pytest.skip("testB.tsv not found")

    content = read_tsv_content(tsv_path)
    lines = content.strip().split("\n")

    for line in lines:
        parts = line.split("\t")
        if len(parts) < 2:
            continue
        # type/scale column - check no rows have 'start' or 'end' as their type
        row_class = parts[0]
        if row_class == "Q":
            type_scale = parts[1]
            assert type_scale != "start", "start metadata type should not appear"
            assert type_scale != "end", "end metadata type should not appear"

    print("✓ No start/end metadata types in output")


def test_testB_matrix_questions(generated_files_dir: Path):
    """Verify matrix questions (type F) are generated for label/list-nolabel patterns."""
    tsv_path = generated_files_dir / "testB.tsv"
    if not tsv_path.exists():
        pytest.skip("testB.tsv not found")

    content = read_tsv_content(tsv_path)
    lines = content.strip().split("\n")

    # Find Q rows with type F (Array/Matrix)
    matrix_questions = []
    subquestions = []
    answer_rows = []

    for line in lines:
        parts = line.split("\t")
        if len(parts) < 3:
            continue
        row_class = parts[0]
        row_type = parts[1]
        row_name = parts[2]

        if row_class == "Q" and row_type == "F":
            matrix_questions.append(row_name)
        elif row_class == "SQ":
            subquestions.append(row_name)
        elif row_class == "A":
            answer_rows.append(row_name)

    # testB has 3 matrix question groups: tools, techniques, topics
    assert len(matrix_questions) >= 3, (
        f"Expected at least 3 matrix questions (type F), got {len(matrix_questions)}: {matrix_questions}"
    )

    # Each matrix should have subquestions
    assert len(subquestions) > 0, "Expected subquestions (SQ rows) for matrix questions"

    # Matrix questions should share answer options
    assert len(answer_rows) > 0, "Expected answer rows (A rows) for matrix questions"

    print(f"✓ Matrix questions: {len(matrix_questions)}")
    print(f"  - Subquestions: {len(subquestions)}")
    print(f"  - Answer options: {len(answer_rows)}")


def test_testB_unique_answer_codes(generated_files_dir: Path):
    """Verify that SQ/A answer codes are unique per question per language."""
    tsv_path = generated_files_dir / "testB.tsv"
    if not tsv_path.exists():
        pytest.skip("testB.tsv not found")

    content = read_tsv_content(tsv_path)
    lines = content.strip().split("\n")

    current_question = ""
    # Map: (question_name, language) -> list of answer codes
    names_by_question: dict[tuple[str, str], list[str]] = {}

    for line in lines:
        parts = line.split("\t")
        if len(parts) < 7:
            continue

        row_class = parts[0]
        row_name = parts[2]
        row_lang = parts[6].strip()

        if row_class == "Q":
            current_question = row_name
        elif row_class in ("SQ", "A") and current_question:
            key = (current_question, row_lang)
            names_by_question.setdefault(key, []).append(row_name)

    # Check uniqueness
    for (question, lang), names in names_by_question.items():
        duplicates = [n for n in names if names.count(n) > 1]
        assert len(set(duplicates)) == 0, (
            f"Question '{question}' ({lang}) has duplicate answer codes: {set(duplicates)}"
        )

    print(f"✓ All answer codes unique per question ({len(names_by_question)} question/language combos checked)")


def test_testB_multilingual_content(generated_files_dir: Path):
    """Verify testB.tsv contains expected German and English content."""
    tsv_path = generated_files_dir / "testB.tsv"
    if not tsv_path.exists():
        pytest.skip("testB.tsv not found")

    content = read_tsv_content(tsv_path)

    # Check for German content
    assert "Deutsch" in content or "Anfänger" in content or "Deine" in content, "Expected German content in testB.tsv"

    # Check for English content
    assert "English" in content or "Beginner" in content or "Your" in content, "Expected English content in testB.tsv"

    print("✓ Multilingual content verified (de + en)")


def test_testB_groups(generated_files_dir: Path):
    """Verify testB.tsv contains correct groups (parent-only flattened, orphans get auto-groups)."""
    tsv_path = generated_files_dir / "testB.tsv"
    if not tsv_path.exists():
        pytest.skip("testB.tsv not found")

    content = read_tsv_content(tsv_path)
    lines = content.strip().split("\n")

    group_names = set()
    for line in lines:
        parts = line.split("\t")
        if len(parts) >= 3 and parts[0] == "G":
            group_names.add(parts[2])

    # grouplt58n55 is parent-only (no direct questions, only child groups)
    # so it gets flattened into a note question instead of a G row
    # Group names are now labels (displayed as group titles in LimeSurvey)
    # Multilingual groups have different names per language, check de labels
    named_groups = {
        "Hallo!",
        "Tools",
        "Techniken",
        "Themen",
        "Du und das Projekt",
        "Über dich",
    }

    missing = named_groups - group_names
    assert not missing, f"Missing groups: {missing}. Found: {group_names}"

    # Count distinct groups by type/scale key (column index 1), stable across languages
    group_keys = set()
    for line in lines:
        parts = line.split("\t")
        if len(parts) >= 3 and parts[0] == "G":
            group_keys.add(parts[1])

    # Orphan questions (outside any group) get auto-generated groups:
    # - project_id and project_role_* between groupgi4rv46 and grouplt58n55
    # - consent_privacy_policy after demographics
    assert len(group_keys) == 8, f"Expected exactly 8 groups (6 named + 2 auto), got {len(group_keys)}: {group_keys}"

    # grouplt58n55 should appear as a note question (type X)
    note_found = False
    for line in lines:
        parts = line.split("\t")
        if len(parts) >= 3 and parts[0] == "Q" and parts[1] == "X" and parts[2] == "grouplt58n55":
            note_found = True
            break
    assert note_found, "Parent-only group grouplt58n55 should appear as a note question (type X)"

    print(f"✓ All 8 groups present: {group_names}")
    print("✓ Parent-only group grouplt58n55 flattened to note question")


def test_testB_question_ordering(generated_files_dir: Path):
    """Verify questions appear in the correct order from the survey sheet."""
    tsv_path = generated_files_dir / "testB.tsv"
    if not tsv_path.exists():
        pytest.skip("testB.tsv not found")

    content = read_tsv_content(tsv_path)
    lines = content.strip().split("\n")

    # Extract unique Q-class question names in order of appearance
    question_names = []
    for line in lines:
        parts = line.split("\t")
        if len(parts) >= 3 and parts[0] == "Q":
            name = parts[2]
            if name not in question_names:
                question_names.append(name)

    # Verify key ordering: notes -> project -> roles -> skills -> motivation -> demographics -> consent
    def idx(name):
        assert name in question_names, f"Question '{name}' not found in output"
        return question_names.index(name)

    assert idx("Hallo") < idx("projectid"), "Notes should come before project questions"
    assert idx("projectid") < idx("projectroleprojectal"), "Project selection before role selection"
    assert idx("projectroleprojectal") < idx("projectroleprojectbe"), "Alpha roles before beta roles"
    assert idx("projectroleprojectbe") < idx("projectroleprojectga"), "Beta roles before gamma roles"
    assert idx("projectroleprojectga") < idx("ratingtechnologiest1"), "Role questions before skills"
    assert idx("ratingtechnologiest1") < idx("ratingtechniqueshead"), "Tools before techniques"
    assert idx("ratingtechniqueshead") < idx("ratingtopicsheader"), "Techniques before topics"
    assert idx("motivationskills") < idx("firstname"), "Motivation before demographics"
    assert idx("gender") < idx("consentprivacypolicy"), "Demographics before consent"

    print(f"✓ Question ordering verified ({len(question_names)} unique questions)")


def test_testB_relevance_expressions(generated_files_dir: Path):
    """Verify relevance expressions are transpiled (not raw XLSForm syntax)."""
    tsv_path = generated_files_dir / "testB.tsv"
    if not tsv_path.exists():
        pytest.skip("testB.tsv not found")

    content = read_tsv_content(tsv_path)

    # Raw XLSForm ${variable} references should NOT appear in the output
    assert "${" not in content, "Raw XLSForm variable references (${...}) should be transpiled"

    print("✓ Relevance expressions transpiled (no raw ${...} references)")


def test_testB_import(limesurvey_client: Client, generated_files_dir: Path):
    """Test import of testB.tsv into LimeSurvey and verify groups."""
    tsv_path = generated_files_dir / "testB.tsv"
    if not tsv_path.exists():
        pytest.skip("testB.tsv not found")

    survey_id = import_survey_from_tsv(limesurvey_client, tsv_path, "testB XLSX Integration Test")

    try:
        verify_survey_import(limesurvey_client, survey_id)

        # Verify named groups were imported (grouplt58n55 was flattened to note)
        # Group names are now labels (de is base language)
        # Plus 2 auto-generated groups for orphan questions
        expected_groups = [
            "Hallo!",
            "G1",
            "Tools",
            "Techniken",
            "Themen",
            "Du und das Projekt",
            "Über dich",
            "G7",
        ]
        verify_group_exists(limesurvey_client, survey_id, expected_groups)

        print(f"\n✓ testB survey imported successfully (ID: {survey_id})")
        print("✓ All 8 groups verified in LimeSurvey")
    finally:
        cleanup_survey(limesurvey_client, survey_id)


def test_testB_question_order_in_groups(limesurvey_client: Client, generated_files_dir: Path):
    """Verify that questions within each group have correct, incrementing order after import.

    LimeSurvey's TSV importer derives question_order from row position. With interleaved
    multilingual rows (Q de, Q en, Q de, Q en), the internal $qseq counter resets on each
    translation lookup, causing all questions to get question_order=0. Language-grouped
    output (all base-lang rows first, then translations) fixes this.
    """
    tsv_path = generated_files_dir / "testB.tsv"
    if not tsv_path.exists():
        pytest.skip("testB.tsv not found")

    survey_id = import_survey_from_tsv(limesurvey_client, tsv_path, "testB Question Order Test")

    try:
        questions = limesurvey_client.list_questions(survey_id)
        groups = limesurvey_client.list_groups(survey_id)

        # Build group_id -> group_name mapping
        gid_to_name = {}
        for g in groups:
            gid = g.get("gid") if isinstance(g, dict) else g.gid
            gname = g.get("group_name") if isinstance(g, dict) else g.group_name
            gid_to_name[int(gid)] = gname

        # Build group_id -> sorted questions mapping (parent questions only)
        questions_by_group = {}
        for q in questions:
            parent_qid = q.get("parent_qid") if isinstance(q, dict) else getattr(q, "parent_qid", 0)
            if parent_qid and int(parent_qid) != 0:
                continue  # skip subquestions

            gid = int(q.get("gid") if isinstance(q, dict) else q.gid)
            title = q.get("title") if isinstance(q, dict) else q.title
            order = int(q.get("question_order") if isinstance(q, dict) else q.question_order)

            if gid not in questions_by_group:
                questions_by_group[gid] = []
            questions_by_group[gid].append({"title": title, "order": order})

        # For every group, verify question_order values are unique and incrementing
        for gid, qs in questions_by_group.items():
            sorted_qs = sorted(qs, key=lambda x: x["order"])
            orders = [q["order"] for q in sorted_qs]
            titles = [q["title"] for q in sorted_qs]
            group_name = gid_to_name.get(gid, f"gid={gid}")

            # Orders must be unique (no duplicates from counter reset bug)
            assert len(set(orders)) == len(orders), (
                f"Group '{group_name}' has duplicate question_order values: {list(zip(titles, orders, strict=False))}"
            )

            # Orders must be strictly increasing
            for i in range(1, len(orders)):
                assert orders[i] > orders[i - 1], (
                    f"Group '{group_name}' has non-increasing question_order: {list(zip(titles, orders, strict=False))}"
                )

            print(f"✓ Group '{group_name}': {len(qs)} questions with correct order {orders}")

        # Verify specific expected ordering within key groups
        # Group "groupgi4rv46": Hallo → Disclaimer (only notes, project questions are in auto-group)
        g1_qs = None
        for gid, gname in gid_to_name.items():
            if gname == "groupgi4rv46":
                g1_qs = sorted(questions_by_group.get(gid, []), key=lambda x: x["order"])
                break

        if g1_qs:
            g1_titles = [q["title"] for q in g1_qs]
            assert g1_titles.index("Hallo") < g1_titles.index("Disclaimer"), (
                f"Hallo should come before Disclaimer, got: {g1_titles}"
            )
            # projectid should NOT be in this group (it's in an auto-generated group)
            assert "projectid" not in g1_titles, f"projectid should not be in groupgi4rv46, got: {g1_titles}"

        # Auto-generated group "G1": projectid → projectroleprojectal → projectroleprojectbe → projectroleprojectga
        auto_g1_qs = None
        for gid, gname in gid_to_name.items():
            if gname == "G1":
                auto_g1_qs = sorted(questions_by_group.get(gid, []), key=lambda x: x["order"])
                break

        if auto_g1_qs:
            auto_titles = [q["title"] for q in auto_g1_qs]
            assert auto_titles.index("projectid") < auto_titles.index("projectroleprojectal"), (
                f"projectid should come before projectroleprojectal, got: {auto_titles}"
            )
            assert auto_titles.index("projectroleprojectal") < auto_titles.index("projectroleprojectbe"), (
                f"projectroleprojectal should come before projectroleprojectbe, got: {auto_titles}"
            )
            assert auto_titles.index("projectroleprojectbe") < auto_titles.index("projectroleprojectga"), (
                f"projectroleprojectbe should come before projectroleprojectga, got: {auto_titles}"
            )

        # Group "demographics": firstname → lastname → emailaddress → gender → genderselfidentifica
        demo_qs = None
        for gid, gname in gid_to_name.items():
            if gname == "demographics":
                demo_qs = sorted(questions_by_group.get(gid, []), key=lambda x: x["order"])
                break

        if demo_qs:
            demo_titles = [q["title"] for q in demo_qs]
            assert demo_titles.index("firstname") < demo_titles.index("lastname"), (
                f"firstname should come before lastname, got: {demo_titles}"
            )
            assert demo_titles.index("lastname") < demo_titles.index("emailaddress"), (
                f"lastname should come before emailaddress, got: {demo_titles}"
            )
            assert demo_titles.index("emailaddress") < demo_titles.index("gender"), (
                f"emailaddress should come before gender, got: {demo_titles}"
            )
            # consentprivacypolicy is now in its own auto-generated group
            assert "consentprivacypolicy" not in demo_titles, (
                f"consentprivacypolicy should not be in demographics, got: {demo_titles}"
            )

        print(f"\n✓ Question ordering verified across all {len(questions_by_group)} groups")
    finally:
        cleanup_survey(limesurvey_client, survey_id)


def test_testB_relevance_in_limesurvey(limesurvey_client: Client, generated_files_dir: Path):
    """Verify that relevance expressions arrive correctly in LimeSurvey after import.

    Checks that:
    - select_multiple selected() → field_code.NAOK == 'Y' format is preserved
    - select_one equality → field.NAOK=='code' format is preserved
    - No raw XLSForm ${...} references
    - No TSV escaping artifacts
    """
    tsv_path = generated_files_dir / "testB.tsv"
    if not tsv_path.exists():
        pytest.skip("testB.tsv not found")

    survey_id = import_survey_from_tsv(limesurvey_client, tsv_path, "testB Relevance Expression Test")

    try:
        questions = limesurvey_client.list_questions(survey_id)

        # Build qid -> props lookup for all questions (including subquestions)
        all_props = {}
        for q in questions:
            qid = int(q.get("qid") if isinstance(q, dict) else q.qid)
            title = q.get("title") if isinstance(q, dict) else q.title
            props = limesurvey_client.get_question_properties(qid)
            all_props[title] = props

        # Print all questions with non-trivial relevance
        print("\n  Questions with relevance expressions:")
        for title, props in all_props.items():
            rel = props.get("relevance", "1")
            if rel and rel != "1":
                print(f"    {title}: {rel}")

        # Check that no relevance contains raw XLSForm syntax
        for title, props in all_props.items():
            rel = props.get("relevance", "")
            assert "${" not in rel, f"Question '{title}' has raw XLSForm in relevance: {rel}"

        # Check specific questions with known relevance patterns

        # Subquestions for select_multiple roles should have .NAOK relevance
        # soscisurvey subquestion: selected(${project_role_project-alpha}, 'role-survey-design')
        # → projectroleprojectal_roles.NAOK == 'Y'
        if "soscisurvey" in all_props:
            sosci_rel = all_props["soscisurvey"].get("relevance", "")
            print(f"\n  soscisurvey relevance: {sosci_rel}")
            assert ".NAOK" in sosci_rel, f"soscisurvey missing .NAOK in relevance: {sosci_rel}"
            assert '""' not in sosci_rel, f"soscisurvey has doubled quotes: {sosci_rel}"

        # pastapplicationsdeta: ${past_applications} = 'not_successful' → pastapplications == 'notsu'
        if "pastapplicationsdeta" in all_props:
            past_rel = all_props["pastapplicationsdeta"].get("relevance", "")
            print(f"  pastapplicationsdeta relevance: {past_rel}")
            assert "pastapplications" in past_rel, f"pastapplicationsdeta missing field ref: {past_rel}"
            assert "notsu" in past_rel, f"pastapplicationsdeta missing truncated answer code: {past_rel}"

        print("\n✓ Relevance expressions verified in LimeSurvey")
    finally:
        cleanup_survey(limesurvey_client, survey_id)


# ===========================
# Application form diagnostics
# ===========================
