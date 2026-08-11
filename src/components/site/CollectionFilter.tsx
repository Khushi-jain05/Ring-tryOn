import Link from "next/link";
import { COLLECTIONS } from "@/lib/rings/catalog";

export function CollectionFilter({ selected }: { selected: string | null }) {
  const options = [{ label: "Everything", value: null }, ...COLLECTIONS.map((c) => ({ label: c, value: c }))];

  return (
    <nav className="mt-8 flex flex-wrap gap-2" aria-label="Filter by collection">
      {options.map((option) => {
        const active = option.value === selected;
        return (
          <Link
            key={option.label}
            href={option.value ? `/rings?collection=${option.value}` : "/rings"}
            aria-current={active ? "page" : undefined}
            className={`rounded-full border px-4 py-2 text-xs transition ${
              active
                ? "border-foreground bg-foreground text-background"
                : "border-line text-muted hover:border-muted hover:text-foreground"
            }`}
          >
            {option.label}
          </Link>
        );
      })}
    </nav>
  );
}
