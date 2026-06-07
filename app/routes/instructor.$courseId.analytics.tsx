import { Link } from "react-router";
import type { Route } from "./+types/instructor.$courseId.analytics";
import {
  getCompletionTrend,
  getCourseFunnel,
  getLessonFunnel,
} from "~/services/analyticsService";
import { getCourseById } from "~/services/courseService";
import { resolveDateRange } from "~/lib/date-range";
import { RangeSelector } from "~/components/range-selector";
import { TrendChart } from "~/components/trend-chart";
import { FunnelChart } from "~/components/funnel-chart";
import { LessonDropoffFunnel } from "~/components/lesson-dropoff-funnel";
import { getCurrentUserId } from "~/lib/session";
import { getUserById } from "~/services/userService";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { CourseStatusBadge } from "~/components/course-status-badge";
import { AlertTriangle, ArrowLeft, Users } from "lucide-react";
import { data, isRouteErrorResponse } from "react-router";
import { UserRole } from "~/db/schema";

export function meta({ data: loaderData }: Route.MetaArgs) {
  const title = loaderData?.course?.title ?? "Course Analytics";
  return [
    { title: `Analytics: ${title} — Cadence` },
    { name: "description", content: `Performance analytics for ${title}` },
  ];
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("Select a user from the DevUI panel to view course analytics.", {
      status: 401,
    });
  }

  const user = getUserById(currentUserId);

  if (!user || user.role !== UserRole.Instructor) {
    throw data("Only instructors can access this page.", {
      status: 403,
    });
  }

  const courseId = parseInt(params.courseId, 10);
  if (isNaN(courseId)) {
    throw data("Invalid course ID.", { status: 400 });
  }

  const course = getCourseById(courseId);

  if (!course) {
    throw data("Course not found.", { status: 404 });
  }

  if (course.instructorId !== currentUserId) {
    throw data("You can only view analytics for your own courses.", {
      status: 403,
    });
  }

  // The funnel is structural (all-time per the PRD); only the completion
  // trend follows the URL range.
  const now = new Date();
  const dateRange = resolveDateRange({
    range: new URL(request.url).searchParams.get("range"),
    now,
  });

  return {
    course,
    dateRange,
    funnel: getCourseFunnel({ courseId }),
    // Structural like the course funnel — all-time, ignores the URL range.
    lessonFunnel: getLessonFunnel({ courseId }),
    completionTrend: getCompletionTrend({
      courseId,
      since: dateRange.since,
      until: now.toISOString(),
      granularity: dateRange.granularity,
    }),
  };
}

export function HydrateFallback() {
  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <div className="mb-8">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="mt-2 h-5 w-48" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-5 w-44" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-64 w-full" />
            </CardContent>
          </Card>
        ))}
        <Card className="lg:col-span-2">
          <CardHeader>
            <Skeleton className="h-5 w-44" />
          </CardHeader>
          <CardContent className="space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function CourseAnalytics({ loaderData }: Route.ComponentProps) {
  const { course, dateRange, funnel, lessonFunnel, completionTrend } =
    loaderData;

  const neverStartedCount = funnel.enrolledCount - funnel.startedCount;
  const inProgressCount = funnel.startedCount - funnel.completedCount;

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      {/* Breadcrumb */}
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <Link to="/instructor/analytics" className="hover:text-foreground">
          Analytics
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">{course.title}</span>
      </nav>

      <Link
        to="/instructor/analytics"
        className="mb-4 inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="mr-1 size-4" />
        Back to Analytics
      </Link>

      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold">{course.title}</h1>
            <CourseStatusBadge status={course.status} />
          </div>
          <p className="mt-1 text-muted-foreground">
            How students move through this course
          </p>
        </div>
        {funnel.enrolledCount > 0 && <RangeSelector value={dateRange.range} />}
      </div>

      {funnel.enrolledCount === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Users className="mb-4 size-12 text-muted-foreground/50" />
          <h2 className="text-lg font-medium">No students yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Once students enroll, their progress through the course shows up
            here.
          </p>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Enrolled → started → completed funnel */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Student Progress Funnel{" "}
                <span className="font-normal text-muted-foreground">
                  · all time
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <FunnelChart
                stages={[
                  { label: "Enrolled", count: funnel.enrolledCount },
                  { label: "Started", count: funnel.startedCount },
                  { label: "Completed", count: funnel.completedCount },
                ]}
              />
              <p className="mt-4 text-xs text-muted-foreground">
                {neverStartedCount} never started · {inProgressCount} started
                but unfinished · {funnel.completedCount} completed
              </p>
            </CardContent>
          </Card>

          {/* Completion trend — buckets follow the range's granularity */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Completion Trend{" "}
                <span className="font-normal text-muted-foreground">
                  · {dateRange.label.toLowerCase()}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <TrendChart
                points={completionTrend}
                granularity={dateRange.granularity}
                label="Completions"
              />
            </CardContent>
          </Card>

          {/* Lesson drop-off funnel — structural, all-time */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">
                Lesson Drop-off{" "}
                <span className="font-normal text-muted-foreground">
                  · all time
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {lessonFunnel.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  This course has no lessons yet — add content to see where
                  students drop off.
                </p>
              ) : lessonFunnel.every((step) => step.completedCount === 0) ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No lesson completions yet. Once students finish lessons, the
                  drop-off funnel shows up here.
                </p>
              ) : (
                <LessonDropoffFunnel
                  steps={lessonFunnel}
                  enrolledCount={funnel.enrolledCount}
                />
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading course analytics.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      title = "Course not found";
      message =
        "The course you're looking for doesn't exist or may have been removed.";
    } else if (error.status === 401) {
      title = "Sign in required";
      message =
        typeof error.data === "string"
          ? error.data
          : "Please select a user from the DevUI panel.";
    } else if (error.status === 403) {
      title = "Access denied";
      message =
        typeof error.data === "string"
          ? error.data
          : "You don't have permission to view these analytics.";
    } else {
      title = `Error ${error.status}`;
      message = typeof error.data === "string" ? error.data : error.statusText;
    }
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <div className="flex items-center justify-center gap-3">
          <Link to="/instructor/analytics">
            <Button variant="outline">Analytics</Button>
          </Link>
          <Link to="/">
            <Button>Go Home</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
