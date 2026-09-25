import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Layout from "@/components/Layout";
import TeamManager from "../../../components/TeamManager";
import RedistributeRecentLeads from "@/components/RedistributeRecentLeads";

export default async function TeamPage() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") redirect("/");

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Team</h1>
        <p className="text-sm text-gray-500 mt-0.5">Manage agents: create, put on leave, reassign customers, and remove.</p>
      </div>
      <RedistributeRecentLeads />
      {/* TeamManager is a client component that handles data fetching and modals */}
      <TeamManager />
    </Layout>
  );
}
