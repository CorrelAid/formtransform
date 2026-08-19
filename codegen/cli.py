"""Command-line driver: load the registry, then run every generator."""

import sys
from pathlib import Path

from .emit_docs import generate_type_docs
from .emit_skill import generate_skill
from .emit_ts import (
    generate_appearances,
    generate_conventions,
    generate_conventions_ts,
    generate_question_types,
    generate_typescript,
    generate_typescript_ddi,
)
from .examples import build_example_artifacts
from .loader import load_registry
from .schematron import generate_schematron

# Repo root — the package lives in <root>/codegen/, so go up one level.
REPO_ROOT = Path(__file__).resolve().parent.parent


def _opt_value(argv: list[str], name: str) -> str | None:
    """Return the value of a ``--name=value`` flag, or None if absent."""
    prefix = f"{name}="
    for a in argv:
        if a.startswith(prefix):
            return a[len(prefix) :]
    return None


def main(argv: list[str] | None = None) -> None:
    argv = sys.argv[1:] if argv is None else argv
    bless = "--bless-snapshots" in argv
    # Screenshots are heavy (Docker + a headless browser + network), so they are
    # off unless explicitly requested. See codegen/emit_screenshots.py.
    do_screenshots = "--screenshots" in argv
    base_dir = REPO_ROOT
    registry_path = base_dir / "registry" / "root.jsonld"

    print("Loading registry from registry/root.jsonld...")
    registry = load_registry(registry_path)
    print(f"  Loaded {len(registry)} types")

    # TS artifacts feed the in-repo transformer library directly.
    ts_out = base_dir / "src" / "generated"
    ts_out.mkdir(parents=True, exist_ok=True)

    print("\nGenerating code...")
    generate_typescript(registry, ts_out / "TypeMappings.ts")
    print("  ✅ src/generated/TypeMappings.ts (transformer)")

    generate_typescript_ddi(registry, ts_out / "DdiMappings.ts")
    print("  ✅ src/generated/DdiMappings.ts (DDI emitter)")

    generate_appearances(registry, ts_out / "Appearances.ts")
    print("  ✅ src/generated/Appearances.ts (transformer)")

    generate_conventions(registry, ts_out / "conventions.json")
    print("  ✅ src/generated/conventions.json (artifact for non-TS consumers)")

    generate_conventions_ts(registry, ts_out / "conventions.ts")
    print("  ✅ src/generated/conventions.ts (transformer)")

    generate_question_types(registry, ts_out / "QuestionTypes.ts")
    print("  ✅ src/generated/QuestionTypes.ts (labelled catalogue for consumers)")

    generate_schematron(registry, base_dir / "ddi-validation" / "schematron" / "ddi_custom_rules.sch")
    print("  ✅ ddi-validation/schematron/ddi_custom_rules.sch (DDI validation rules)")

    n_docs = generate_type_docs(registry, base_dir)
    print(f"  ✅ registry/entities/<slug>/docs.md ({n_docs} blessed types)")

    n_skill = generate_skill(registry, base_dir, base_dir / "skills" / "cdl-survey-types")
    print(f"  ✅ skills/cdl-survey-types/ (nested skill for survey generators, {n_skill} files)")

    print("\nBuilding example artifacts (meta.json + xlsx)...")
    print("  [ddi.xml and tsv.tsv are blessed separately: npm run bless]")
    report = build_example_artifacts(registry, base_dir, bless_snapshots=bless)
    for eid, r in report.items():
        flags = "".join(k[0] if r.get(k) else "-" for k in ("meta", "xlsx", "ddi"))
        errs = " ".join(f"{k}={v[:60]}" for k, v in r.items() if k.endswith("_error"))
        print(f"  [{flags}] {eid}  {errs}")

    if do_screenshots:
        from .emit_screenshots import generate_screenshots

        engine = _opt_value(argv, "--screenshots-engine")
        engines = (engine,) if engine else ("limesurvey", "xlsform")
        types_opt = _opt_value(argv, "--screenshots-types")
        only = types_opt.split(",") if types_opt else None
        shot_dir = base_dir / "screenshots"

        print(f"\nGenerating question screenshots → {shot_dir} (engines: {', '.join(engines)})...")
        shot_report = generate_screenshots(base_dir, shot_dir, engines=engines, only=only)
        for eng, per_type in shot_report.items():
            for slug, status in sorted(per_type.items()):
                mark = "✅" if status == "ok" else "❌"
                print(f"  {mark} {eng}/{slug}: {status}")

    print("\n✨ Code generation complete!")
    print("\nNext steps:")
    print("  1. Review generated files in src/generated/")
    print("  2. src/generated/* feed the in-repo TS library directly (no copy).")
    print("  3. Downstream qwacback consumes @correlaid/formtransform (npm) +")
    print("     syncs ddi-validation/ + workers/ via its .registry-version pin.")
