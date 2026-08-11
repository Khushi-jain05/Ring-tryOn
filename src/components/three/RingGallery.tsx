"use client";

import { createContext, useContext, useRef, type ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import { PerspectiveCamera, View } from "@react-three/drei";
import { ACESFilmicToneMapping } from "three";
import type { MetalId, Ring } from "@/lib/rings/types";
import { RingStage } from "./RingStage";

/**
 * A catalogue page wants a live 3D ring in every card, but a browser will only
 * hand out a dozen or so WebGL contexts before it starts silently killing the
 * oldest ones — a twelve-card grid is already at the edge.
 *
 * `View` solves it by scissor-rendering many viewports out of a single canvas
 * that sits fixed behind the page. Each card contributes a tracked rectangle;
 * one context serves the whole grid.
 */
const GalleryContext = createContext(false);

export function RingGallery({ children }: { children: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <GalleryContext.Provider value>
      <div ref={containerRef} className="relative">
        {children}
        <Canvas
          eventSource={containerRef as React.RefObject<HTMLElement>}
          className="pointer-events-none"
          style={{ position: "fixed", inset: 0, zIndex: 1 }}
          gl={{ antialias: true, alpha: true, toneMapping: ACESFilmicToneMapping }}
          dpr={[1, 2]}
        >
          <View.Port />
        </Canvas>
      </div>
    </GalleryContext.Provider>
  );
}

/**
 * One ring, rendered into the shared canvas at this element's position.
 * Falls back to nothing outside a `RingGallery`, so a card can be reused in a
 * static context without crashing.
 */
export function RingThumb({
  ring,
  metal,
  className,
  autoRotate = false,
}: {
  ring: Ring;
  metal: MetalId;
  className?: string;
  autoRotate?: boolean;
}) {
  const inGallery = useContext(GalleryContext);
  if (!inGallery) return <div className={className} />;

  return (
    <View className={className}>
      <PerspectiveCamera makeDefault fov={30} position={[0, 0.35, 6.4]} />
      <RingStage ring={ring} metal={metal} quality="showcase" autoRotate={autoRotate} />
    </View>
  );
}
