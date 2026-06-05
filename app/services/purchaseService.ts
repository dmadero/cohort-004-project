import { eq, and } from "drizzle-orm";
import { db } from "~/db";
import { purchases } from "~/db/schema";
import { getOrCreateTeamForUser } from "./teamService";
import { generateCoupons } from "./couponService";

// ─── Purchase Service ───
// Handles purchase records (transaction log separate from enrollments).

export function createPurchase(opts: {
  userId: number;
  courseId: number;
  pricePaid: number;
  country: string | null;
}) {
  const { userId, courseId, pricePaid, country } = opts;
  return db
    .insert(purchases)
    .values({ userId, courseId, pricePaid, country })
    .returning()
    .get();
}

export function findPurchase(opts: { userId: number; courseId: number }) {
  const { userId, courseId } = opts;
  return db
    .select()
    .from(purchases)
    .where(and(eq(purchases.userId, userId), eq(purchases.courseId, courseId)))
    .get();
}

export function getPurchasesByUser(userId: number) {
  return db.select().from(purchases).where(eq(purchases.userId, userId)).all();
}

export function getPurchasesByCourse(courseId: number) {
  return db
    .select()
    .from(purchases)
    .where(eq(purchases.courseId, courseId))
    .all();
}

// ─── Team Purchase ───

export function createTeamPurchase(opts: {
  userId: number;
  courseId: number;
  pricePaid: number;
  country: string | null;
  quantity: number;
}) {
  const { userId, courseId, pricePaid, country, quantity } = opts;
  const purchase = createPurchase({ userId, courseId, pricePaid, country });
  const team = getOrCreateTeamForUser(userId);
  const coupons = generateCoupons({
    teamId: team.id,
    courseId,
    purchaseId: purchase.id,
    quantity,
  });
  return { purchase, team, coupons };
}
