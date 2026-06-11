import { Link } from "react-router";
import type { Route } from "./+types/admin.analytics";
import {
  getPlatformCourseBreakdown,
  getPlatformInstructors,
  getPlatformOverviewStats,
  getPlatformRevenueTrend,
} from "~/services/analyticsService";
import { resolveDateRange } from "~/lib/date-range";
import { RangeSelector } from "~/components/range-selector";
import { InstructorFilter } from "~/components/instructor-filter";
import { TrendChart } from "~/components/trend-chart";
import { getCurrentUserId } from "~/lib/session";
import { getUserById } from "~/services/userService";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { Button } from "~/components/ui/button";
import { formatPrice } from "~/lib/utils";
import {
  AlertTriangle,
  ChartColumn,
  DollarSign,
  Trophy,
  Users,
} from "lucide-react";
import { data, isRouteErrorResponse } from "react-router";
import { UserRole } from "~/db/schema";

export function meta() {
  return [
    { title: "Admin Analytics — Cadence" },
    {
      name: "description",
      content: "Platform-wide revenue and enrollment data",
    },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("Select a user from the DevUI panel to view admin analytics.", {
      status: 401,
    });
  }

  const currentUser = getUserById(currentUserId);

  if (!currentUser || currentUser.role !== UserRole.Admin) {
    throw data("Only admins can access this page.", {
      status: 403,
    });
  }

  const url = new URL(request.url);
  const now = new Date();
  const dateRange = resolveDateRange({
    range: url.searchParams.get("range"),
    now,
  });

  const stats = getPlatformOverviewStats({ since: dateRange.since });
  const revenueTrend = getPlatformRevenueTrend({
    since: dateRange.since,
    until: now.toISOString(),
    granularity: dateRange.granularity,
  });

  // Resolve the instructor filter against real instructors, so a stale or
  // bogus ?instructor= param falls back to "All Instructors" rather than
  // silently filtering every course away.
  const instructors = getPlatformInstructors();
  const requestedInstructorId = Number(url.searchParams.get("instructor"));
  const selectedInstructorId = instructors.some(
    (i) => i.id === requestedInstructorId
  )
    ? requestedInstructorId
    : null;

  const courseBreakdown = getPlatformCourseBreakdown({
    since: dateRange.since,
    instructorId: selectedInstructorId ?? undefined,
  });

  return {
    dateRange,
    stats,
    revenueTrend,
    instructors,
    selectedInstructorId,
    courseBreakdown,
  };
}

function formatRating(rating: number | null) {
  return rating === null ? "—" : rating.toFixed(1);
}

/** Unlike formatPrice, zero renders "$0.00" — a bucket with no sales isn't "Free". */
function formatEarnings(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function HydrateFallback() {
  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <div className="mb-8">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="mt-2 h-5 w-72" />
      </div>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-4 w-32" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-9 w-20" />
              <Skeleton className="mt-2 h-4 w-24" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default function AdminAnalytics({ loaderData }: Route.ComponentProps) {
  const {
    stats,
    dateRange,
    revenueTrend,
    instructors,
    selectedInstructorId,
    courseBreakdown,
  } = loaderData;

  const hasData = stats.totalRevenueCents > 0 || stats.totalEnrollments > 0;

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Admin Analytics</span>
      </nav>

      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Admin Analytics</h1>
          <p className="mt-1 text-muted-foreground">
            Platform-wide revenue and enrollment data
          </p>
        </div>
        <RangeSelector value={dateRange.range} />
      </div>

      {!hasData ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <ChartColumn className="mb-4 size-12 text-muted-foreground/50" />
          <h2 className="text-lg font-medium">No analytics yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Revenue and enrollment data will appear here once students start
            purchasing and enrolling in courses.
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total Revenue
                </CardTitle>
                <DollarSign className="size-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">
                  {formatPrice(stats.totalRevenueCents)}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {dateRange.label}, all courses
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total Enrollments
                </CardTitle>
                <Users className="size-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">
                  {stats.totalEnrollments}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {dateRange.label}, all courses
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Top Earning Course
                </CardTitle>
                <Trophy className="size-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {stats.topCourse ? (
                  <>
                    <div className="text-3xl font-bold">
                      {formatPrice(stats.topCourse.revenueCents)}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {stats.topCourse.title}
                    </p>
                  </>
                ) : (
                  <>
                    <div className="text-3xl font-bold">—</div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      No revenue yet
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="text-base">
                Revenue Over Time{" "}
                <span className="font-normal text-muted-foreground">
                  · {dateRange.label.toLowerCase()}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <TrendChart
                points={revenueTrend}
                granularity={dateRange.granularity}
                label="Revenue"
                formatValue={formatEarnings}
              />
            </CardContent>
          </Card>

          {/* Per-course breakdown — revenue/sales/enrollments follow the range;
              list price and rating are all-time */}
          <Card className="mt-6">
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
              <CardTitle className="text-base">
                Course Breakdown{" "}
                <span className="font-normal text-muted-foreground">
                  · {dateRange.label.toLowerCase()}
                </span>
              </CardTitle>
              <InstructorFilter
                instructors={instructors}
                value={selectedInstructorId}
              />
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              {courseBreakdown.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No courses to show.
                </p>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Course
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Instructor
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        List Price
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Revenue
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Sales
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Enrollments
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Rating
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {courseBreakdown.map((course) => (
                      <tr
                        key={course.courseId}
                        className="border-b border-border last:border-0"
                      >
                        <td className="px-4 py-3 text-sm font-medium">
                          {course.title}
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">
                          {course.instructorName}
                        </td>
                        <td className="px-4 py-3 text-right text-sm text-muted-foreground">
                          {formatPrice(course.listPriceCents)}
                        </td>
                        <td className="px-4 py-3 text-right text-sm text-muted-foreground">
                          {formatEarnings(course.revenueCents)}
                        </td>
                        <td className="px-4 py-3 text-right text-sm text-muted-foreground">
                          {course.salesCount}
                        </td>
                        <td className="px-4 py-3 text-right text-sm text-muted-foreground">
                          {course.enrollmentCount}
                        </td>
                        <td className="px-4 py-3 text-right text-sm text-muted-foreground">
                          {formatRating(course.avgRating)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading admin analytics.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
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
          : "Only admins can access this page.";
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
          <Link to="/">
            <Button>Go Home</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
