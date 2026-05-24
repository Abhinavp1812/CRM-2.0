import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { password, target } = await req.json();

  const superAdminPassword = process.env.SUPER_ADMIN_PASSWORD;
  if (!superAdminPassword || password !== superAdminPassword) {
    return NextResponse.json({ error: "Incorrect super admin password" }, { status: 403 });
  }

  if (!["registrations", "bookings", "both", "customers"].includes(target)) {
    return NextResponse.json({ error: "Invalid target" }, { status: 400 });
  }

  let deletedRegistrations = 0;
  let deletedBookings = 0;
  let deletedCustomers = 0;

  if (target === "customers") {
    // Cascade deletes followups, activity logs, registrations, bookings
    const result = await prisma.customer.deleteMany({});
    deletedCustomers = result.count;
  } else {
    if (target === "registrations" || target === "both") {
      const result = await prisma.registration.deleteMany({});
      deletedRegistrations = result.count;
    }
    if (target === "bookings" || target === "both") {
      const result = await prisma.booking.deleteMany({});
      deletedBookings = result.count;
    }
  }

  return NextResponse.json({ success: true, deletedRegistrations, deletedBookings, deletedCustomers });
}
