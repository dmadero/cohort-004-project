import { Link } from "react-router";
import type { Route } from "./+types/instructor.analytics";
import {
  getCourseStats,
  getEnrollmentTrend,
  getOverviewStats,
  getRevenueTrend,
} from "~/services/analyticsService";
import { resolveDateRange } from "~/lib/date-range";
import { RangeSelector } from "~/components/range-selector";
import { TrendChart } from "~/components/trend-chart";
import { getCurrentUserId } from "~/lib/session";
import { getUserById } from "~/services/userService";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { CourseStatusBadge } from "~/components/course-status-badge";
import { formatPrice } from "~/lib/utils";
import {
  AlertTriangle,
  ChartColumn,
  DollarSign,
  Plus,
  TrendingUp,
  Trophy,
  Users,
} from "lucide-react";
import { data, isRouteErrorResponse } from "react-router";
import { UserRole } from "~/db/schema";

export function meta() {
  return [
    { title: "Analytics — Cadence" },
    { name: "description", content: "Performance across all your courses" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("Select a user from the DevUI panel to view your analytics.", {
      status: 401,
    });
  }

  const user = getUserById(currentUserId);

  if (!user || user.role !== UserRole.Instructor) {
    throw data("Only instructors can access this page.", {
      status: 403,
    });
  }

  // Period KPIs follow the URL range; the comparison table and top-courses
  // ranking are structural and stay all-time (PRD time-filtering rules).
  const now = new Date();
  const dateRange = resolveDateRange({
    range: new URL(request.url).searchParams.get("range"),
    now,
  });
  const trendOptions = {
    instructorId: currentUserId,
    since: dateRange.since,
    until: now.toISOString(),
    granularity: dateRange.granularity,
  };

  return {
    dateRange,
    stats: getOverviewStats({
      instructorId: currentUserId,
      since: dateRange.since,
    }),
    courses: getCourseStats({ instructorId: currentUserId }),
    enrollmentTrend: getEnrollmentTrend(trendOptions),
    revenueTrend: getRevenueTrend(trendOptions),
  };
}

function formatCompletionRate(rate: number | null) {
  if (rate === null) return "—";
  return `${Math.round(rate * 100)}%`;
}

/** Unlike formatPrice, zero renders "$0.00" — a bucket with no sales isn't "Free". */
function formatEarnings(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function HydrateFallback() {
  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <div className="mb-8">
        <Skeleton className="h-9 w-40" />
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
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-5 w-40" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-64 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card className="mt-8">
        <CardHeader>
          <Skeleton className="h-5 w-44" />
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

export default function InstructorAnalytics({
  loaderData,
}: Route.ComponentProps) {
  const { stats, courses, dateRange, enrollmentTrend, revenueTrend } =
    loaderData;

  // Courses arrive ranked by revenue, so the head of the list IS the ranking.
  const topCourses = courses
    .filter((course) => course.grossEarningsCents > 0)
    .slice(0, 5);

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      {/* Breadcrumb */}
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Analytics</span>
      </nav>

      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Analytics</h1>
          <p className="mt-1 text-muted-foreground">
            Performance across all your courses
          </p>
        </div>
        {stats.courseCount > 0 && <RangeSelector value={dateRange.range} />}
      </div>

      {stats.courseCount === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <ChartColumn className="mb-4 size-12 text-muted-foreground/50" />
          <h2 className="text-lg font-medium">No analytics yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Create your first course to start tracking enrollments and revenue.
          </p>
          <Link to="/instructor/new" className="mt-4">
            <Button>
              <Plus className="mr-2 size-4" />
              Create Course
            </Button>
          </Link>
        </div>
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total Enrollments
                </CardTitle>
                <Users className="size-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{stats.totalEnrollments}</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {dateRange.label}, across {stats.courseCount}{" "}
                  {stats.courseCount === 1 ? "course" : "courses"}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Gross Earnings
                </CardTitle>
                <DollarSign className="size-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">
                  {formatPrice(stats.grossEarningsCents)}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {dateRange.label}, before any fees
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Avg. Revenue / Student
                </CardTitle>
                <TrendingUp className="size-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">
                  {stats.avgRevenuePerStudentCents === null
                    ? "—"
                    : formatPrice(stats.avgRevenuePerStudentCents)}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Blended: earnings ÷ all enrollments,{" "}
                  {dateRange.label.toLowerCase()}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Trend charts — buckets follow the range's granularity */}
          <div className="mt-8 grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Enrollment Trend{" "}
                  <span className="font-normal text-muted-foreground">
                    · {dateRange.label.toLowerCase()}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <TrendChart
                  points={enrollmentTrend}
                  granularity={dateRange.granularity}
                  label="Enrollments"
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Revenue Trend{" "}
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
          </div>

          {/* Top courses by revenue */}
          <Card className="mt-8">
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">
                Top Courses by Revenue{" "}
                <span className="font-normal text-muted-foreground">
                  · all time
                </span>
              </CardTitle>
              <Trophy className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {topCourses.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  No revenue yet — sales will rank your courses here.
                </p>
              ) : (
                <ol className="divide-y divide-border">
                  {topCourses.map((course, i) => (
                    <li
                      key={course.courseId}
                      className="flex items-center gap-4 py-3"
                    >
                      <span className="w-6 text-center text-sm font-semibold text-muted-foreground">
                        {i + 1}
                      </span>
                      <span className="flex-1 truncate text-sm font-medium">
                        {course.title}
                      </span>
                      <span className="text-sm font-semibold">
                        {formatPrice(course.grossEarningsCents)}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>

          {/* Course comparison table */}
          <Card className="mt-8">
            <CardHeader>
              <CardTitle className="text-base">
                Course Comparison{" "}
                <span className="font-normal text-muted-foreground">
                  · all time
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Course
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Status
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Enrollments
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Earnings
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Completion
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {courses.map((course) => (
                    <tr
                      key={course.courseId}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium">{course.title}</p>
                      </td>
                      <td className="px-4 py-3">
                        <CourseStatusBadge status={course.status} />
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-muted-foreground">
                        {course.enrollmentCount}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-muted-foreground">
                        {formatPrice(course.grossEarningsCents)}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-muted-foreground">
                        {formatCompletionRate(course.completionRate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading your analytics.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
      title = "Sign in required";
      message = typeof error.data === "string" ? error.data : "Please select a user from the DevUI panel.";
    } else if (error.status === 403) {
      title = "Access denied";
      message = typeof error.data === "string" ? error.data : "You don't have permission to access this page.";
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
          <Link to="/instructor">
            <Button variant="outline">My Courses</Button>
          </Link>
          <Link to="/">
            <Button>Go Home</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
