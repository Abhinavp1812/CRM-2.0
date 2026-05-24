import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import * as XLSX from "xlsx";

export const maxDuration = 60;

export async function GET() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const [customers, followups, registrations, bookings] = await Promise.all([
    prisma.customer.findMany({
      where: { deletedAt: null },
      include: { owner: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.followup.findMany({
      include: { customer: { select: { name: true, phone: true, owner: { select: { name: true } } } } },
      orderBy: { nextFollowupDate: "asc" },
    }),
    prisma.registration.findMany({
      include: { customer: { select: { name: true, phone: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.booking.findMany({
      include: {
        customer: { select: { name: true, phone: true } },
        salon: { select: { name: true, city: true } },
      },
      orderBy: { bookingDate: "desc" },
    }),
  ]);

  const wb = XLSX.utils.book_new();

  // Sheet 1: Customers
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    customers.map((c) => ({
      Name: c.name || "",
      Phone: c.phone,
      City: c.city || "",
      Gender: c.gender || "",
      Type: c.customerType,
      Owner: c.owner?.name || "",
      "Do Not Contact": c.doNotContact ? "Yes" : "No",
      "DNC Reason": c.doNotContactReason || "",
      "External ID": c.customerIdExt || "",
      "Pending Owner": c.pendingOwnerName || "",
      "Created At": c.createdAt.toLocaleDateString("en-IN"),
    }))
  ), "Customers");

  // Sheet 2: Followups
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    followups.map((f) => ({
      "Customer Name": f.customer?.name || "",
      "Customer Phone": f.customer?.phone || "",
      "Owner": f.customer?.owner?.name || "",
      "Next Followup": new Date(f.nextFollowupDate).toLocaleDateString("en-IN"),
      "Current Remark": f.currentRemark || "",
      "Current Note": f.currentNote || "",
      "Last Contacted": f.lastContactedAt ? new Date(f.lastContactedAt).toLocaleDateString("en-IN") : "Never",
    }))
  ), "Followups");

  // Sheet 3: Registrations
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    registrations.map((r) => ({
      "Customer Name": r.customer?.name || "",
      "Customer Phone": r.customer?.phone || "",
      "External ID": r.customerIdExt || "",
      "Onboarding Date": r.onboardingDate ? new Date(r.onboardingDate).toLocaleDateString("en-IN") : "",
      "Imported At": new Date(r.createdAt).toLocaleDateString("en-IN"),
    }))
  ), "Registrations");

  // Sheet 4: Bookings
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    bookings.map((b) => ({
      "Customer Name": b.customer?.name || "",
      "Customer Phone": b.customer?.phone || "",
      "Order No": b.orderNo || "",
      "Booking Date": b.bookingDate ? new Date(b.bookingDate).toLocaleDateString("en-IN") : "",
      "Salon": b.salon?.name || b.salonNameSnapshot || "",
      "City": b.salon?.city || b.city || "",
      "Status": b.status || "",
      "Payment Status": b.paymentStatus || "",
      "Grand Total": b.grandTotal ? Number(b.grandTotal) : "",
      "GST": b.gst ? Number(b.gst) : "",
      "Gross Amount": b.grossAmount ? Number(b.grossAmount) : "",
    }))
  ), "Bookings");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const date = new Date().toISOString().split("T")[0];

  return new Response(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="crm-export-${date}.xlsx"`,
    },
  });
}
