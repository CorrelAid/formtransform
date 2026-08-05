"""Registry-entry predicates shared by the Python and TypeScript DDI emitters."""


def _is_supported_question(data: dict) -> bool:
    """LimeSurvey TSV emittable (xlsform2lstsv perspective)."""
    if data.get("@type") != "QuestionType":
        return False
    ls = data.get("limesurvey", {})
    if ls.get("supported") is False:
        return False
    return ls.get("typeCode") is not None


def _is_ddi_emittable(data: dict) -> bool:
    """DDI XML emittable. True iff entry has a ddi.intrvl."""
    if data.get("@type") != "QuestionType":
        return False
    ddi = data.get("ddi", {})
    return bool(ddi.get("intrvl"))
