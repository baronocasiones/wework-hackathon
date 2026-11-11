import ProductPurchase from "./purchase";
import { platformSchema } from "@/lib/domain";

export default async function ProductPage({ searchParams }: { searchParams: Promise<{ platform?: string; campaign?: string }> }) {
  const params = await searchParams;
  const parsed = platformSchema.safeParse(params.platform);
  const platform = parsed.success ? parsed.data : "facebook";
  const campaign = params.campaign?.slice(0, 100) ?? "demo-campaign";
  return <main className="product-page"><div className="product-card"><span className="product-badge">POST HOUSE · DEMO SHOP</span><div className="product-art"><div className="product-sun"/><div className="product-leaf">✦</div><span>WEEKEND<br/>EDIT</span></div><p className="eyebrow">A SMALL THING, MADE WELL</p><h1>The everyday tote</h1><p className="product-copy">Room for the market, the library, and everything in between. Made for your daily loop.</p><div className="product-price">₱49 <small>demo price</small></div><ProductPurchase platform={platform} campaign={campaign}/><p className="product-note">This is a demo checkout. No payment will be collected.</p><div className="attribution">Arrived from <b>{platform}</b> · campaign <code>{campaign.slice(0,12)}</code></div></div></main>;
}
