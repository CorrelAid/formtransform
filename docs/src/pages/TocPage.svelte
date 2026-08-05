<script lang="ts">
  import {
    COMPOSITES,
    CONVENTIONS,
    VOCABULARIES,
    QUESTION_TYPES,
  } from "../data/registry";
  import { href } from "../lib/router.svelte";
  import AnnotatedQuestion from "../components/AnnotatedQuestion.svelte";
</script>

<section>
  <h1>CDL Survey Schema Registry</h1>
  <p>
    The standards in this ecosystem (XLSForm for Kobo Toolbox, LimeSurvey TSV,
    DDI) were built for different tools and purposes, and disagree about basic
    terms — what a question is, what its parts are. That makes transformations
    between them hard to keep consistent. This registry defines one canonical
    vocabulary used across all tools of the ecosystem and records how each
    standard maps onto it. The anchor concept is the <strong>question</strong>.
  </p>
  <p>
    The model is paired with an opinionated survey methodology: a small set of
    well-understood question types is enough for most purposes.
  </p>

  <h2>Why an additional type system?</h2>
  <p>
    Each standard ships its own type system: XLSForm type strings
    (<code>select_one</code>), LimeSurvey type codes (<code>L</code>,
    <code>M</code>, <code>F</code>), DDI response domains
    (<code>category</code>, <code>multiple</code>). None is a superset of the
    others, and none records how it maps to the rest — so every tool pair
    would need its own ad-hoc mapping. The registry adds one canonical type
    system as the hub: each concept is defined once, and its representation in
    every standard is recorded on that one entry.
  </p>
  <p>
    The registry is also an allowlist: a type that is not registered is not
    supported by the ecosystem's tools. This enforces the small-set
    methodology above.
  </p>

  <h3>Close to XLSForm — but not XLSForm</h3>
  <p>
    The hub deliberately borrows its names from
    <a href="https://xlsform.org" target="_blank" rel="noopener">XLSForm</a>:
    it is the authoring standard everything starts from, so a registry type
    called <code>select_one</code> is exactly the string an author writes in
    the survey sheet. Anyone who knows XLSForm can read the registry; nothing
    new to memorize. But the hub is not XLSForm — it deviates wherever XLSForm
    is too big, too vague, or has no word for something:
  </p>
  <ul>
    <li>
      <strong>Subset, not superset</strong> — XLSForm defines dozens of types
      (<code>geopoint</code>, <code>rank</code>, media types, …); the registry
      allowlists only the small set the whole ecosystem can express.
    </li>
    <li>
      <strong>Data contract added</strong> — XLSForm says nothing about what a
      type looks like in the exported dataset. Every registry type pins its
      data-layer shape (e.g. <code>select_multiple</code> → N binary
      variables) and its semantic classification (openness, cardinality, data
      nature).
    </li>
    <li>
      <strong>Names for the nameless</strong> — XLSForm has no concept for a
      multi-row pattern that reads as one question. The registry mints its own
      ids for these (<code>composite:grid</code>), and names recurring visual
      forms of one base type as <strong>QuestionTypeVariants</strong>.
    </li>
    <li>
      <strong>Stricter rules</strong> — where XLSForm is permissive, the
      registry constrains: sanitized names and choice codes, an explicit
      companion-question pattern instead of XLSForm's <code>or_other</code>
      shorthand, external code lists formalized as vocabularies, and only a
      handful of handled <code>appearance</code> values.
    </li>
  </ul>

  <h2>The model</h2>
  <p>
    A survey is an ordered set of <strong>questions</strong> and optional
    non-question content (e.g. a welcome message), chunked into
    <strong>pages</strong>.
  </p>

  <h3>Layers of a survey</h3>
  <p>
    A survey exists in three layers; most of what this registry records is the
    mapping between them.
  </p>
  <ul>
    <li>
      <strong>Authoring layer</strong> — the XLSForm rows the author writes:
      type strings, appearances, conventions.
      <em>Which rows produce this?</em> Everything registered in the registry
      is addressable at this layer.
    </li>
    <li>
      <strong>Presentation layer</strong> — what the respondent sees: label,
      hint, input, options; also grids, relevance, and page ordering.
      <em>How is the question shown and answered?</em>
    </li>
    <li>
      <strong>Data layer</strong> — how results are stored: which columns end
      up in the exported dataset and what they contain.
      <em>One question is not always one variable.</em>
    </li>
  </ul>
  <p>
    How the presentation and data layers relate for a multiple choice question:
  </p>
  <AnnotatedQuestion kind="select_multiple" />

  <h3>Elements of a survey</h3>
  <p>The top-level building blocks an author places into a survey:</p>
  <ul>
    <li>
      <strong>Questions</strong> — the units the respondent interacts with.
      Every question has a <strong>type</strong> that determines its elements
      and how it is answered. Type <code>note</code> is display-only static
      text (welcome message, section intro).
    </li>
    <li>
      <strong>Groups</strong> — a container bundling consecutive questions,
      marked in XLSForm by <code>begin_group</code> / <code>end_group</code>
      rows (the two StructuralTypes). <em>Plain groups</em> add a shared
      heading; <em>table-list groups</em> render as a grid / matrix.
    </li>
    <li>
      <strong>Pages</strong> — how questions are chunked visually. Presentation
      layer only: never authored as a row, derived from
      <code>settings.style</code>, Groups, and appearances like
      <code>field-list</code> — and therefore described here but not registered
      in the registry.
    </li>
  </ul>

  <h3>Anatomy of a question</h3>
  <p>
    "Question" means more than the question text: it may be an instruction
    ("select your strength of agreement"), and it may produce several dataset
    variables. A question is composed of these <strong>elements</strong>:
  </p>
  <ul>
    <li>
      <strong>label</strong> (mandatory) — the main question text.
    </li>
    <li>
      <strong>input</strong> (mandatory for all types except
      <code>note</code>) — how the respondent answers; may include
      <strong>options</strong>, which have labels themselves.
    </li>
    <li><strong>hint</strong> (optional) — clarifies the label.</li>
    <li>
      <strong>relevance</strong> (optional) — logic that shows or hides the
      question based on previous responses.
    </li>
  </ul>
  <p>
    Questions sharing one option set (e.g. Likert scales) can be combined into
    a grid / matrix: a <strong>composite question</strong> whose inputs are
    questions themselves.
  </p>

  <h2>Question types ({QUESTION_TYPES.length + COMPOSITES.length})</h2>
  <p>
    A <strong>type</strong> in this registry is more than XLSForm's type
    string: it is one entry that pins down how a kind of question behaves in
    all three layers — the row(s) the author writes, how the question renders
    and is answered, and the variable(s) it produces in the dataset — together
    with its representation in every standard, its constraints, and the
    conventions that apply to it. If two questions differ in any of these,
    they are different types (or different variants of one type).
  </p>
  <p>
    Each type page shows the entry's downstream representations — LimeSurvey
    (<code>typeCode</code>, <code>answerClass</code>) and DDI
    (<code>intrvl</code>, <code>responseDomainType</code>) — along with its
    variants and a worked example fixture.
  </p>

  <h3>Primitives ({QUESTION_TYPES.length})</h3>
  <p>
    One XLSForm row, one rendered question. Most produce one variable;
    <code>select_multiple</code> produces N.
  </p>
  <ul class="toc-list">
    {#each QUESTION_TYPES as t (t["@id"])}
      <li>
        <a
          href={href({
            name: "type",
            slug: t.xlsform?.typeString ?? t["@id"].split(":", 2)[1],
          })}
        >
          <code>{t.xlsform?.typeString}</code> · {t["skos:prefLabel"]}
        </a>
      </li>
    {/each}
  </ul>

  <h3>Multi-row patterns ({COMPOSITES.length})</h3>
  <p>
    Several XLSForm rows read as one question — e.g. the grid:
    <code>select_one</code> rows sharing a choice list inside a
    <code>begin_group</code> with <code>appearance=table-list</code>.
  </p>
  <ul class="toc-list">
    {#each COMPOSITES as c (c["@id"])}
      <li>
        <a href={href({ name: "composite", slug: c["@id"].split(":", 2)[1] })}>
          <code>{c["@id"]}</code> · {c["skos:prefLabel"]}
        </a>
      </li>
    {/each}
  </ul>

  <h2>Conventions & vocabularies</h2>
  <p>
    Not everything can hang on a single type. <strong>Conventions</strong> are
    cross-cutting rules that apply across types or across whole surveys: how
    names and choice codes are sanitized, how the "other" companion question
    is wired, how XLSForm columns map to LimeSurvey TSV columns, how the
    settings sheet and multiple languages are carried through. Registering
    them as data — instead of burying them in each tool's code — means every
    tool applies exactly the same rules.
  </p>
  <p>
    <strong>Vocabularies</strong> are external code lists (e.g. ISO 3166-1
    country codes) that <code>select_*_from_file</code> questions reference
    instead of inlining hundreds of choices.
  </p>
  <ul class="toc-list">
    <li>
      <a href={href({ name: "conventions" })}
        >Conventions ({CONVENTIONS.length})</a
      >
    </li>
    <li>
      <a href={href({ name: "vocabularies" })}
        >Vocabularies ({VOCABULARIES.length})</a
      >
    </li>
  </ul>
</section>

<style>
  .toc-list {
    list-style: none;
    padding: 0;
  }
  .toc-list li {
    padding: 0.35rem 0;
    border-bottom: 1px solid
      color-mix(in srgb, var(--color-text-primary) 6%, transparent);
  }
  .toc-list a {
    color: var(--color-text-primary);
    text-decoration: none;
  }
  .toc-list a:hover {
    text-decoration: underline;
  }
</style>
