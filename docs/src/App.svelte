<script lang="ts">
  import { router, href } from "./lib/router.svelte";
  import TocPage from "./pages/TocPage.svelte";
  import TypePage from "./pages/TypePage.svelte";
  import CompositePage from "./pages/CompositePage.svelte";
  import ConventionsPage from "./pages/ConventionsPage.svelte";
  import VocabulariesPage from "./pages/VocabulariesPage.svelte";

  router.start();
  const r = $derived(router.current);
</script>

<header class="topbar">
  <a class="brand" href={href({ name: "toc" })}>CDL Survey Schema Registry</a>
  <nav class="topnav">
    <a href={href({ name: "toc" })}>Overview</a>
    <a href={href({ name: "conventions" })}>Conventions</a>
    <a href={href({ name: "vocabularies" })}>Vocabularies</a>
    <a href="https://github.com/CorrelAid/survey-type-registry" target="_blank" rel="noopener">GitHub</a>
  </nav>
</header>

<main class="page">
  {#if r.name === "toc"}
    <TocPage />
  {:else if r.name === "type"}
    <TypePage slug={r.slug} />
  {:else if r.name === "composite"}
    <CompositePage slug={r.slug} />
  {:else if r.name === "conventions"}
    <ConventionsPage />
  {:else if r.name === "vocabularies"}
    <VocabulariesPage />
  {:else}
    <section>
      <h1>Not found</h1>
      <p>Unknown route <code>{r.raw}</code>. <a href={href({ name: "toc" })}>Back to overview</a>.</p>
    </section>
  {/if}
</main>

<style>
  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--spacing-base, 1rem) var(--spacing-lg, 2rem);
    border-bottom: 1px solid color-mix(in srgb, var(--color-text-primary) 12%, transparent);
    background: var(--color-background, #fafafa);
    position: sticky;
    top: 0;
    z-index: 10;
  }
  .brand {
    color: var(--color-text-primary);
    font-weight: var(--font-weight-bold, 700);
    text-decoration: none;
  }
  .topnav {
    display: flex;
    gap: var(--spacing-base, 1rem);
  }
  .topnav a {
    color: var(--color-text-primary);
    text-decoration: none;
    opacity: 0.7;
  }
  .topnav a:hover {
    opacity: 1;
    text-decoration: underline;
  }
  .page {
    max-width: 1000px;
    margin: 0 auto;
    padding: var(--spacing-lg, 2rem);
  }
</style>
