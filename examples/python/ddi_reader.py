"""Read a formtransform DDI-Codebook 2.5 file back into Python.

Stdlib only (pandas just for `apply_value_labels`). Copy this file into an
analysis project; it replaces survey2ddi's `survey2ddi_core.ddi` reader.

    labels = variable_labels("codebook.xml")      # {"age": "Age", ...}
    codes = value_labels("codebook.xml")          # {"gender": {"m": "Male"}}
    df = apply_value_labels(pd.read_csv("data.csv", dtype=str), "codebook.xml")
"""

import xml.etree.ElementTree as ET

NS = {"ddi": "ddi:codebook:2_5"}


def variable_labels(codebook_path):
    """{variable name: label} for every <var> in a DDI-Codebook 2.5 file."""
    labels = {}
    for var in ET.parse(codebook_path).getroot().iterfind(".//ddi:var", NS):
        for path in ("ddi:concept", "ddi:qstn/ddi:qstnLit", "ddi:labl"):
            node = var.find(path, NS)
            if node is not None and node.text:
                labels[var.get("name")] = node.text.strip()
                break
    return labels


def value_labels(codebook_path):
    """{variable name: {code: label}} for every <var> with categories."""
    maps = {}
    for var in ET.parse(codebook_path).getroot().iterfind(".//ddi:var", NS):
        # Only labelled categories: select_multiple binaries carry bare 0/1.
        cats = {
            cat.findtext("ddi:catValu", "", NS).strip(): label.strip()
            for cat in var.iterfind("ddi:catgry", NS)
            if (label := cat.findtext("ddi:labl", "", NS))
        }
        if cats:
            maps[var.get("name")] = cats
    return maps


def apply_value_labels(df, codebook_path):
    """Replace codes with their labels in every categorical column of `df`."""
    for col, mapping in value_labels(codebook_path).items():
        if col in df.columns:
            df[col] = df[col].astype("string").map(mapping).fillna(df[col])
    return df
