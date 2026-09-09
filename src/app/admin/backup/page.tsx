import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Layout from "@/components/Layout";
import BackupRestorePanel from "@/components/BackupRestorePanel";

export default async function BackupPage() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") redirect("/");

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Backup &amp; Restore</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Download a full, restorable snapshot of the database, or restore one back in.
        </p>
      </div>
      <BackupRestorePanel />
    </Layout>
  );
}
