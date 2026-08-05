<script lang="ts">
  import type { RegistryEntry } from "../data/registry";

  interface Props { composite: RegistryEntry; }
  let { composite }: Props = $props();

  const slug = composite["@id"].split(":", 2)[1];
  const broader = composite["skos:broader"];
  const broaderIds = broader
    ? Array.isArray(broader)
      ? broader.map(b => b["@id"])
      : [broader["@id"]]
    : [];
  const trigger = (composite.trigger ?? {}) as { xlsformPattern?: string; applyTo?: string };
  const input = (composite.input ?? {}) as { rows?: Array<{ role: string; match: string; cardinality?: string | number }> };
  const output = (composite.output ?? {}) as { ddi?: Record<string, unknown>; lsTsv?: Record<string, unknown> };
</script>

<article id={`composite-${slug}`} style="margin-bottom: 2rem; padding-bottom: 1rem; border-bottom: 1px solid color-mix(in srgb, var(--color-text-primary) 8%, transparent);">
  <h3>
    {composite["skos:prefLabel"] ?? slug}
    <code>composite:{slug}</code>
  </h3>

  {#if composite.useWhen}
    <p class="use-when"><strong>Use when:</strong> {composite.useWhen}</p>
  {/if}

  <dl class="kv-table">
    {#if broaderIds.length}<dt>Broader</dt><dd>{#each broaderIds as id}<code>{id}</code>{' '}{/each}</dd>{/if}
    {#if trigger.xlsformPattern}<dt>Trigger</dt><dd>{trigger.xlsformPattern}</dd>{/if}
    {#if trigger.applyTo}<dt>Scope</dt><dd>{trigger.applyTo}</dd>{/if}
  </dl>

  {#if input.rows?.length}
    <h4>Input rows</h4>
    <table>
      <thead><tr><th>Role</th><th>Match</th><th>Cardinality</th></tr></thead>
      <tbody>
        {#each input.rows as r}
          <tr><td><code>{r.role}</code></td><td>{r.match}</td><td>{r.cardinality ?? "—"}</td></tr>
        {/each}
      </tbody>
    </table>
  {/if}

  <h4>Output</h4>
  {#if output.ddi}
    <strong>DDI</strong>
    <pre>{JSON.stringify(output.ddi, null, 2)}</pre>
  {/if}
  {#if output.lsTsv}
    <strong>LimeSurvey TSV</strong>
    <pre>{JSON.stringify(output.lsTsv, null, 2)}</pre>
  {/if}

  {#if composite.schematronPatterns?.length}
    <p><strong>Enforced by schematron patterns:</strong>
      {#each composite.schematronPatterns as p}<code>{p}</code>{' '}{/each}
    </p>
  {/if}

  {#if composite.notes?.length}
    <h4>Notes</h4>
    <ul>
      {#each composite.notes as n}<li>{n}</li>{/each}
    </ul>
  {/if}
</article>

<style>
  .use-when {
    margin: 0.25rem 0 0.75rem;
    color: color-mix(in srgb, var(--color-text-primary) 80%, transparent);
  }
</style>
