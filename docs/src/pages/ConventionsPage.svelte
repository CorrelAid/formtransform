<script lang="ts">
  import { CONVENTIONS } from "../data/registry";
  import { href } from "../lib/router.svelte";
  import ConventionCard from "../components/ConventionCard.svelte";
</script>

<section>
  <p><a href={href({ name: "toc" })}>← Back to overview</a></p>
  <h1>Conventions</h1>
  <p>
    Cross-cutting rules that don't fit per-type metadata. Codegen emits these to
    <code>generated/conventions.json</code> for downstream consumers.
  </p>
  {#each CONVENTIONS as conv (conv["@id"])}
    <ConventionCard convention={conv} />
  {/each}
</section>
