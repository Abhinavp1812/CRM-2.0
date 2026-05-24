import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Layout from "@/components/Layout";
import DangerZone from "@/components/DangerZone";

export default async function DangerPage() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") redirect("/");

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Danger Zone</h1>
        <p className="text-sm text-red-600 mt-0.5">
          These actions permanently delete data and cannot be undone. Super admin password is required.
        </p>
      </div>
      <DangerZone />
    </Layout>
  );
}
