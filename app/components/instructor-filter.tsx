import { useSearchParams } from "react-router";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import type { PlatformInstructor } from "~/services/analyticsService";

/** Sentinel for "no instructor filter" — Radix Select can't hold an empty value. */
const ALL = "all";

/**
 * Dropdown for the admin course-breakdown `?instructor=` URL param. The URL is
 * the source of truth so the loader filters server-side; selecting an
 * instructor rewrites the param (and drops it for "All Instructors"). `value`
 * is the loader-resolved instructor id, or null when unfiltered.
 */
export function InstructorFilter({
  instructors,
  value,
}: {
  instructors: PlatformInstructor[];
  value: number | null;
}) {
  const [, setSearchParams] = useSearchParams();

  return (
    <Select
      value={value === null ? ALL : String(value)}
      onValueChange={(next) =>
        setSearchParams(
          (prev) => {
            const params = new URLSearchParams(prev);
            if (next === ALL) {
              params.delete("instructor");
            } else {
              params.set("instructor", next);
            }
            return params;
          },
          { preventScrollReset: true }
        )
      }
    >
      <SelectTrigger className="w-56" aria-label="Filter by instructor">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>All Instructors</SelectItem>
        {instructors.map((instructor) => (
          <SelectItem key={instructor.id} value={String(instructor.id)}>
            {instructor.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
