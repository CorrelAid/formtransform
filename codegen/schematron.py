"""Emit the DDI schematron rules, parameterized by registry-owned facts."""

import json
import re
from pathlib import Path
from typing import Any


def _schematron_facts(registry: dict[str, Any]) -> dict[str, Any]:
    """Extract the registry-owned facts that parameterize the schematron rules.

    The rule *templates* (XPath structure) live in generate_schematron below;
    the *values* they assert against come from here, so registry/root.jsonld
    stays the single source of truth. If a type's DDI mapping changes, the
    emitted rules change with it.
    """

    def rdt_of(slug: str) -> str | None:
        return registry.get(f"type:{slug}", {}).get("ddi", {}).get("responseDomainType")

    # Categorical response-domain values (drive the "categorical → needs catgry"
    # rule). These are exactly the response domains of the two categorical base
    # types, select_one and select_multiple — the DDI 'category' and 'multiple'
    # domains. (Derived from the registry, not a hardcoded concept flag.)
    cat_rdts = sorted({r for r in (rdt_of("select_one"), rdt_of("select_multiple")) if r})

    # Allowed varGrp @type values — scanned from every `varGrp[@type='X']` the
    # registry mentions (composite containers, type structures, conventions).
    vg_types = sorted(set(re.findall(r"varGrp\[@type='([^']+)'\]", json.dumps(registry, ensure_ascii=False))))

    # The Or-Other companion convention + the DDI signature of the companion type.
    other = registry.get("convention:other", {}).get("rule", {})
    companion_type = other.get("companionType", "text")
    comp_ddi = registry.get(f"type:{companion_type}", {}).get("ddi", {})

    return {
        "cat_rdts": cat_rdts,
        "vg_types": vg_types,
        "category_rdt": rdt_of("select_one"),
        "multiple_rdt": rdt_of("select_multiple"),
        "suffix": other.get("companionSuffix", "_other"),
        "choice_code": other.get("choiceCode", "other"),
        "comp_rdt": comp_ddi.get("responseDomainType"),
        "comp_intrvl": comp_ddi.get("intrvl"),
        "comp_fmt": comp_ddi.get("formatType"),
    }


def generate_schematron(registry: dict[str, Any], output: Path) -> None:
    """Emit ddi-validation/schematron/ddi_custom_rules.sch from the registry.

    Each rule is authored once with the namespace placeholder ``%P%`` and emitted
    twice — namespaced (``ddi:``) and bare — so the ddi:/bare duplication is no
    longer maintained by hand. Type/convention facts come from _schematron_facts.
    """
    f = _schematron_facts(registry)

    cat_rdt_test = " or ".join(f"%P%qstn/@responseDomainType = '{r}'" for r in f["cat_rdts"])
    vg_type_test = " or ".join(f"@type = '{t}'" for t in f["vg_types"])
    quoted = [f'"{t}"' for t in f["vg_types"]]
    vg_type_msg = (", ".join(quoted[:-1]) + f", or {quoted[-1]}") if len(quoted) > 1 else quoted[0]
    mult, cat = f["multiple_rdt"], f["category_rdt"]
    sfx, cc = f["suffix"], f["choice_code"]
    c_rdt, c_intrvl, c_fmt = f["comp_rdt"], f["comp_intrvl"], f["comp_fmt"]

    # --- Pattern bodies, authored once with the %P% namespace placeholder. -----
    uniqueness = """\
    <rule context="%P%var">
        <assert test="not(preceding::%P%var/@ID = @ID)">Duplicate Variable ID found: <value-of select="@ID"/></assert>
    </rule>
    <rule context="%P%varGrp">
        <assert test="not(preceding::%P%varGrp/@ID = @ID)">Duplicate Variable Group ID found: <value-of select="@ID"/></assert>
    </rule>
"""

    essentials = f"""\
    <!-- Variable essentials -->
    <rule context="%P%var">
        <assert test="@name">Variable <value-of select="@ID"/> is missing a name attribute.</assert>
        <assert test="@intrvl">Variable <value-of select="@name"/> is missing an intrvl attribute (use "discrete" or "contin").</assert>
        <assert test="%P%qstn/@responseDomainType">Variable <value-of select="@name"/> is missing responseDomainType on qstn.</assert>
        <assert test="%P%qstn/%P%qstnLit">Variable <value-of select="@name"/> is missing a question literal (qstnLit).</assert>
        <assert test="%P%varFormat">Variable <value-of select="@name"/> is missing technical format (varFormat).</assert>
        <assert test="%P%concept and normalize-space(%P%concept) != ''">Variable <value-of select="@name"/> is missing a concept element.</assert>
        <assert test="not(%P%labl)">Variable <value-of select="@name"/> uses labl — use concept instead. labl is only for catgry elements.</assert>
        <assert test="count(%P%notes) &lt;= 1">Variable <value-of select="@name"/> has multiple notes elements. Only one notes element per variable is allowed.</assert>
    </rule>

    <!-- Variable group essentials -->
    <rule context="%P%varGrp">
        <assert test="@name">Variable Group <value-of select="@ID"/> is missing a name attribute.</assert>
        <assert test="{vg_type_test}">Variable Group <value-of select="@ID"/> has type="<value-of select="@type"/>". Only {vg_type_msg} are supported.</assert>
        <assert test="%P%concept and normalize-space(%P%concept) != ''">Variable Group <value-of select="@ID"/> is missing a concept element.</assert>
        <assert test="not(%P%labl)">Variable Group <value-of select="@ID"/> uses labl — use concept instead. labl is only for catgry elements.</assert>
    </rule>

    <!-- Category essentials — labl required unless the categorical response is '{mult}' (checkboxes) -->
    <rule context="%P%catgry">
        <assert test="%P%catValu">A catgry element is missing catValu.</assert>
        <assert test="%P%labl or ancestor::%P%var/%P%qstn/@responseDomainType = '{mult}'">A catgry element (value: <value-of select="%P%catValu"/>) is missing a labl (required for responseDomainType="category").</assert>
    </rule>
"""

    logic = f"""\
    <!--
        Categorical variables must have catgry elements UNLESS concept/@vocab
        is present, which signals that the categories are defined by an external
        standard code list (e.g. ISO 3166-1 country codes) and need not be
        repeated inline.
    -->
    <rule context="%P%var">
        <assert test="not({cat_rdt_test}) or %P%catgry or %P%concept/@vocab">
            Variable <value-of select="@name"/> (ID: <value-of select="@ID"/>) has a categorical response domain but no catgry elements (add categories or reference an external vocabulary via concept/@vocab).
        </assert>
    </rule>

    <!-- Consistency rules for grid and multiple-response groups -->
    <rule context="%P%varGrp[@type='grid' or @type='multipleResp']">
        <assert test="every $id in tokenize(@var, '\\s+') satisfies (not(//%P%var[@ID=$id]/%P%qstn/%P%preQTxt) or normalize-space(//%P%var[@ID=$id]/%P%qstn/%P%preQTxt) = normalize-space(%P%txt))">
            Consistency Error: Variable Group <value-of select="@ID"/> (<value-of select="@type"/>) text does not match the preQTxt of its member variables.
        </assert>
        <assert test="not(@type='multipleResp') or (every $id in tokenize(@var, '\\s+') satisfies (//%P%var[@ID=$id]/%P%qstn/@responseDomainType = '{mult}'))">
            Semantic Error: Variables in a multipleResp group (<value-of select="@ID"/>) should have responseDomainType="{mult}".
        </assert>
        <assert test="not(@type='grid') or (every $id in tokenize(@var, '\\s+') satisfies (//%P%var[@ID=$id]/%P%qstn/@responseDomainType = '{cat}'))">
            Semantic Error: Variables in a grid group (<value-of select="@ID"/>) should have responseDomainType="{cat}".
        </assert>
    </rule>

    <!-- Parent "other" varGrp rules (semi-open question hierarchy) -->
    <rule context="%P%varGrp[@type='other']">
        <assert test="@var or @varGrp">
            Parent varGrp <value-of select="@ID"/> (type="other") must reference variables (@var) or child groups (@varGrp).
        </assert>
        <assert test="not(@varGrp) or (every $id in tokenize(@varGrp, '\\s+') satisfies //%P%varGrp[@ID=$id])">
            Parent varGrp <value-of select="@ID"/> references a child varGrp that does not exist.
        </assert>
        <assert test="not(@var) or (every $id in tokenize(@var, '\\s+') satisfies //%P%var[@ID=$id])">
            Parent varGrp <value-of select="@ID"/> references a variable that does not exist.
        </assert>
    </rule>
"""

    other_variables = f"""\
    <!--
        Rules for "{sfx}" (semi-open / halb-offen) variables.
        Convention: a var whose @name ends in "{sfx}" is a free-text
        specification field linked to a base variable or group by naming
        convention (e.g. geschlecht{sfx} → geschlecht). Companion facts
        (type/intrvl/format) come from type:{registry.get("convention:other", {}).get("rule", {}).get("companionType", "text")} in the registry.
    -->
    <rule context="%P%var[ends-with(@name, '{sfx}')]">
        <assert test="%P%qstn/@responseDomainType = '{c_rdt}'">
            Variable <value-of select="@name"/> ends in "{sfx}" but has responseDomainType="<value-of select="%P%qstn/@responseDomainType"/>". Expected "{c_rdt}".
        </assert>
        <assert test="@intrvl = '{c_intrvl}'">
            Variable <value-of select="@name"/> ends in "{sfx}" but has intrvl="<value-of select="@intrvl"/>". Expected "{c_intrvl}".
        </assert>
        <assert test="%P%varFormat/@type = '{c_fmt}'">
            Variable <value-of select="@name"/> ends in "{sfx}" but has varFormat type="<value-of select="%P%varFormat/@type"/>". Expected "{c_fmt}".
        </assert>
        <assert test="//%P%var[@name = substring-before(current()/@name, '{sfx}')] or //%P%varGrp[@name = substring-before(current()/@name, '{sfx}')]">
            Variable <value-of select="@name"/> ends in "{sfx}" but no matching base variable or group named "<value-of select="substring-before(@name, '{sfx}')"/>" was found.
        </assert>
        <assert test="not(//%P%var[@name = substring-before(current()/@name, '{sfx}')]) or //%P%var[@name = substring-before(current()/@name, '{sfx}')]/%P%catgry[%P%catValu = '{cc}'] or //%P%varGrp[@name = substring-before(current()/@name, '{sfx}')]">
            Variable <value-of select="@name"/>: the base variable "<value-of select="substring-before(@name, '{sfx}')"/>" must have a catgry with catValu="{cc}" (convention for round-trip conversion).
        </assert>
        <assert test="not(//%P%varGrp[@type='multipleResp' and contains(concat(' ', @var, ' '), concat(' ', current()/@ID, ' '))])">
            Variable <value-of select="@name"/> ({c_rdt} {sfx}) must not be a member of a multipleResp group. It should be a standalone variable outside the group.
        </assert>
        <assert test="not(//%P%var[@name = substring-before(current()/@name, '{sfx}')]/%P%concept/@vocab)">
            Variable <value-of select="@name"/>: the base variable "<value-of select="substring-before(@name, '{sfx}')"/>" uses concept/@vocab (long list). Long list and {sfx} cannot be combined.
        </assert>
    </rule>
"""

    patterns = [
        ("uniqueness", uniqueness),
        ("essentials", essentials),
        ("logic", logic),
        ("other_variables", other_variables),
    ]

    out: list[str] = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        "<!-- GENERATED by codegen — DO NOT EDIT BY HAND.",
        "     Edit registry/root.jsonld (+ registry/entities/<slug>/definition.jsonld) and re-run `uv run codegen`. -->",
        '<schema xmlns="http://purl.oclc.org/dsdl/schematron" queryBinding="xpath2">',
        '    <ns prefix="ddi" uri="ddi:codebook:2_5"/>',
        "",
    ]
    for pid, body in patterns:
        out.append(f'    <pattern id="{pid}">')
        # Emit each rule twice: namespaced (ddi:) then bare.
        out.append(body.replace("%P%", "ddi:").rstrip("\n"))
        out.append(body.replace("%P%", "").rstrip("\n"))
        out.append("    </pattern>")
        out.append("")
    out.append("</schema>")

    output.write_text("\n".join(out) + "\n")
