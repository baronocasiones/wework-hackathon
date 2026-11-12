import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sessionUser } from "@/lib/auth";

const items = [
  { title: "Protect the operator studio", text: "Create the first owner account at /register using STUDIO_PASSWORD as the one-time setup key. Sign in with the new account password afterward. The public product page remains accessible to shoppers." },
  { title: "Public media and demo link", text: "Create a Cloudinary account and add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET to .env.local. Set APP_URL to the public HTTPS tunnel address so captions and purchases use links other people can open." },
  { title: "Facebook and Instagram simulation", text: "Set META_PUBLISH_MODE=simulated in .env or .env.local and leave META_PAGE_ID, META_PAGE_ACCESS_TOKEN, and META_IG_USER_ID blank. The local worker completes queued and scheduled demo posts without contacting Meta, Cloudinary, or a public tunnel. Only a deliberate META_PUBLISH_MODE=live setting enables real Meta publishing." },
  { title: "YouTube channel", text: "Create an OAuth web client in Google Cloud, add http://localhost:8000/api/oauth/google/callback as an authorized redirect URI, and add the operator as a test user while the consent screen is in testing. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, and YOUTUBE_CHANNEL_ID. Then choose Connect YouTube in the app. The consent request uses youtube.upload and youtube.readonly." },
  { title: "Publication Materials and text", text: "Add CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN for both Publication Materials options. Cloudflare creates the template background once; its text remains editable without generating a new background. Gemini only suggests titles, captions, and subtitles; blank fields also have local defaults. Uploads need no AI key." },
  { title: "Grok moving video via fal", text: "Check fal's Grok sandbox for any free Lite image-to-video runs available to your account. Free eligibility changes, and a billing-locked account cannot upload. Export a clip and upload its MP4 here. Automated text-to-video uses a separately billed fal API key in FAL_KEY. The default paid test is a 5-second 720p vertical Lite clip; set FAL_VIDEO_DURATION to 15 for the final Reel." },
];

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const token = (await cookies()).get("post_house_session")?.value ?? null;
  if (!sessionUser(token)) redirect("/login");
  return <main className="setup-page"><div className="setup-wrap"><Link href="/" className="setup-back">← Back to studio</Link><p className="eyebrow">SET UP THE LOCAL DEMO</p><h1>Choose how each channel runs.</h1><p className="setup-intro">Facebook and Instagram run as local simulations. No Meta account or token is needed for the demo.</p><div className="setup-list">{items.map((item, index) => <article className="setup-item" key={item.title}><span>{String(index + 1).padStart(2, "0")}</span><div><h2>{item.title}</h2><p>{item.text}</p></div></article>)}</div><div className="setup-callout"><b>Simulation stays separate.</b> Simulated posts have no Meta provider ID or post link and never count as live publications. YouTube still uses its live integration and needs public media when selected.</div><p className="setup-foot">For detailed account setup and API permission instructions, see the project files `README.md` and `SETUP.md`.</p></div></main>;
}
