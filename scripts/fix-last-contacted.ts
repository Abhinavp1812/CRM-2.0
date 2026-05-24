/**
 * One-time fix: restore lastContactedAt from real activity logs.
 *
 * The Combined Followups importer incorrectly set lastContactedAt = NOW()
 * for every customer with a remark. This script replaces that with the
 * date of the customer's most recent actual CALL_LOGGED or REMARK_ADDED
 * activity. Customers with no real activity get lastContactedAt = null.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Fetching most recent call/remark activity per customer...");

  // Get the most recent real contact activity per customer
  const activities = await prisma.activityLog.findMany({
    where: {
      activityType: { in: ["CALL_LOGGED", "REMARK_ADDED"] },
    },
    select: {
      customerId: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  // Build a map: customerId → most recent contact date
  const lastContact = new Map<string, Date>();
  for (const a of activities) {
    if (!lastContact.has(a.customerId)) {
      lastContact.set(a.customerId, a.createdAt);
    }
  }

  console.log(`Found ${lastContact.size} customers with real contact history.`);

  // Get all followups
  const followups = await prisma.followup.findMany({
    select: { customerId: true, lastContactedAt: true },
  });

  console.log(`Total followups: ${followups.length}`);

  let updated = 0;
  let alreadyNull = 0;
  let alreadyCorrect = 0;

  // Process in batches of 500
  const BATCH = 500;
  const all = followups;
  for (let i = 0; i < all.length; i += BATCH) {
    const batch = all.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async (f) => {
        const correctDate = lastContact.get(f.customerId) ?? null;
        const currentDate = f.lastContactedAt;

        // Skip if already correct
        if (
          (correctDate === null && currentDate === null) ||
          (correctDate && currentDate && correctDate.getTime() === currentDate.getTime())
        ) {
          if (currentDate === null) alreadyNull++;
          else alreadyCorrect++;
          return;
        }

        await prisma.followup.update({
          where: { customerId: f.customerId },
          data: { lastContactedAt: correctDate },
        });
        updated++;
      })
    );

    if (i % 2000 === 0) {
      console.log(`  Processed ${Math.min(i + BATCH, all.length)} / ${all.length}...`);
    }
  }

  console.log(`\nDone.`);
  console.log(`  Updated:          ${updated}`);
  console.log(`  Already null:     ${alreadyNull}`);
  console.log(`  Already correct:  ${alreadyCorrect}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
