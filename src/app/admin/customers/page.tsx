import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import Layout from "@/components/Layout";
import CustomersBrowser, { type CustomersSearchParams } from "@/components/CustomersBrowser";

export const dynamic = "force-dynamic";

export default async function AdminCustomersPage({ searchParams }: { searchParams: Promise<CustomersSearchParams> }) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") redirect("/");

  return (
    <Layout>
      <main className="min-h-screen bg-gray-50 py-6">
        <div className="max-w-7xl mx-auto px-4">
          <Link href="/admin" className="text-sm text-gray-600 hover:text-gray-900">
            Back to Admin
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-2 mb-4">All Customers</h1>
          <CustomersBrowser params={await searchParams} basePath="/admin/customers" isAdmin />
        </div>
      </main>
    </Layout>
  );
}
