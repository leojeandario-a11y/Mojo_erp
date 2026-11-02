import { redirect } from "next/navigation";
import { RegistrationScreen } from "@/components/registration-screen";
import { getSession } from "@/lib/auth";

export default async function RegisterPage() {
  if (await getSession()) redirect("/dashboard");
  return <RegistrationScreen />;
}
