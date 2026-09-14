import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import Layout from "@/components/Layout";
import Link from "next/link";
import { formatDateIN } from "@/lib/formatDate";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page || "1", 10) || 1);
  const q = (params.q || "").trim();
  const isAdmin = session.user.role === "ADMIN";

  const where: Record<string, unknown> = { deletedAt: null };
  if (!isAdmin) where.ownerId = session.user.id;

  if (q.length >= 2) {
    const digitsOnly = q.replace(/\D/g, "");
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      ...(digitsOnly.length >= 4 ? [{ phone: { contains: digitsOnly } }] : []),
    ];
  }

  const [customers, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      include: {
        owner: { select: { name: true } },
        followup: { select: { nextFollowupDate: true, currentRemark: true } },
      },
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.customer.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{isAdmin ? "All Customers" : "My Customers"}</h1>
        <p className="text-sm text-gray-500 mt-0.5">{total.toLocaleString()} customers</p>
      </div>

      <form action="/customers" className="mb-4 flex gap-2">
        <input
          name="q"
          type="text"
          defaultValue={q}
          placeholder="Search name or phone..."
          className="flex-1 max-w-md px-3 py-2 border border-gray-200 rounded-md text-sm"
        />
        <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700">
          Search
        </button>
      </form>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr className="text-left text-xs font-medium text-gray-700 uppercase">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">City</th>
                <th className="px-4 py-3">Type</th>
                {isAdmin && <th className="px-4 py-3">Owner</th>}
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Next Followup</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {customers.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{c.name ?? "(no name)"}</td>
                  <td className="px-4 py-3 font-mono text-gray-700">{c.phone}</td>
                  <td className="px-4 py-3 text-gray-600">{c.city ?? "-"}</td>
                  <td className="px-4 py-3">
                    <span className="inline-block px-1.5 py-0.5 text-xs bg-gray-100 text-gray-700 rounded">
                      {c.customerType === "CUSTOMER" ? "Booked" : "Registered"}
                    </span>
                  </td>
                  {isAdmin && <td className="px-4 py-3 text-gray-700">{c.owner?.name ?? "-"}</td>}
                  <td className="px-4 py-3">
                    {c.doNotContact ? (
                      <span className="inline-block px-1.5 py-0.5 text-xs bg-red-100 text-red-700 rounded">DNC</span>
                    ) : c.followup ? (
                      <span className="inline-block px-1.5 py-0.5 text-xs bg-green-100 text-green-700 rounded">Active</span>
                    ) : (
                      <span className="inline-block px-1.5 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">Closed</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {c.followup?.nextFollowupDate ? formatDateIN(c.followup.nextFollowupDate) : "-"}
                  </td>
                  <td className="px-4 py-3">
                    <Link href={"/customers/" + c.id} className="text-blue-600 hover:underline text-xs">Open</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 px-1">
          <p className="text-sm text-gray-600">Page {page} of {totalPages}</p>
          <div className="flex gap-2">
            <Link href={"/customers?page=" + Math.max(1, page - 1) + (q ? "&q=" + encodeURIComponent(q) : "")} className={"px-3 h-9 inline-flex items-center rounded text-sm " + (page === 1 ? "bg-gray-100 text-gray-400 pointer-events-none" : "bg-white border border-gray-200 hover:bg-gray-50 text-gray-700")}>Previous</Link>
            <Link href={"/customers?page=" + Math.min(totalPages, page + 1) + (q ? "&q=" + encodeURIComponent(q) : "")} className={"px-3 h-9 inline-flex items-center rounded text-sm " + (page === totalPages ? "bg-gray-100 text-gray-400 pointer-events-none" : "bg-white border border-gray-200 hover:bg-gray-50 text-gray-700")}>Next</Link>
          </div>
        </div>
      )}
    </Layout>
  );
}