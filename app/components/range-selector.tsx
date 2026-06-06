import { useSearchParams } from "react-router";
import { RANGE_OPTIONS, type RangePreset } from "~/lib/date-range";
import { cn } from "~/lib/utils";

/**
 * Segmented control for the analytics `?range=` URL param. The URL is the
 * source of truth (shareable, bookmarkable, survives reload); selecting a
 * preset rewrites the param and lets the route loader re-query. `value` is
 * the loader-resolved preset so an invalid param highlights the default.
 */
export function RangeSelector({ value }: { value: RangePreset }) {
  const [, setSearchParams] = useSearchParams();

  return (
    <div
      role="group"
      aria-label="Time range"
      className="inline-flex h-9 items-center rounded-lg bg-muted p-1"
    >
      {RANGE_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          aria-label={option.label}
          onClick={() =>
            setSearchParams(
              (prev) => {
                const next = new URLSearchParams(prev);
                next.set("range", option.value);
                return next;
              },
              { preventScrollReset: true }
            )
          }
          className={cn(
            "rounded-md px-2.5 py-1 text-sm font-medium transition-colors",
            option.value === value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {option.shortLabel}
        </button>
      ))}
    </div>
  );
}
