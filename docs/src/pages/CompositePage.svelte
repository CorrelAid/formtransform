<script lang="ts">
  import { COMPOSITES } from "../data/registry";
  import { href } from "../lib/router.svelte";
  import CompositeCard from "../components/CompositeCard.svelte";
  import AnnotatedQuestion from "../components/AnnotatedQuestion.svelte";

  interface Props { slug: string; }
  let { slug }: Props = $props();

  const entry = $derived(
    COMPOSITES.find(c => c["@id"].split(":", 2)[1] === slug) ?? null
  );

  const COMPOSITE_KIND_MAP: Record<string, string> = {
    grid: "matrix",
  };
  const illustrationKind = $derived(COMPOSITE_KIND_MAP[slug] ?? null);
</script>

<section>
  <p><a href={href({ name: "toc" })}>← Back to overview</a></p>
  {#if entry}
    <CompositeCard composite={entry} />
    {#if illustrationKind}
      <h4>Illustration</h4>
      <AnnotatedQuestion kind={illustrationKind as any} />
    {/if}
  {:else}
    <h1>Not found</h1>
    <p>No composite with slug <code>{slug}</code>.</p>
  {/if}
</section>
