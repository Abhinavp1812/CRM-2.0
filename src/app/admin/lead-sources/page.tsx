import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Layout from "@/components/Layout";
import LeadSourceManager from "@/components/LeadSourceManager";

export default async function LeadSourcesPage() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") redirect("/");

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Lead Sources</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Manage the campaigns/channels customers came from (e.g. &quot;Pedicure Campaign&quot;, &quot;Dyson Campaign&quot;), and import a campaign&apos;s phone list to tag its customers.
        </p>
      </div>
      <LeadSourceManager />
    </Layout>
  );
}
