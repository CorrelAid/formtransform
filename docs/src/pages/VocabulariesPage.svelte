<script lang="ts">
  import { VOCABULARIES } from "../data/registry";
  import { href } from "../lib/router.svelte";
</script>

<section>
  <p><a href={href({ name: "toc" })}>← Back to overview</a></p>
  <h1>External code lists</h1>
  <p>
    Named vocabularies referenced by <code>select_X_from_file &lt;vocab&gt;.csv</code> via the
    <code>concept/@vocab</code> convention.
  </p>
  {#each VOCABULARIES as v (v["@id"])}
    <div style="margin-bottom: 1.5rem;">
      <h3>{v["skos:prefLabel"]}</h3>
      <dl class="kv-table">
        <dt>XLSForm filename</dt><dd><code>{v.xlsformFilename}</code></dd>
        <dt>DDI <code>vocab</code></dt><dd><code>{v.ddiVocab}</code></dd>
        <dt>Standard</dt><dd>{v.standard}</dd>
        <dt>URI</dt><dd><a href={v.vocabURI} target="_blank" rel="noopener">{v.vocabURI}</a></dd>
        {#if v.description}<dt>Notes</dt><dd>{v.description}</dd>{/if}
      </dl>
    </div>
  {/each}
</section>
