<script lang="ts">
  import type { RegistryEntry } from "../data/registry";

  interface Props { convention: RegistryEntry; }
  let { convention }: Props = $props();

  const slug = convention["@id"].split(":", 2)[1];
</script>

<article id={`convention-${slug}`} style="margin-bottom: 1.5rem;">
  <h3>{convention["skos:prefLabel"] ?? slug} <code>convention:{slug}</code></h3>
  {#if convention.rule}
    <pre>{JSON.stringify(convention.rule, null, 2)}</pre>
  {/if}
</article>
