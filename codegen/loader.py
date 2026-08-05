"""Load and validate the JSON-LD type registry into a single @id-keyed dict."""

import json
from pathlib import Path
from typing import Any


def load_registry(path: Path) -> dict[str, Any]:
    """Load and parse JSON-LD registry. Keyed by full @id to avoid namespace collision.

    Aggregates the @graph from every source file, keyed by @id. All sources live
    under registry/ (path is registry/root.jsonld):
    - <path> (registry/root.jsonld) — pipeline, structural types
      (begin_group/end_group), fixtureless QuestionTypes (select_*_from_file),
      appearances, vocabularies
    - registry/schema.jsonld — the RegistrySchema declaration (meta:schema)
    - registry/conventions/<id>.jsonld — GlobalConventions + XLSFormColumnMap
    - registry/entities/<slug>/definition.jsonld — every authored entity that
      carries a worked example (QuestionType / QuestionTypeVariant / Composite),
      flat, one self-contained folder per entity holding its fixtures alongside.

    Archived entries (archived/*.jsonld) are NOT loaded — generated/ excludes them.
    """
    registry: dict[str, Any] = {}
    # `path` is registry/root.jsonld, so its parent IS the registry/ dir; the
    # split sources are siblings of the root file.
    base = path.parent

    # Root file first, then all split sources. Duplicate @id across any two
    # sources is a hard error, so the split stays collision-safe.
    sources = [
        path,
        *sorted(base.glob("schema.jsonld")),
        *sorted(base.glob("conventions/*.jsonld")),
        *sorted(base.glob("entities/*/definition.jsonld")),
    ]
    for source in sources:
        with open(source) as f:
            sdata = json.load(f)
        for item in sdata.get("@graph", []):
            if item["@id"] in registry:
                raise ValueError(f"Duplicate @id {item['@id']!r} found while loading {source}")
            registry[item["@id"]] = item

    _validate_consumed_by(registry)
    _validate_variant_slugs(registry)
    _validate_convention_refs(registry)
    _validate_vocab_files(registry, base / "vocab")
    _validate_registry(registry)
    return registry


def _validate_vocab_files(registry: dict[str, Any], vocab_dir: Path) -> None:
    """Every declared Vocabulary's ``xlsformFilename`` must exist on disk.

    Vocabularies are open-ended (see convention:externalCodeList's
    ``vocabularyDeclaration``): declaring one is the only step, so this is the
    check that keeps a declaration honest. Without it a typo'd or missing CSV
    surfaces much later — the forward converter silently falls back to erroring
    on an "unimplemented" from_file type when `resolveFileChoices` finds no
    options to inline.
    """
    errors: list[str] = []
    for at_id, data in registry.items():
        if data.get("@type") != "Vocabulary":
            continue
        filename = data.get("xlsformFilename")
        if filename and not (vocab_dir / filename).exists():
            errors.append(f"{at_id}: xlsformFilename {filename!r} not found in {vocab_dir}/")

    if errors:
        raise ValueError("vocabulary file validation failed:\n  " + "\n  ".join(errors))


# Presentation-flag → modifier-token map. A QuestionTypeVariant's slug is its
# base type slug plus these tokens for every truthy flag, in alphabetical order.
_MODIFIER_TOKENS = {
    "withLongList": "long_list",
    "withOther": "other",
}


def _validate_variant_slugs(registry: dict[str, Any]) -> None:
    """A QuestionTypeVariant slug must be <base>_<modifiers…> with modifier
    tokens sorted alphabetically (see _MODIFIER_TOKENS). Guarantees exactly one
    spelling per flag combination, so combinations (e.g. long_list + other) can't
    drift into ad-hoc names."""
    errors: list[str] = []
    for at_id, data in registry.items():
        if data.get("@type") != "QuestionTypeVariant":
            continue
        broader = data.get("skos:broader")
        if isinstance(broader, list):
            broader = next((b for b in broader if str(b.get("@id", "")).startswith("type:")), broader[0])
        base = str(broader.get("@id", "")).split(":", 1)[1] if isinstance(broader, dict) else ""
        pres = data.get("presentation", {})
        tokens = sorted(tok for flag, tok in _MODIFIER_TOKENS.items() if pres.get(flag))
        if not tokens:
            errors.append(
                f"{at_id}: QuestionTypeVariant has no active presentation modifier — the plain case belongs on the type, not a variant"
            )
            continue
        expected = "variant:" + "_".join([base, *tokens])
        if at_id != expected:
            errors.append(f"{at_id}: slug does not match flags — expected {expected!r} (base {base!r} + {tokens})")
    if errors:
        raise ValueError("variant slug/flag validation failed:\n  " + "\n  ".join(errors))


def _validate_convention_refs(registry: dict[str, Any]) -> None:
    """GlobalConvention rules that reference types must resolve.

    Checks ``appliesTo`` on each convention's ``rule``: every entry must be a
    registered XLSForm ``typeString``. Catches a convention left dangling after
    a type is renamed or removed (e.g. convention:externalCodeList naming
    select_one_from_file). Prose references elsewhere in a rule are not checked.

    Deliberately does NOT validate a list of vocabularies: conventions describe
    how a vocabulary is declared and handled, never which ones exist. Every
    consumer discovers them by filtering ``@type == "Vocabulary"``, so adding
    one needs no convention edit (see convention:externalCodeList's
    ``vocabularyDeclaration``). Vocabulary nodes are shape-checked below.
    """
    type_strings = {
        d["xlsform"]["typeString"]
        for d in registry.values()
        if d.get("@type") in ("QuestionType", "StructuralType") and d.get("xlsform", {}).get("typeString")
    }
    errors: list[str] = []

    for at_id, data in registry.items():
        if data.get("@type") != "GlobalConvention":
            continue
        rule = data.get("rule", {})
        for t in rule.get("appliesTo", []):
            if t not in type_strings:
                errors.append(f"{at_id}: rule.appliesTo references unknown type {t!r}")

    if errors:
        raise ValueError("convention reference validation failed:\n  " + "\n  ".join(errors))


def _validate_consumed_by(registry: dict[str, Any]) -> None:
    """Enforce that every leaf field in meta:schema declares `consumedBy`.

    `consumedBy` documents which build output reads each field (see
    meta:schema.consumedByLegend). This check guarantees the map stays present
    and well-formed — every leaf field must carry a non-empty `consumedBy`, and
    every token must be a legend key. It does NOT prove a field is actually read
    as marked (that would need generator instrumentation); it catches the common
    drift: a new field added without classifying it, or a typo'd token.
    """
    schema = registry.get("meta:schema", {})
    legend = schema.get("consumedByLegend", {})
    if not legend:
        raise ValueError("meta:schema is missing consumedByLegend")
    vocab = set(legend)
    errors: list[str] = []

    def walk(spec: dict, path: list[str]) -> None:
        children = spec.get("fields") or spec.get("itemFields")
        if isinstance(children, dict):
            for name, child in children.items():
                walk(child, [*path, name])
            return
        # leaf field
        key = " > ".join(path)
        consumed = spec.get("consumedBy")
        if not consumed:
            errors.append(f"{key}: missing consumedBy")
        elif not isinstance(consumed, list) or not consumed:
            errors.append(f"{key}: consumedBy must be a non-empty array")
        else:
            bad = [t for t in consumed if t not in vocab]
            if bad:
                errors.append(f"{key}: unknown consumedBy token(s) {bad} (allowed: {sorted(vocab)})")

    for cname, cspec in schema.get("classes", {}).items():
        for fname, fspec in cspec.get("fields", {}).items():
            walk(fspec, [cname, fname])

    if errors:
        raise ValueError("consumedBy validation failed:\n  " + "\n  ".join(errors))


def _validate_registry(registry: dict[str, Any]) -> None:  # noqa: C901 (grandfathered; split before extending)
    """Enforce the structural rules declared in meta:schema.

    Raises ValueError with a joined list of every violation found. Runs on every
    load_registry() call so any downstream generator sees a self-consistent graph.

    Field-level enforcement is driven by ``meta:schema.classes[<Class>].fields`` —
    for each entry of a given @type, every field marked ``required: true`` must be
    present and non-empty, and every field with ``allowedValues`` must fall in
    that enum. Deep nested fields (e.g. ``concept.openness``) are walked
    recursively.
    """
    errors: list[str] = []

    schema = registry.get("meta:schema", {})
    class_schemas = schema.get("classes", {})

    def _check_fields(prefix: str, value: Any, spec: dict, path: list[str]) -> None:
        # Handle object with declared fields.
        if isinstance(spec.get("fields"), dict):
            if not isinstance(value, dict):
                if spec.get("required"):
                    errors.append(f"{prefix}: {'.'.join(path)} must be an object, got {type(value).__name__}")
                return
            for fname, fspec in spec["fields"].items():
                fval = value.get(fname)
                declared_type = fspec.get("type", "")
                nullable = "null" in declared_type
                # 'present' = key exists in the dict. For nullable fields, null counts as present.
                present_key = fname in value
                present = present_key and (fval is not None or nullable)
                if fspec.get("required") and not present:
                    errors.append(f"{prefix}: missing required field {'.'.join([*path, fname])}")
                    continue
                if present and fval is not None:
                    _check_fields(prefix, fval, fspec, [*path, fname])
            return

        # Handle list-of-object with declared itemFields.
        if isinstance(spec.get("itemFields"), dict) and isinstance(value, list):
            for i, item in enumerate(value):
                _check_fields(prefix, item, {"fields": spec["itemFields"]}, [*path, f"[{i}]"])
            return

        # Leaf: enum check.
        allowed = spec.get("allowedValues")
        if allowed and value not in allowed:
            errors.append(f"{prefix}: {'.'.join(path)}={value!r} not in allowed values {allowed}")

    # Collect the xlsform.typeString values from every row-level type (QuestionType
    # + StructuralType). Appearance.validForTypes and Composite.skos:broader must
    # reference these; a dangling reference means the base type was deleted.
    row_types: dict[str, dict] = {
        data["xlsform"]["typeString"]: data
        for data in registry.values()
        if data.get("@type") in ("QuestionType", "StructuralType") and data.get("xlsform", {}).get("typeString")
    }
    row_type_ids: set[str] = {
        data["@id"]
        for data in registry.values()
        if data.get("@type") in ("QuestionType", "StructuralType", "Composite")
    }

    for at_id, data in registry.items():
        kind = data.get("@type")

        # Meta rows have no invariants beyond existing.
        if kind == "RegistrySchema":
            continue

        # Field-level check driven by meta:schema.
        cls_spec = class_schemas.get(kind)
        if cls_spec and cls_spec.get("fields"):
            _check_fields(at_id, data, cls_spec, [])

        # QuestionType / StructuralType need xlsform.typeString.
        if kind in ("QuestionType", "StructuralType") and not data.get("xlsform", {}).get("typeString"):
            errors.append(f"{at_id}: {kind} missing xlsform.typeString")

        # QuestionTypeVariant must point to a QuestionType or Composite.
        if kind == "QuestionTypeVariant":
            broader = data.get("skos:broader")
            if not broader:
                errors.append(f"{at_id}: QuestionTypeVariant missing skos:broader")
            else:
                targets = broader if isinstance(broader, list) else [broader]
                for target in targets:
                    tid = target.get("@id") if isinstance(target, dict) else None
                    if not tid:
                        errors.append(f"{at_id}: skos:broader entry missing @id")
                    elif tid not in registry:
                        errors.append(f"{at_id}: skos:broader → {tid!r} does not exist")
                    else:
                        ttype = registry[tid].get("@type")
                        if ttype not in ("QuestionType", "StructuralType", "Composite"):
                            errors.append(
                                f"{at_id}: skos:broader → {tid!r} is {ttype!r}, "
                                f"expected QuestionType | StructuralType | Composite"
                            )

        # Composite must have skos:broader (row types it composes) + trigger + input + output.
        if kind == "Composite":
            for field in ("skos:broader", "trigger", "input", "output"):
                if field not in data:
                    errors.append(f"{at_id}: Composite missing required field {field!r}")
            broader = data.get("skos:broader")
            if broader:
                targets = broader if isinstance(broader, list) else [broader]
                for target in targets:
                    tid = target.get("@id") if isinstance(target, dict) else None
                    if tid and tid not in row_type_ids:
                        errors.append(
                            f"{at_id}: composed target {tid!r} is not a QuestionType | StructuralType | Composite"
                        )

        # Appearance rules.
        if kind == "Appearance":
            if not data.get("xlsform", {}).get("appearanceString"):
                errors.append(f"{at_id}: Appearance missing xlsform.appearanceString")
            behavior = data.get("behavior")
            if behavior != "handled":
                errors.append(
                    f"{at_id}: Appearance.behavior is {behavior!r}, "
                    f"only 'handled' is accepted (drop unsupported entries)"
                )
            valid = data.get("validForTypes")
            if not valid:
                errors.append(f"{at_id}: Appearance missing validForTypes")
            else:
                for t in valid:
                    if t not in row_types:
                        errors.append(
                            f"{at_id}: validForTypes references {t!r} which is not a "
                            f"registered QuestionType or StructuralType"
                        )

        # StructuralType.pairedWith, if present, must reference another StructuralType.
        if kind == "StructuralType":
            paired = data.get("pairedWith")
            if paired:
                pid = paired.get("@id") if isinstance(paired, dict) else None
                if pid and pid not in registry:
                    errors.append(f"{at_id}: pairedWith → {pid!r} does not exist")
                elif pid and registry[pid].get("@type") != "StructuralType":
                    errors.append(f"{at_id}: pairedWith → {pid!r} is not a StructuralType")

        # Vocabulary shape.
        if kind == "Vocabulary":
            for field in ("xlsformFilename", "ddiVocab", "vocabURI"):
                if not data.get(field):
                    errors.append(f"{at_id}: Vocabulary missing required field {field!r}")

    if errors:
        raise ValueError(f"Registry validation failed with {len(errors)} issue(s):\n  - " + "\n  - ".join(errors))
