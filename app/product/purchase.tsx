"use client";

import { useState } from "react";

export default function ProductPurchase({ platform, campaign }: { platform: "facebook" | "instagram" | "youtube"; campaign: string }) {
  const [state, setState] = useState<"ready" | "saving" | "done" | "error">("ready");
  async function purchase() {
    setState("saving");
    try {
      const response = await fetch("/api/purchase", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ platform, campaign, amount: 49 }) });
      setState(response.ok ? "done" : "error");
    } catch { setState("error"); }
  }
  return <button className="product-buy" onClick={() => void purchase()} disabled={state === "saving" || state === "done"}>{state === "saving" ? "Saving your demo order…" : state === "done" ? "Demo order recorded ✓" : state === "error" ? "Try again" : "Place demo order · ₱49"}</button>;
}
