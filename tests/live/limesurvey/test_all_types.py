"""
Integration tests for the all_types_survey fixture.
Validates that every supported XLSForm type, appearance, and feature
converts correctly to TSV and imports into LimeSurvey.

The source fixture is tests/fixtures/surveys/all_types_survey/xlsform.json,
shared with the vitest suite at src/test/integration/allTypes.test.ts.
"""

from pathlib import Path

import pytest
from citric import Client
from test_helpers import (
    cleanup_survey,
    count_mandatory_fields_in_tsv,
    get_survey_logic_summary,
    get_survey_structure_stats,
    import_survey_from_tsv,
    read_tsv_content,
    verify_group_exists,
    verify_question_exists,
    verify_survey_import,
)

# ===========================
# Helper: parse TSV into rows
# ===========================


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


def test_all_types_tsv_generated(generated_files_dir: Path):
    """Verify that all_types_survey.tsv was generated."""
    tsv_path = generated_files_dir / "all_types_survey.tsv"
    assert tsv_path.exists(), f"all_types_survey.tsv was not generated in {generated_files_dir}"
    print("✓ all_types_survey.tsv generated successfully")


def test_skip_types_absent(generated_files_dir: Path):
    """Verify metadata skip types (start, end, today, etc.) are not in the output."""
    tsv_path = generated_files_dir / "all_types_survey.tsv"
    if not tsv_path.exists():
        pytest.skip("all_types_survey.tsv not found")

    rows = _parse_tsv(tsv_path)
    all_names = {r["name"] for r in rows}
    skip_names = {"start", "end", "today", "deviceid", "username", "hidden1", "audit"}
    found = all_names & skip_names
    assert not found, f"Skip types should not appear in output: {found}"
    print("✓ No skip types in output")


def test_basic_question_types(generated_files_dir: Path):
    """Verify every basic XLSForm type maps to the correct LimeSurvey type code."""
    tsv_path = generated_files_dir / "all_types_survey.tsv"
    if not tsv_path.exists():
        pytest.skip("all_types_survey.tsv not found")

    rows = _parse_tsv(tsv_path)

    expected = {
        "qtext": "S",
        "qstring": "S",
        "qinteger": "N",
        "qint": "N",
        "qdecimal": "N",
        "qdate": "D",
        "qtime": "D",
        "qselectone": "L",
        "qselectmulti": "M",
        "qnote": "X",
    }

    for name, ls_type in expected.items():
        q = next((r for r in rows if r["class"] == "Q" and r["name"] == name), None)
        assert q is not None, f"Question '{name}' not found in output"
        assert q["type/scale"] == ls_type, f"Question '{name}': expected type '{ls_type}', got '{q['type/scale']}'"

    print(f"✓ All {len(expected)} basic types verified")


def test_appearance_modifiers(generated_files_dir: Path):
    """Verify appearance modifiers produce the correct type overrides."""
    tsv_path = generated_files_dir / "all_types_survey.tsv"
    if not tsv_path.exists():
        pytest.skip("all_types_survey.tsv not found")

    rows = _parse_tsv(tsv_path)

    # multiline text → T
    q = next(r for r in rows if r["class"] == "Q" and r["name"] == "qmultilinetext")
    assert q["type/scale"] == "T", f"multiline text should be T, got {q['type/scale']}"

    # multiline string → T
    q = next(r for r in rows if r["class"] == "Q" and r["name"] == "qmultilinestring")
    assert q["type/scale"] == "T", f"multiline string should be T, got {q['type/scale']}"

    # likert → L (no change)
    q = next(r for r in rows if r["class"] == "Q" and r["name"] == "qlikert")
    assert q["type/scale"] == "L", f"likert should stay L, got {q['type/scale']}"

    # minimal → ! (Dropdown)
    q = next(r for r in rows if r["class"] == "Q" and r["name"] == "qminimal")
    assert q["type/scale"] == "!", f"minimal should be !, got {q['type/scale']}"

    # matrix header (label) → F
    q = next(r for r in rows if r["class"] == "Q" and r["name"] == "matrixheader")
    assert q["type/scale"] == "F", f"matrix header should be F, got {q['type/scale']}"

    print("✓ Appearance modifiers verified (multiline→T, likert→L, minimal→!, label→F)")


def test_matrix_structure(generated_files_dir: Path):
    """Verify matrix questions have SQ subquestions and A answer options."""
    tsv_path = generated_files_dir / "all_types_survey.tsv"
    if not tsv_path.exists():
        pytest.skip("all_types_survey.tsv not found")

    rows = _parse_tsv(tsv_path)

    # Matrix subquestions (list-nolabel rows)
    matrix_sqs = [r for r in rows if r["class"] == "SQ" and r["name"] in ("skillpython", "skilljs", "skillsql")]
    assert len(matrix_sqs) >= 3, f"Expected 3 matrix subquestions, got {len(matrix_sqs)}"

    # Matrix answer options from choice list
    matrix_answers = [r for r in rows if r["class"] == "A" and r["name"] in ("none", "basic", "adv", "exp")]
    assert len(matrix_answers) >= 4, f"Expected 4 matrix answer options, got {len(matrix_answers)}"

    print(f"✓ Matrix: {len(matrix_sqs)} subquestions, {len(matrix_answers)} answer options")


def test_answer_classes(generated_files_dir: Path):
    """Verify select_one uses A answers and select_multiple uses SQ subquestions."""
    tsv_path = generated_files_dir / "all_types_survey.tsv"
    if not tsv_path.exists():
        pytest.skip("all_types_survey.tsv not found")

    rows = _parse_tsv(tsv_path)

    # Find rows after qselectone (should be A class)
    q_idx = next(i for i, r in enumerate(rows) if r["class"] == "Q" and r["name"] == "qselectone")
    next_rows = rows[q_idx + 1 : q_idx + 3]
    assert all(r["class"] == "A" for r in next_rows), "select_one should have A (answer) rows"

    # Find rows after qselectmulti (should be SQ class)
    q_idx = next(i for i, r in enumerate(rows) if r["class"] == "Q" and r["name"] == "qselectmulti")
    next_rows = rows[q_idx + 1 : q_idx + 4]
    assert all(r["class"] == "SQ" for r in next_rows), "select_multiple should have SQ (subquestion) rows"

    print("✓ Answer classes: select_one→A, select_multiple→SQ")


def test_or_other_modifier(generated_files_dir: Path):
    """Verify or_other sets other=Y on select_one and select_multiple."""
    tsv_path = generated_files_dir / "all_types_survey.tsv"
    if not tsv_path.exists():
        pytest.skip("all_types_survey.tsv not found")

    rows = _parse_tsv(tsv_path)

    checks = [
        ("qsel1other", "L"),
        ("qselmother", "M"),
    ]
    for name, expected_type in checks:
        q = next(r for r in rows if r["class"] == "Q" and r["name"] == name)
        assert q["type/scale"] == expected_type, f"{name}: expected type {expected_type}, got {q['type/scale']}"
        assert q["other"] == "Y", f"{name}: expected other=Y, got '{q['other']}'"

    print("✓ or_other verified on select_one, select_multiple")


def test_group_structure(generated_files_dir: Path):
    """Verify group structure: named groups, parent-only flattened, orphan auto-groups."""
    tsv_path = generated_files_dir / "all_types_survey.tsv"
    if not tsv_path.exists():
        pytest.skip("all_types_survey.tsv not found")

    rows = _parse_tsv(tsv_path)
    group_names = {r["name"] for r in rows if r["class"] == "G"}

    # Named groups present (group name = label in LimeSurvey TSV)
    for name in (
        "Persönliche Angaben",
        "Ausführliches Feedback",
        "Programmierkenntnisse",
        "Weitere Fragen",
        "Anmeldedaten",
    ):
        assert name in group_names, f"Expected group '{name}' not found. Available: {group_names}"

    # Parent-only group (matrix_wrapper) should NOT be a group
    assert "Selbsteinschätzung technischer Fähigkeiten" not in group_names, "Parent-only group should be flattened"

    # Parent-only group should appear as note (type X)
    note = next((r for r in rows if r["class"] == "Q" and r["name"] == "matrixwrapper"), None)
    assert note is not None, "matrixwrapper should exist as a note question"
    assert note["type/scale"] == "X", f"matrixwrapper should be type X, got {note['type/scale']}"

    # Total: 5 named + 2 auto-generated for orphans = 7
    assert len(group_names) == 7, f"Expected 7 groups (5 named + 2 auto), got {len(group_names)}: {group_names}"

    # Orphan questions should be in different groups than grouped questions
    current_group = ""
    question_group = {}
    for r in rows:
        if r["class"] == "G":
            current_group = r["name"]
        elif r["class"] == "Q" and r["name"] not in question_group:
            question_group[r["name"]] = current_group

    assert question_group.get("orphanbefore") != question_group.get("qtext"), (
        "orphan_before should not be in same group as basic_types questions"
    )
    assert question_group.get("orphanafter") != question_group.get("qmandatory"), (
        "orphan_after should not be in same group as features questions"
    )

    print(f"✓ Groups: {len(group_names)} total, parent-only flattened, orphans in auto-groups")


def test_mandatory_fields(generated_files_dir: Path):
    """Verify mandatory fields are marked correctly."""
    tsv_path = generated_files_dir / "all_types_survey.tsv"
    if not tsv_path.exists():
        pytest.skip("all_types_survey.tsv not found")

    rows = _parse_tsv(tsv_path)

    q = next(r for r in rows if r["class"] == "Q" and r["name"] == "qmandatory")
    assert q["mandatory"] == "Y", "qmandatory should have mandatory=Y"

    q = next(r for r in rows if r["class"] == "Q" and r["name"] == "qtext")
    assert q["mandatory"] == "", "qtext should not be mandatory"

    # Notes should never be mandatory
    q = next(r for r in rows if r["class"] == "Q" and r["name"] == "qnote")
    assert q["mandatory"] == "", "Notes should not be mandatory"

    mandatory_count = count_mandatory_fields_in_tsv(tsv_path)
    assert mandatory_count >= 2, f"Expected at least 2 mandatory fields, got {mandatory_count}"

    print(f"✓ Mandatory fields: {mandatory_count} found")


def test_hint_help_text(generated_files_dir: Path):
    """Verify hint text is mapped to the help column."""
    tsv_path = generated_files_dir / "all_types_survey.tsv"
    if not tsv_path.exists():
        pytest.skip("all_types_survey.tsv not found")

    rows = _parse_tsv(tsv_path)

    q = next(r for r in rows if r["class"] == "Q" and r["name"] == "qhint")
    assert q["help"] == "Format: +49 123 456789", f"Expected hint text, got '{q['help']}'"  # same in German

    print("✓ Hint text mapped to help column")


def test_constraint_validation(generated_files_dir: Path):
    """Verify constraint expressions are transpiled to em_validation_q."""
    tsv_path = generated_files_dir / "all_types_survey.tsv"
    if not tsv_path.exists():
        pytest.skip("all_types_survey.tsv not found")

    rows = _parse_tsv(tsv_path)

    q = next(r for r in rows if r["class"] == "Q" and r["name"] == "qconstraint")
    assert q["em_validation_q"], "qconstraint should have em_validation_q, got empty"
    assert "18" in q["em_validation_q"] and "120" in q["em_validation_q"], (
        f"Constraint should reference 18 and 120, got '{q['em_validation_q']}'"
    )

    print(f"✓ Constraint transpiled: {q['em_validation_q']}")


def test_default_values(generated_files_dir: Path):
    """Verify default values are preserved."""
    tsv_path = generated_files_dir / "all_types_survey.tsv"
    if not tsv_path.exists():
        pytest.skip("all_types_survey.tsv not found")

    rows = _parse_tsv(tsv_path)

    q = next(r for r in rows if r["class"] == "Q" and r["name"] == "qdefault")
    assert q["default"] == "Deutschland", f"Expected default 'Deutschland', got '{q['default']}'"

    print("✓ Default values preserved")


def test_relevance_conditions(generated_files_dir: Path):
    """Verify relevant expressions are transpiled to relevance column."""
    tsv_path = generated_files_dir / "all_types_survey.tsv"
    if not tsv_path.exists():
        pytest.skip("all_types_survey.tsv not found")

    rows = _parse_tsv(tsv_path)

    q = next(r for r in rows if r["class"] == "Q" and r["name"] == "qrelevant")
    assert q["relevance"] != "1", "qrelevant should have a relevance condition"
    assert "qmandatory" in q["relevance"], f"Relevance should reference qmandatory, got '{q['relevance']}'"

    print(f"✓ Relevance transpiled: {q['relevance']}")


def test_combined_features(generated_files_dir: Path):
    """Verify a question with all features combined."""
    tsv_path = generated_files_dir / "all_types_survey.tsv"
    if not tsv_path.exists():
        pytest.skip("all_types_survey.tsv not found")

    rows = _parse_tsv(tsv_path)

    q = next(r for r in rows if r["class"] == "Q" and r["name"] == "qallfeatures")
    assert q["mandatory"] == "Y", "combined: should be mandatory"
    assert q["help"] == "Freiwillig, aber willkommen", "combined: should have hint"
    assert q["default"] == "Keine Anmerkungen", "combined: should have default"
    assert q["relevance"] != "1", "combined: should have relevance"

    print("✓ All features combined on one question verified")


def test_question_ordering(generated_files_dir: Path):
    """Verify questions appear in the correct order from the fixture."""
    tsv_path = generated_files_dir / "all_types_survey.tsv"
    if not tsv_path.exists():
        pytest.skip("all_types_survey.tsv not found")

    rows = _parse_tsv(tsv_path)

    q_names = []
    for r in rows:
        if r["class"] == "Q" and r["name"] not in q_names:
            q_names.append(r["name"])

    def idx(name):
        assert name in q_names, f"Question '{name}' not found"
        return q_names.index(name)

    # orphan → basic types → appearances → matrix → or_other → features → orphan
    assert idx("orphanbefore") < idx("qtext"), "orphan_before should come before basic types"
    assert idx("qnote") < idx("qmultilinetext"), "basic types before appearances"
    assert idx("qlikert") < idx("matrixheader"), "appearances before matrix"
    assert idx("matrixheader") < idx("qsel1other"), "matrix before or_other"
    assert idx("qselmother") < idx("qmandatory"), "or_other before features"
    assert idx("qallfeatures") < idx("orphanafter"), "features before orphan_after"

    print(f"✓ Question ordering verified ({len(q_names)} questions)")


def test_all_row_classes_present(generated_files_dir: Path):
    """Verify all TSV row classes (S, SL, G, Q, A, SQ) are present."""
    tsv_path = generated_files_dir / "all_types_survey.tsv"
    if not tsv_path.exists():
        pytest.skip("all_types_survey.tsv not found")

    rows = _parse_tsv(tsv_path)
    classes = {r["class"] for r in rows}

    for cls in ("S", "SL", "G", "Q", "A", "SQ"):
        assert cls in classes, f"Row class '{cls}' missing from output"

    print(f"✓ All row classes present: {sorted(classes)}")


def test_all_ls_type_codes_present(generated_files_dir: Path):
    """Verify all LimeSurvey type codes (S, T, N, D, L, !, M, X, F) appear in the output."""
    tsv_path = generated_files_dir / "all_types_survey.tsv"
    if not tsv_path.exists():
        pytest.skip("all_types_survey.tsv not found")

    rows = _parse_tsv(tsv_path)
    q_types = {r["type/scale"] for r in rows if r["class"] == "Q"}

    for code in ("S", "T", "N", "D", "L", "!", "M", "X", "F"):
        assert code in q_types, f"LimeSurvey type code '{code}' missing from Q rows"

    print(f"✓ All 9 LS type codes present: {sorted(q_types)}")


# ===========================
# LimeSurvey import tests
# ===========================


def test_all_types_import(limesurvey_client: Client, generated_files_dir: Path):
    """Import all_types_survey.tsv into LimeSurvey and verify structure."""
    tsv_path = generated_files_dir / "all_types_survey.tsv"
    if not tsv_path.exists():
        pytest.skip("all_types_survey.tsv not found")

    survey_id = import_survey_from_tsv(limesurvey_client, tsv_path, "All Types Survey Test")

    try:
        verify_survey_import(limesurvey_client, survey_id)

        # Verify groups (group name = label in LimeSurvey TSV)
        verify_group_exists(
            limesurvey_client,
            survey_id,
            [
                "Persönliche Angaben",
                "Ausführliches Feedback",
                "Programmierkenntnisse",
                "Weitere Fragen",
                "Anmeldedaten",
            ],
        )

        # Verify key questions exist
        verify_question_exists(
            limesurvey_client,
            survey_id,
            [
                "qtext",
                "qstring",
                "qinteger",
                "qint",
                "qdecimal",
                "qdate",
                "qtime",
                "qselectone",
                "qselectmulti",
                "qnote",
                "qmultilinetext",
                "qmultilinestring",
                "qlikert",
                "qminimal",
                "matrixheader",
                "qsel1other",
                "qselmother",
                "qmandatory",
                "qhint",
                "qconstraint",
                "qdefault",
                "qrelevant",
                "qallfeatures",
                "orphanbefore",
                "orphanafter",
            ],
        )

        stats = get_survey_structure_stats(limesurvey_client, survey_id)
        assert stats["groups"] == 7, f"Expected 7 groups, got {stats['groups']}"

        print(f"\n✓ All types survey imported successfully (ID: {survey_id})")
        print(f"  - Groups: {stats['groups']}")
        print(f"  - Parent questions: {stats['questions']}")
        print(f"  - Subquestions: {stats['subquestions']}")
        print(f"  - Answers: {stats['answers']}")
    finally:
        cleanup_survey(limesurvey_client, survey_id)


def test_all_types_logic(limesurvey_client: Client, generated_files_dir: Path):
    """Verify mandatory fields, relevance, and validation after import."""
    tsv_path = generated_files_dir / "all_types_survey.tsv"
    if not tsv_path.exists():
        pytest.skip("all_types_survey.tsv not found")

    survey_id = import_survey_from_tsv(limesurvey_client, tsv_path, "All Types Logic Test")

    try:
        logic = get_survey_logic_summary(limesurvey_client, survey_id)

        assert logic["questions_mandatory"] >= 1, (
            f"Expected >= 1 mandatory questions, got {logic['questions_mandatory']}"
        )
        assert logic["questions_with_relevance"] >= 1, (
            f"Expected >= 1 questions with relevance, got {logic['questions_with_relevance']}"
        )

        print("\n✓ Logic verified:")
        print(f"  - Mandatory: {logic['questions_mandatory']}")
        print(f"  - With relevance: {logic['questions_with_relevance']}")
        print(f"  - With validation: {logic['questions_with_validation']}")
    finally:
        cleanup_survey(limesurvey_client, survey_id)


def test_all_types_question_order(limesurvey_client: Client, generated_files_dir: Path):
    """Verify question_order values are unique and incrementing within each group."""
    tsv_path = generated_files_dir / "all_types_survey.tsv"
    if not tsv_path.exists():
        pytest.skip("all_types_survey.tsv not found")

    survey_id = import_survey_from_tsv(limesurvey_client, tsv_path, "All Types Order Test")

    try:
        questions = limesurvey_client.list_questions(survey_id)
        groups = limesurvey_client.list_groups(survey_id)

        gid_to_name = {}
        for g in groups:
            gid = g.get("gid") if isinstance(g, dict) else g.gid
            gname = g.get("group_name") if isinstance(g, dict) else g.group_name
            gid_to_name[int(gid)] = gname

        questions_by_group = {}
        for q in questions:
            parent_qid = q.get("parent_qid") if isinstance(q, dict) else getattr(q, "parent_qid", 0)
            if parent_qid and int(parent_qid) != 0:
                continue

            gid = int(q.get("gid") if isinstance(q, dict) else q.gid)
            title = q.get("title") if isinstance(q, dict) else q.title
            order = int(q.get("question_order") if isinstance(q, dict) else q.question_order)

            if gid not in questions_by_group:
                questions_by_group[gid] = []
            questions_by_group[gid].append({"title": title, "order": order})

        for gid, qs in questions_by_group.items():
            sorted_qs = sorted(qs, key=lambda x: x["order"])
            orders = [q["order"] for q in sorted_qs]
            titles = [q["title"] for q in sorted_qs]
            group_name = gid_to_name.get(gid, f"gid={gid}")

            assert len(set(orders)) == len(orders), (
                f"Group '{group_name}' has duplicate question_order: {list(zip(titles, orders, strict=False))}"
            )

            for i in range(1, len(orders)):
                assert orders[i] > orders[i - 1], (
                    f"Group '{group_name}' non-increasing order: {list(zip(titles, orders, strict=False))}"
                )

            print(f"✓ Group '{group_name}': {len(qs)} questions, orders {orders}")

        print(f"\n✓ Question ordering verified across {len(questions_by_group)} groups")
    finally:
        cleanup_survey(limesurvey_client, survey_id)
