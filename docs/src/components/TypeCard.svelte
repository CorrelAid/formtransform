<script lang="ts">
  import type { RegistryEntry } from "../data/registry";
  import { variantsForType } from "../data/registry";
  import VariantBlock from "./VariantBlock.svelte";

  interface Props { type: RegistryEntry; }
  let { type }: Props = $props();

  const slug = type.xlsform?.typeString ?? type["@id"].split(":", 2)[1];
  const variants = variantsForType(type["@id"]);
  const ls = type.limesurvey ?? {};
  const ddi = (type.ddi ?? {}) as Record<string, string>;
</script>

<article id={`type-${slug}`} style="margin-bottom: 2rem; padding-bottom: 1rem; border-bottom: 1px solid color-mix(in srgb, var(--color-text-primary) 8%, transparent);">
  <h3>
    {type["skos:prefLabel"] ?? slug}
    <code>{slug}</code>
  </h3>

  {#if type.useWhen}
    <p class="use-when"><strong>Use when:</strong> {type.useWhen}</p>
  {/if}

  <dl class="kv-table">
    <dt>XLSForm</dt><dd><code>{slug}</code>{#if type.xlsform?.aliases?.length} · aliases: {#each type.xlsform.aliases as a}<code>{a}</code>{' '}{/each}{/if}</dd>
    <dt>LimeSurvey</dt><dd>type code <code>{ls.typeCode ?? "—"}</code>{#if ls.supportsOther} · supports <code>or_other</code>{/if}{#if ls.answerClass} · answer class <code>{ls.answerClass}</code>{/if}</dd>
    <dt>DDI</dt><dd>
      {#if ddi.intrvl}<code>intrvl={ddi.intrvl}</code>{/if}
      {#if ddi.formatType}{' '}<code>varFormat/@type={ddi.formatType}</code>{/if}
      {#if ddi.responseDomainType}{' '}<code>responseDomainType={ddi.responseDomainType}</code>{/if}
    </dd>
  </dl>

  {#if variants.length}
    <h4 style="margin-top: 1rem;">Variants ({variants.length})</h4>
    {#each variants as v (v.slug)}
      <VariantBlock variant={v} />
    {/each}
  {/if}
</article>

<style>
  .use-when {
    margin: 0.25rem 0 0.75rem;
    color: color-mix(in srgb, var(--color-text-primary) 80%, transparent);
  }
</style>
