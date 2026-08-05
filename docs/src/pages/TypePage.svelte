<script lang="ts">
  import { QUESTION_TYPES, STRUCTURAL_TYPES } from "../data/registry";
  import { href } from "../lib/router.svelte";
  import TypeCard from "../components/TypeCard.svelte";

  interface Props { slug: string; }
  let { slug }: Props = $props();

  const entry = $derived(
    [...QUESTION_TYPES, ...STRUCTURAL_TYPES].find(
      e => (e.xlsform?.typeString ?? e["@id"].split(":", 2)[1]) === slug
    ) ?? null
  );
</script>

<section>
  <p><a href={href({ name: "toc" })}>← Back to overview</a></p>
  {#if entry}
    <TypeCard type={entry} />
  {:else}
    <h1>Not found</h1>
    <p>No type with slug <code>{slug}</code>.</p>
  {/if}
</section>
