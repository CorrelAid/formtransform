// Build-time data loader. Vite resolves `?raw` and JSON imports of files
// under `@registry/` (alias to ../ in vite.config.ts).
//
// Two roots:
//   - ../registry/root.jsonld    main jsonld (structural types, from_file types, vocab, pipeline)
//   - ../registry/entities/<slug>/definition.jsonld  every entity with a worked example (type/variant/composite)

// .jsonld files are imported as raw text and JSON.parsed because Vite only
// auto-parses .json by extension.
import mainGraphRaw from "@registry/registry/root.jsonld?raw";

const mainGraph = JSON.parse(mainGraphRaw) as { "@graph": RegistryEntry[] };

// Vite globs for every split source (same aggregation as codegen.load_registry):
// schema.jsonld + conventions/<slug>.jsonld + registry/<slug>/definition.jsonld.
// import.meta.glob needs literal patterns, so one glob per shape.
const splitSourcesRaw = {
  ...import.meta.glob<string>("@registry/registry/schema.jsonld", {
    eager: true, query: "?raw", import: "default",
  }),
  ...import.meta.glob<string>("@registry/registry/conventions/*.jsonld", {
    eager: true, query: "?raw", import: "default",
  }),
  ...import.meta.glob<string>("@registry/registry/entities/*/definition.jsonld", {
    eager: true, query: "?raw", import: "default",
  }),
};
const typeDefs: Record<string, { "@graph": RegistryEntry[] }> = {};
for (const [k, v] of Object.entries(splitSourcesRaw)) {
  typeDefs[k] = JSON.parse(v as string);
}

// Example payloads: registry/entities/<slug>/{xlsform.json, ddi.xml, tsv.tsv, meta.json}
const exampleXlsforms = import.meta.glob<{ default: ExampleXlsform }>(
  "@registry/registry/entities/*/xlsform.json",
  { eager: true }
);
const exampleDdi = import.meta.glob<string>(
  "@registry/registry/entities/*/ddi.xml",
  { eager: true, query: "?raw", import: "default" }
);
const exampleTsv = import.meta.glob<string>(
  "@registry/registry/entities/*/tsv.tsv",
  { eager: true, query: "?raw", import: "default" }
);

export interface RegistryEntry {
  "@id": string;
  "@type": string;
  "skos:prefLabel"?: string;
  useWhen?: string;
  xlsform?: { typeString?: string; aliases?: string[]; requiresListName?: boolean };
  limesurvey?: { typeCode?: string | null; supportsOther?: boolean; answerClass?: string | null };
  ddi?: Record<string, unknown>;
  constraints?: Record<string, unknown>;
  variants?: string[];
  // QuestionTypeVariant fields
  examplePath?: string;
  exampleDir?: string;
  presentation?: Record<string, unknown>;
  "skos:broader"?: { "@id": string } | { "@id": string }[];
  // Composite fields
  trigger?: Record<string, unknown>;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  schematronPatterns?: string[];
  notes?: string[];
  // GlobalConvention
  rule?: Record<string, unknown>;
  // XLSFormColumnMap
  map?: Record<string, unknown>[];
  // Vocabulary
  xlsformFilename?: string;
  ddiVocab?: string;
  vocabURI?: string;
  standard?: string;
  description?: string;
  // Archive metadata
  archiveReason?: string;
  archivedSince?: string;
}

export interface ExampleXlsform {
  survey: Array<Record<string, string>>;
  choices: Array<Record<string, string>>;
}

function loadEntries(): RegistryEntry[] {
  const all: RegistryEntry[] = [];
  all.push(...(mainGraph["@graph"] ?? []));
  for (const sub of Object.values(typeDefs)) {
    all.push(...(sub["@graph"] ?? []));
  }
  return all;
}

export const ENTRIES: RegistryEntry[] = loadEntries();

export const QUESTION_TYPES = ENTRIES.filter(e => e["@type"] === "QuestionType");
export const STRUCTURAL_TYPES = ENTRIES.filter(e => e["@type"] === "StructuralType");
export const QUESTION_TYPE_VARIANTS = ENTRIES.filter(e => e["@type"] === "QuestionTypeVariant");
export const APPEARANCES = ENTRIES.filter(e => e["@type"] === "Appearance");
export const CONVENTIONS = ENTRIES.filter(e => e["@type"] === "GlobalConvention");
export const COMPOSITES = ENTRIES.filter(e => e["@type"] === "Composite");
export const VOCABULARIES = ENTRIES.filter(e => e["@type"] === "Vocabulary");

// Examples keyed by registry slug (e.g. "select_one", "select_one_other", "grid")
export interface VariantBundle {
  entityId: string;
  slug: string;
  variantLabel: string | null;
  useWhen: string | null;
  xlsform: ExampleXlsform | null;
  ddi: string | null;
  tsv: string | null;
}

function variantSlugFromPath(path: string): string {
  // e.g. /home/.../registry/entities/select_one_other/xlsform.json
  const m = path.match(/\/entities\/([^/]+)\//);
  return m ? m[1] : "";
}

export function getVariantBundle(slug: string): VariantBundle | null {
  let xlsform: ExampleXlsform | null = null;
  let ddi: string | null = null;
  let tsv: string | null = null;

  for (const [path, mod] of Object.entries(exampleXlsforms)) {
    if (variantSlugFromPath(path) === slug) {
      xlsform = (mod as { default: ExampleXlsform }).default;
      break;
    }
  }
  for (const [path, content] of Object.entries(exampleDdi)) {
    if (variantSlugFromPath(path) === slug) {
      ddi = content as string;
      break;
    }
  }
  for (const [path, content] of Object.entries(exampleTsv)) {
    if (variantSlugFromPath(path) === slug) {
      tsv = content as string;
      break;
    }
  }
  if (!xlsform && !ddi && !tsv) return null;
  // The example belongs to whatever entity's exampleDir basename == slug
  // (a QuestionType's own example, a variant, or a composite).
  const entry = ENTRIES.find(e => {
    const dir = e.exampleDir as string | undefined;
    return dir ? dir.split("/").pop() === slug : false;
  });
  return {
    entityId: entry?.["@id"] ?? slug,
    slug,
    variantLabel: entry?.["skos:prefLabel"] ?? null,
    useWhen: entry?.useWhen ?? null,
    xlsform,
    ddi,
    tsv,
  };
}

// Bundles shown under a type: the type's own default example first, then its
// real variants (skos:broader → this type).
export function variantsForType(typeId: string): VariantBundle[] {
  const slugs: string[] = [];
  const typeEntry = ENTRIES.find(e => e["@id"] === typeId);
  const ownDir = typeEntry?.exampleDir as string | undefined;
  if (ownDir) slugs.push(ownDir.split("/").pop() as string);
  for (const v of QUESTION_TYPE_VARIANTS) {
    const broader = v["skos:broader"];
    if (!broader) continue;
    const ids = Array.isArray(broader) ? broader.map(b => b["@id"]) : [broader["@id"]];
    if (ids.includes(typeId)) slugs.push(v["@id"].split(":", 2)[1]);
  }
  return slugs
    .map(s => getVariantBundle(s))
    .filter((b): b is VariantBundle => b !== null);
}
