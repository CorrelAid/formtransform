// Tiny hash router. URL shapes:
//   #/                       → TocPage
//   #/type/<slug>            → TypePage(slug)
//   #/composite/<slug>       → CompositePage(slug)
//   #/conventions            → ConventionsPage
//   #/vocabularies           → VocabulariesPage
//
// Exposes a reactive `route` object using Svelte 5 runes.

export type Route =
  | { name: "toc" }
  | { name: "type"; slug: string }
  | { name: "composite"; slug: string }
  | { name: "conventions" }
  | { name: "vocabularies" }
  | { name: "not_found"; raw: string };

function parse(hash: string): Route {
  const trimmed = hash.replace(/^#\/?/, "").trim();
  if (!trimmed) return { name: "toc" };
  const [head, ...rest] = trimmed.split("/");
  if (head === "type" && rest[0]) return { name: "type", slug: rest[0] };
  if (head === "composite" && rest[0]) return { name: "composite", slug: rest[0] };
  if (head === "conventions") return { name: "conventions" };
  if (head === "vocabularies") return { name: "vocabularies" };
  return { name: "not_found", raw: trimmed };
}

class Router {
  current = $state<Route>(parse(typeof window === "undefined" ? "" : window.location.hash));

  start() {
    if (typeof window === "undefined") return;
    const update = () => { this.current = parse(window.location.hash); };
    window.addEventListener("hashchange", update);
    // Scroll to top on navigation
    window.addEventListener("hashchange", () => window.scrollTo({ top: 0 }));
    update();
  }
}

export const router = new Router();

export function href(route: Route): string {
  switch (route.name) {
    case "toc": return "#/";
    case "type": return `#/type/${route.slug}`;
    case "composite": return `#/composite/${route.slug}`;
    case "conventions": return "#/conventions";
    case "vocabularies": return "#/vocabularies";
    case "not_found": return `#/${route.raw}`;
  }
}
