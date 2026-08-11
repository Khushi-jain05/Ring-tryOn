import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GEMS, RINGS, getRing } from "@/lib/rings/catalog";
import { RingDetail } from "@/components/site/RingDetail";

export function generateStaticParams() {
  return RINGS.map((ring) => ({ id: ring.id }));
}

export async function generateMetadata({
  params,
}: PageProps<"/rings/[id]">): Promise<Metadata> {
  const { id } = await params;
  const ring = getRing(id);
  if (!ring) return { title: "Ring not found" };
  return {
    title: ring.name,
    description: ring.description,
  };
}

export default async function RingPage({ params }: PageProps<"/rings/[id]">) {
  const { id } = await params;
  const ring = getRing(id);
  if (!ring) notFound();

  const related = RINGS.filter(
    (r) => r.id !== ring.id && (r.collection === ring.collection || r.gem === ring.gem),
  ).slice(0, 3);

  const specs: [string, string][] = [
    ["Collection", ring.collection],
    ["Centre stone", GEMS[ring.gem].label],
    ...(ring.carat ? ([["Carat weight", `${ring.carat.toFixed(2)} ct`]] as [string, string][]) : []),
    ["Setting", titleCase(ring.design.setting)],
    ["Cut", titleCase(ring.design.gemCut)],
    ["Band profile", titleCase(ring.design.profile)],
    ...(ring.design.accentCount
      ? ([["Accent stones", String(ring.design.accentCount)]] as [string, string][])
      : []),
  ];

  return (
    <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8 lg:py-12">
      <nav className="mb-6 text-xs text-muted">
        <Link href="/rings" className="hover:text-foreground">
          Rings
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">{ring.name}</span>
      </nav>

      <RingDetail ring={ring} specs={specs} related={related} />
    </div>
  );
}

function titleCase(value: string): string {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
