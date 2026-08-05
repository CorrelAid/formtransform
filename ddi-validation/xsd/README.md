# DDI-Codebook 2.5 XML Schema files

Official DDI-Codebook 2.5 XSDs + transitive dependencies. Used by:

- `workers/schematron-worker/` (Java validator)
- `tests/validation/test_ddi_schema.py` (validates blessed example `ddi.xml` snapshots)
- downstream consumers (qwacback) via registry sync

**Source:** [DDI-Codebook 2.5 specification](https://ddialliance.org/Specification/DDI-Codebook/2.5/). Files downloaded from `https://ddialliance.org/hubfs/Specification/DDI-Codebook/2.5/XMLSchema/` (entry: `codebook.xsd`).

**Entry point:** `codebook.xsd` — validate against this.

## Transitive dependencies

- `xml.xsd` — W3C XML namespace (`xml:lang` etc.)
- `dc.xsd`, `dcterms.xsd`, `dcmitype.xsd` — Dublin Core metadata
- `ddi-xhtml11.xsd` + `ddi-xhtml11-model-1.xsd` + `ddi-xhtml11-modules-1.xsd` — DDI's XHTML subset for rich-text fields
- `XHTML/` — XHTML 1.1 modular schema (W3C). All files imported transitively by `ddi-xhtml11-modules-1.xsd`.

Do NOT modify these files. To upgrade DDI-Codebook version: replace all files from the upstream zip, bump registry major version, re-bless example snapshots.
