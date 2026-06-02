import { useState } from "react";
import { Form } from "react-router";
import { Star } from "lucide-react";
import { cn } from "~/lib/utils";

const STARS = [1, 2, 3, 4, 5];

/**
 * Read-only average rating display. Shown everywhere a course appears.
 * Renders five stars filled to the rounded average, plus "4.5 (12)".
 */
export function StarRatingDisplay({
  average,
  count,
  className,
}: {
  average: number | null;
  count: number;
  className?: string;
}) {
  if (count === 0 || average === null) {
    return (
      <span className={cn("text-xs text-muted-foreground", className)}>
        No ratings yet
      </span>
    );
  }

  const rounded = Math.round(average);

  return (
    <span
      className={cn("flex items-center gap-1", className)}
      aria-label={`Rated ${average.toFixed(1)} out of 5 from ${count} ${
        count === 1 ? "review" : "reviews"
      }`}
    >
      <span className="flex">
        {STARS.map((star) => (
          <Star
            key={star}
            className={cn(
              "size-3.5",
              star <= rounded
                ? "fill-yellow-400 text-yellow-400"
                : "fill-none text-muted-foreground/40"
            )}
          />
        ))}
      </span>
      <span className="text-xs text-muted-foreground">
        {average.toFixed(1)} ({count})
      </span>
    </span>
  );
}

/**
 * Interactive 1–5 star input for students who completed the course.
 * Each star is a submit button posting to /courses/:slug/rate, so it works
 * without client JS; hover preview is a progressive enhancement.
 */
export function StarRatingInput({
  slug,
  currentRating,
  className,
}: {
  slug: string;
  currentRating?: number | null;
  className?: string;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const active = hovered ?? currentRating ?? 0;

  return (
    <Form
      method="post"
      action={`/courses/${slug}/rate`}
      className={cn("flex items-center gap-2", className)}
      onMouseLeave={() => setHovered(null)}
    >
      <span className="flex items-center">
        {STARS.map((star) => (
          <button
            key={star}
            type="submit"
            name="rating"
            value={star}
            onMouseEnter={() => setHovered(star)}
            aria-label={`Rate ${star} ${star === 1 ? "star" : "stars"}`}
            className="rounded p-0.5 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Star
              className={cn(
                "size-5",
                star <= active
                  ? "fill-yellow-400 text-yellow-400"
                  : "fill-none text-muted-foreground/40"
              )}
            />
          </button>
        ))}
      </span>
      {currentRating ? (
        <span className="text-xs text-muted-foreground">Your rating</span>
      ) : (
        <span className="text-xs text-muted-foreground">Rate this course</span>
      )}
    </Form>
  );
}
