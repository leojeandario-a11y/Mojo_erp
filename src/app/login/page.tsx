import { redirect } from "next/navigation";
import { LoginScreen } from "@/components/login-screen";
import { getSession } from "@/lib/auth";

export default async function LoginPage() {
  if (await getSession()) redirect("/dashboard");
  return <LoginScreen />;
}
