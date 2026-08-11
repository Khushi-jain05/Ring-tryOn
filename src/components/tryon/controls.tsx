"use client";

import { useId, type ReactNode } from "react";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <span className="text-xs font-medium uppercase tracking-[0.14em] text-muted">
          {label}
        </span>
        {hint && <span className="text-xs">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export function Segmented({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid grid-flow-col gap-1 rounded-full border border-line p-1">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={`rounded-full px-3 py-1.5 text-xs transition ${
              active
                ? "bg-foreground text-background"
                : "text-muted hover:text-foreground"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (value: number) => string;
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-xs text-muted">
          {label}
        </label>
        <span className="text-xs tabular-nums">{format ? format(value) : value}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-full cursor-pointer appearance-none rounded-full bg-line accent-accent"
      />
    </div>
  );
}

export function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: () => void;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <label htmlFor={id} className="text-xs">
        {label}
        {hint && <span className="mt-0.5 block text-[11px] text-muted">{hint}</span>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={onChange}
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition ${
          checked ? "bg-accent" : "bg-line"
        }`}
      >
        <span
          className={`absolute top-0.5 size-4 rounded-full bg-surface shadow transition-all ${
            checked ? "left-[1.125rem]" : "left-0.5"
          }`}
        />
      </button>
    </div>
  );
}
