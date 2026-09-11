import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// Each remark with its smart-default rules baked in.
// Day 2C agent UI uses these to enforce the "no customer falls through cracks" rule.
// Reduced to these 9 remarks (used together with the Hot/Warm/Cold lead-temperature
// label) - anything not on this list gets deactivated below, never deleted.
const REMARK_OPTIONS = [
  { label: "Potential (Makeup Artist)", defaultDaysAhead: 7,    autoFlagDnc: false, closesFollowup: false },
  { label: "Potential (Salon)",         defaultDaysAhead: 7,    autoFlagDnc: false, closesFollowup: false },
  { label: "Callback",                  defaultDaysAhead: 1,    autoFlagDnc: false, closesFollowup: false },
  { label: "Follow-up",                 defaultDaysAhead: 7,    autoFlagDnc: false, closesFollowup: false },
  { label: "Booked",                    defaultDaysAhead: 20,   autoFlagDnc: false, closesFollowup: false },
  { label: "Converted",                 defaultDaysAhead: null, autoFlagDnc: false, closesFollowup: true  },
  { label: "Not Interested",            defaultDaysAhead: null, autoFlagDnc: false, closesFollowup: true  },
  { label: "Not Connected",             defaultDaysAhead: 2,    autoFlagDnc: false, closesFollowup: false },
  { label: "Location Issue",            defaultDaysAhead: 7,    autoFlagDnc: false, closesFollowup: false },
];

const DEFAULT_SETTINGS: Record<string, string> = {
  // The +N day rule for completed bookings. Agents can override per-customer.
  bookingFollowupDays: "20",
  // Which booking statuses trigger an automatic follow-up schedule.
  // Comma-separated, case-insensitive. Per your decision: only "Completed".
  bookingFollowupStatuses: "Completed",
};

async function main() {
  // Admin user - must be set in .env, no fallbacks
  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword) throw new Error("SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set in .env");
  const adminHash = await bcrypt.hash(adminPassword, 10);
  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      name: "Admin",
      passwordHash: adminHash,
      role: "ADMIN",
    },
  });
  console.log(`✅ Admin seeded: ${adminEmail} (password: from env)`);

  console.log("ℹ️  Agents are created by admin via the Team page — none seeded here.");

  // Remark options with smart-default rules
  for (let i = 0; i < REMARK_OPTIONS.length; i++) {
    const r = REMARK_OPTIONS[i];
    await prisma.remarkOption.upsert({
      where: { label: r.label },
      update: {
        sortOrder: i,
        defaultDaysAhead: r.defaultDaysAhead,
        autoFlagDnc: r.autoFlagDnc,
        closesFollowup: r.closesFollowup,
        isActive: true,
      },
      create: {
        label: r.label,
        sortOrder: i,
        defaultDaysAhead: r.defaultDaysAhead,
        autoFlagDnc: r.autoFlagDnc,
        closesFollowup: r.closesFollowup,
      },
    });
  }
  const activeLabels = REMARK_OPTIONS.map((r) => r.label);
  const { count: deactivatedCount } = await prisma.remarkOption.updateMany({
    where: { label: { notIn: activeLabels }, isActive: true },
    data: { isActive: false },
  });
  console.log(`✅ ${REMARK_OPTIONS.length} remark options seeded (${deactivatedCount} old ones deactivated)`);

  // Settings
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await prisma.setting.upsert({
      where: { key },
      update: {},
      create: { key, value },
    });
  }
  console.log(`✅ ${Object.keys(DEFAULT_SETTINGS).length} settings seeded`);

  console.log("\n🎉 Seed complete.\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());