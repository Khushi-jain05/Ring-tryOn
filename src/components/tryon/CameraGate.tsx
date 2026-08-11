"use client";

import type { CameraState } from "./useCamera";

const COPY: Record<
  Exclude<CameraState, "ready">,
  { title: string; body: string; action: string | null }
> = {
  idle: {
    title: "Try it on your own hand",
    body: "We'll turn on your camera and place the ring on your finger in real time. Nothing is recorded, and no video leaves this device.",
    action: "Start camera",
  },
  starting: {
    title: "Waking up the camera",
    body: "Your browser will ask for permission. Choose Allow to continue.",
    action: null,
  },
  denied: {
    title: "Camera access is blocked",
    body: "Open the padlock in your address bar, allow camera access for this site, then try again.",
    action: "Try again",
  },
  error: {
    title: "The camera could not start",
    body: "Check that no other app is using it, then try again.",
    action: "Try again",
  },
};

export function CameraGate({
  state,
  error,
  onStart,
}: {
  state: Exclude<CameraState, "ready">;
  error: string | null;
  onStart: () => void;
}) {
  const copy = COPY[state];

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-neutral-950/92 px-6 backdrop-blur-sm">
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-5 flex size-12 items-center justify-center rounded-full border border-amber-200/30 bg-amber-200/10">
          <CameraIcon className="size-5 text-amber-200" />
        </div>
        <h2 className="font-display text-2xl text-neutral-50">{copy.title}</h2>
        <p className="mt-3 text-sm leading-relaxed text-neutral-400">
          {error ?? copy.body}
        </p>
        {copy.action && (
          <button
            type="button"
            onClick={onStart}
            className="mt-6 rounded-full bg-amber-200 px-6 py-2.5 text-sm font-medium text-neutral-950 transition hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-200"
          >
            {copy.action}
          </button>
        )}
        {state === "starting" && (
          <div className="mt-6 flex justify-center">
            <span className="size-5 animate-spin rounded-full border-2 border-neutral-700 border-t-amber-200" />
          </div>
        )}
        <p className="mt-6 text-xs text-neutral-600">
          Processing happens entirely in your browser.
        </p>
      </div>
    </div>
  );
}

function CameraIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.9a1 1 0 0 0 .83-.44l.74-1.12A1 1 0 0 1 9.8 4h4.4a1 1 0 0 1 .83.44l.74 1.12a1 1 0 0 0 .83.44h1.9A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-8Z" />
      <circle cx="12" cy="12.5" r="3.25" />
    </svg>
  );
}
