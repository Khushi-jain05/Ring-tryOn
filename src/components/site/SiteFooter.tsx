import Link from "next/link";

const GROUPS = [
  {
    title: "Shop",
    links: [
      { href: "/rings", label: "All rings" },
      { href: "/necklaces", label: "Necklaces" },
      { href: "/rings?collection=Bridal", label: "Bridal" },
      { href: "/rings?collection=Everyday", label: "Everyday" },
      { href: "/rings?collection=Colour", label: "Coloured stones" },
    ],
  },
  {
    title: "Fit",
    links: [
      { href: "/try-on", label: "Virtual try-on" },
      { href: "/size-guide", label: "Find your size" },
      { href: "/size-guide#resizing", label: "Resizing" },
    ],
  },
  {
    title: "About",
    links: [
      { href: "/about", label: "How try-on works" },
      { href: "/about#privacy", label: "Privacy" },
      { href: "/about#materials", label: "Materials" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-line/70 bg-surface-muted/40">
      <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="font-display text-lg uppercase tracking-[0.2em]">Aurelia</p>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-muted">
              Fine rings you can see on your own hand before you commit to one.
            </p>
          </div>

          {GROUPS.map((group) => (
            <div key={group.title}>
              <h3 className="text-xs font-medium uppercase tracking-[0.16em] text-muted">
                {group.title}
              </h3>
              <ul className="mt-4 space-y-2.5">
                {group.links.map((link) => (
                  <li key={link.href + link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-foreground/80 transition-colors hover:text-accent"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-line/70 pt-6 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
          <p>A demonstration storefront. Nothing here is for sale.</p>
          <p>Try-on runs on-device. No camera data is uploaded.</p>
        </div>
      </div>
    </footer>
  );
}
