import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ownerExists, sessionUser } from "@/lib/auth";
import AuthForm from "../auth-form";

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  if (sessionUser((await cookies()).get("post_house_session")?.value ?? null)) redirect("/");
  return <AuthForm mode="register" needsSetupKey={!!process.env.STUDIO_PASSWORD} closed={ownerExists()}/>;
}
