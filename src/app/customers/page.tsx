import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Layout from "@/components/Layout";
import CustomersBrowser, { type CustomersSearchParams } from "@/components/CustomersBrowser";

export const dynamic = "force-dynamic";

export default async function CustomersPage({ searchParams }: { searchParams: Promise<CustomersSearchParams> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const isAdmin = session.user.role === "ADMIN";

  return (
    <Layout>
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-gray-900">{isAdmin ? "All Customers" : "My Customers"}</h1>
      </div>
      <CustomersBrowser
        params={await searchParams}
        basePath="/customers"
        isAdmin={isAdmin}
        restrictToOwnerId={isAdmin ? undefined : session.user.id}
      />
    </Layout>
  );
}
