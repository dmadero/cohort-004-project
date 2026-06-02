import { redirect, data } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/courses.$slug.rate";
import { getCourseBySlug } from "~/services/courseService";
import { upsertReview } from "~/services/reviewService";
import { getCurrentUserId } from "~/lib/session";
import { parseFormData } from "~/lib/validation";

const rateActionSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
});

// Resource route — submit a 1–5 star rating for a completed course.
// Both the course detail page and the dashboard post here, then the
// student is returned to wherever they came from.
export async function action({ params, request }: Route.ActionArgs) {
  const slug = params.slug;

  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw redirect(`/login?redirectTo=${encodeURIComponent(`/courses/${slug}`)}`);
  }

  const course = getCourseBySlug(slug);
  if (!course) {
    throw data("Course not found.", { status: 404 });
  }

  const formData = await request.formData();
  const parsed = parseFormData(formData, rateActionSchema);
  if (!parsed.success) {
    throw data("Invalid rating.", { status: 400 });
  }

  // upsertReview enforces that the student has completed the course.
  upsertReview(currentUserId, course.id, parsed.data.rating);

  const referer = request.headers.get("Referer");
  return redirect(referer ?? `/courses/${slug}`);
}
