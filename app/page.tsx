import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sessionUser } from "@/lib/auth";
import StudioPage from "./studio-page";

export const dynamic = "force-dynamic";

export default async function Page() {
  const token = (await cookies()).get("post_house_session")?.value ?? null;
  if (!sessionUser(token)) redirect("/login");
  return <StudioPage />;
}
