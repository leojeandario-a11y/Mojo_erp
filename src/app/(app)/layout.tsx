import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getSession } from "@/lib/auth";

export default async function ProtectedLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await getSession();
  if (!user) redirect("/login");
  return <AppShell user={user}>{children}</AppShell>;
}
