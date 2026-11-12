"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownRight, ArrowUpRight, CalendarClock, Check, ChevronDown, CircleHelp, Clock3, CloudUpload, ImagePlus, Instagram, LoaderCircle, Maximize2, Megaphone, MonitorPlay, MoreHorizontal, Plus, Send, Settings2, Sparkles, Video, X, Youtube } from "lucide-react";

type Platform = "facebook" | "instagram" | "youtube";
type Content = { id: string; title: string; kind: "image" | "video"; source: string; media_url: string; caption: string; subtitle: string; created_at: string; template_headline: string | null; template_body: string | null; style?: string | null };
type Job = { id: string; platform: Platform; title: string; kind: "image" | "video"; caption: string; scheduled_at: string; status: string; provider_id: string | null; permalink: string | null; error: string | null; media_url: string };
type Metric = { platform: Platform; label: string; views: number; likes: number; comments: number; engagement: number; source: "live" | "demo"; postCount: number; sales: number; revenue: number };
type Dashboard = { metrics: Metric[]; jobs: Job[]; usage: Array<{ run_id: string; calls: number; input_tokens: number | null; output_tokens: number | null; total_tokens: number | null; duration_ms: number }>; aiCalls: Array<{ id: string; operation: string; model: string; input_tokens: number | null; output_tokens: number | null; total_tokens: number | null; duration_ms: number; outcome: string; created_at: string }>; credentialEvents: Array<{ id: string; platform: string; event: string; expires_at: string | null; outcome: string; detail: string; created_at: string }>; configured: { falVideo: boolean; cloudflare: boolean; gemini: boolean; cloudinary: boolean; meta: boolean; google: boolean; publicLinks: boolean } };

const platforms: Array<{ id: Platform; name: string; icon: typeof Instagram }> = [
  { id: "facebook", name: "Facebook", icon: Megaphone },
  { id: "instagram", name: "Instagram", icon: Instagram },
  { id: "youtube", name: "YouTube", icon: Youtube },
];
const money = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 });

export default function Home() {
  const previewRef = useRef<HTMLDialogElement>(null);
  const [assets, setAssets] = useState<Content[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [targets, setTargets] = useState<Platform[]>(["facebook", "instagram"]);
  const [captions, setCaptions] = useState<Record<string, string>>({});
  const [schedule, setSchedule] = useState("");
  const [idea, setIdea] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftCaption, setDraftCaption] = useState("");
  const [draftSubtitle, setDraftSubtitle] = useState("");
  const [headline, setHeadline] = useState("A little something for you");
  const [templateBody, setTemplateBody] = useState("");
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadCaption, setUploadCaption] = useState("");
  const [uploadSubtitle, setUploadSubtitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [showSettings, setShowSettings] = useState(false);

  const load = useCallback(async (preferredId?: string) => {
    const [contentResponse, dashboardResponse] = await Promise.all([fetch("/api/content"), fetch("/api/dashboard")]);
    if (contentResponse.ok) {
      const list = await contentResponse.json() as Content[];
      setAssets(list);
      const chosen = preferredId ? list.find((asset) => asset.id === preferredId) : !selected ? list[0] : undefined;
      if (chosen) {
        setSelected(chosen.id);
        const defaults: Platform[] = chosen.kind === "video" ? ["facebook", "instagram", "youtube"] : ["facebook", "instagram"];
        setTargets(defaults);
        setCaptions(Object.fromEntries(defaults.map((platform) => [platform, chosen.caption])));
        setHeadline(chosen.template_headline ?? chosen.title);
        setTemplateBody(chosen.template_body ?? chosen.subtitle);
      }
    }
    if (dashboardResponse.ok) setDashboard(await dashboardResponse.json() as Dashboard);
  }, [selected]);

  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 12000); return () => window.clearInterval(timer); }, [load]);

  const current = assets.find((asset) => asset.id === selected);
  const availablePlatforms = current?.kind === "video" ? platforms : platforms.slice(0, 2);
  const rankedMetrics = useMemo(() => [...(dashboard?.metrics ?? [])].sort((a, b) => b.views - a.views || b.engagement - a.engagement || b.sales - a.sales), [dashboard]);

  async function runGenerate(kind: "template" | "artwork" | "grok_video") {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, prompt: idea, title: draftTitle, caption: draftCaption, subtitle: draftSubtitle }) });
      const body = await response.json() as { id?: string; error?: string };
      if (!response.ok || !body.id) throw new Error(body.error ?? "Could not create content.");
      await load(body.id); setMessage("Your content is ready to edit."); setIdea("");
      setDraftTitle(""); setDraftCaption(""); setDraftSubtitle("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not create content."); }
    finally { setBusy(false); }
  }

  async function uploadFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true); setMessage("");
    try {
      const form = new FormData(); form.set("file", file); form.set("context", idea); form.set("title", uploadTitle);
      form.set("caption", uploadCaption); form.set("subtitle", uploadSubtitle);
      const response = await fetch("/api/content", { method: "POST", body: form });
      const body = await response.json() as { id?: string; error?: string };
      if (!response.ok || !body.id) throw new Error(body.error ?? "Could not upload this file.");
      await load(body.id); setUploadTitle(""); setUploadCaption(""); setUploadSubtitle("");
      setMessage("Upload is ready to edit."); event.target.value = "";
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not upload this file."); }
    finally { setBusy(false); }
  }

  function setContent(nextId: string) {
    previewRef.current?.close();
    setSelected(nextId);
    const asset = assets.find((item) => item.id === nextId);
    const defaults = asset?.kind === "video" ? ["facebook", "instagram", "youtube"] as Platform[] : ["facebook", "instagram"] as Platform[];
    setTargets(defaults);
    setCaptions(Object.fromEntries(defaults.map((platform) => [platform, asset?.caption ?? ""])));
    setHeadline(asset?.template_headline ?? asset?.title ?? "");
    setTemplateBody(asset?.template_body ?? asset?.subtitle ?? "");
  }

  async function saveTemplate() {
    if (!current) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/content/${current.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ headline, body: templateBody }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not update these Publication Materials.");
      await load(); setMessage("Publication Materials text updated.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not update these Publication Materials."); }
    finally { setBusy(false); }
  }

  async function schedulePosts() {
    if (!current || targets.length === 0) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contentId: current.id, targets, captions, scheduledAt: schedule ? new Date(schedule).toISOString() : null }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not schedule these posts.");
      setSchedule(""); setMessage(schedule ? "Your posts are on the calendar." : "Your posts are in the publishing queue."); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not schedule these posts."); }
    finally { setBusy(false); }
  }

  async function publishNow(jobId: string) {
    setBusy(true);
    try { const response = await fetch(`/api/jobs/${jobId}/publish`, { method: "POST" }); const data = await response.json() as { error?: string }; if (!response.ok) throw new Error(data.error ?? "Could not move this post to the queue."); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not publish now."); }
    finally { setBusy(false); }
  }
  async function retryJob(jobId: string) {
    setBusy(true);
    try { const response = await fetch(`/api/jobs/${jobId}/retry`, { method: "POST" }); const data = await response.json() as { error?: string }; if (!response.ok) throw new Error(data.error ?? "Could not retry this post."); await load(); setMessage("Post re-queued."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not retry this post."); }
    finally { setBusy(false); }
  }
  async function simulateTraffic() {
    setBusy(true);
    try { const response = await fetch("/api/dashboard/simulate", { method: "POST" }); if (!response.ok) throw new Error("Could not simulate traffic."); await load(); setMessage("Simulated audience activity added."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not simulate traffic."); }
    finally { setBusy(false); }
  }

  function toggleTarget(id: Platform) {
    setTargets((existing) => existing.includes(id) ? existing.filter((item) => item !== id) : [...existing, id]);
    setCaptions((existing) => ({ ...existing, [id]: existing[id] ?? current?.caption ?? "" }));
  }

  return <main className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#top"><span className="brand-mark"><Sparkles size={18}/></span><span>post house<small>CONTENT STUDIO</small></span></a>
      <div className="workspace-label">WORKSPACE <ChevronDown size={13}/></div>
      <div className="workspace-card"><span className="workspace-avatar">W</span><span>WeWork Studio<small>Solo workspace</small></span><MoreHorizontal size={16} className="muted"/></div>
      <nav className="side-nav"><a className="nav-active" href="#create"><Plus size={17}/> Create</a><a href="#calendar"><CalendarClock size={17}/> Calendar <span>{dashboard?.jobs.filter((job) => job.status === "queued").length ?? 0}</span></a><a href="#insights"><ArrowUpRight size={17}/> Insights</a></nav>
      <div className="sidebar-bottom"><div className="side-section-title">CONFIGURED ACCOUNTS</div>
        <div className="account-row"><span className="account-dot fb">f</span>Facebook Page{dashboard?.configured.meta ? <span className="needs-setup">Configured</span> : <span className="needs-setup">Set up</span>}</div>
        <div className="account-row"><span className="account-dot ig"><Instagram size={13}/></span>Instagram{dashboard?.configured.meta ? <span className="needs-setup">Configured</span> : <span className="needs-setup">Set up</span>}</div>
        <div className="account-row"><span className="account-dot yt"><Youtube size={14}/></span>YouTube{dashboard?.configured.google ? <span className="needs-setup">Configured</span> : <span className="needs-setup">Set up</span>}</div>
        <button className="settings-link" onClick={() => setShowSettings(!showSettings)}><Settings2 size={16}/> Settings & connections</button>
        {showSettings && <div className="settings-card"><p>Cloudflare artwork {dashboard?.configured.cloudflare ? "ready" : "not added"} · fal Grok video API {dashboard?.configured.falVideo ? "key added" : "not added"} · Gemini text {dashboard?.configured.gemini ? "ready" : "not added"}. Connect YouTube with Google OAuth. Meta and media hosting use server-side settings.</p><a href="/api/oauth/google/start" className="small-button">Connect YouTube</a><a href="/setup" className="setup-link">View setup guide ↗</a></div>}
        <button className="help-link"><CircleHelp size={16}/> Help center</button>
      </div>
    </aside>

    <section className="main-panel" id="top">
      <header className="topbar"><div className="breadcrumb">Studio <span>/</span> Overview</div><div className="top-actions"><span className="today-label"><span className={`live-pip ${dashboard?.configured.publicLinks ? "" : "pip-warn"}`}/>{dashboard?.configured.publicLinks ? "Public links ready" : "Local demo links"}</span><button className="user-avatar" aria-label="Account">A</button></div></header>
      <div className="page-wrap">
        <div className="welcome-row"><div><div className="eyebrow">YOUR CONTENT STUDIO</div><h1>Make something worth sharing.</h1><p>One place to shape your story, plan your posts, and see what connects.</p></div><button className="button button-dark" onClick={() => document.getElementById("create")?.scrollIntoView({ behavior: "smooth" })}><Plus size={17}/> New content</button></div>
        <div className="stat-grid">
          <StatCard label="Published posts" value={String(dashboard?.jobs.filter((job) => job.status === "published").length ?? 0).padStart(2,"0")} sub="Across your channels" icon={<MonitorPlay size={17}/>} />
          <StatCard label="Demo sales" value={String(dashboard?.metrics.reduce((sum, metric) => sum + metric.sales, 0) ?? 0).padStart(2,"0")} sub="Tracked from campaign links" icon={<ArrowUpRight size={17}/>} />
          <StatCard label="AI usage" value={dashboard?.usage.length ? `${dashboard.usage[0]?.total_tokens ?? "—"}` : "—"} sub="Tokens in latest creation" icon={<Sparkles size={17}/>} />
          <StatCard label="Up next" value={String(dashboard?.jobs.filter((job) => job.status === "queued").length ?? 0).padStart(2,"0")} sub="Waiting in your calendar" icon={<Clock3 size={17}/>} />
        </div>

        <div className="content-grid" id="create">
          <section className="card create-card">
            <div className="card-heading"><div><div className="eyebrow">CONTENT WORKSHOP</div><h2>Start with an idea</h2></div><span className="step-pill">01 <span>CREATE</span></span></div>
            <label className="field-label" htmlFor="idea">What are you sharing today?</label>
            <textarea id="idea" className="idea-input" value={idea} onChange={(event) => setIdea(event.target.value)} placeholder="A new collection, a weekend offer, a moment from behind the scenes…" rows={3}/>
            <div className="field-label copy-label">Optional post text <span>Blank fields get suggestions</span></div>
            <div className="upload-fields copy-fields"><input aria-label="Generated content title" maxLength={120} placeholder="Title" value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)}/><input aria-label="Generated content caption" maxLength={2200} placeholder="Caption" value={draftCaption} onChange={(event) => setDraftCaption(event.target.value)}/><input aria-label="Generated content subtitle" maxLength={100} placeholder="Subtitle or on-media line" value={draftSubtitle} onChange={(event) => setDraftSubtitle(event.target.value)}/></div>
            <div className="create-options">
              <button disabled={busy || !idea.trim() || !dashboard?.configured.cloudflare} className="option-button template-option" onClick={() => void runGenerate("template")}><span className="option-icon"><ImagePlus size={18}/></span><span><b>Template Publication Materials</b><small>Cloudflare background · editable text</small></span><ArrowDownRight size={15}/></button>
              <button disabled={busy || !idea.trim() || !dashboard?.configured.cloudflare} className="option-button" onClick={() => void runGenerate("artwork")}><span className="option-icon art-icon"><Sparkles size={18}/></span><span><b>AI artwork Publication Materials</b><small>Cloudflare art + Gemini text</small></span><ArrowDownRight size={15}/></button>
              <button disabled={busy || !idea.trim() || !dashboard?.configured.falVideo} className="option-button" onClick={() => void runGenerate("grok_video")}><span className="option-icon video-icon"><Video size={18}/></span><span><b>Grok motion video</b><small>Text to video · fal API billed</small></span><ArrowDownRight size={15}/></button>
            </div>
            {!dashboard?.configured.cloudflare && <div className="inline-note">Add Cloudflare credentials to create either Publication Materials format.</div>}
            {!dashboard?.configured.falVideo && <div className="inline-note">Add a fal API key and credits to generate Grok motion videos.</div>}
            <div className="upload-divider"><span>OR ADD YOUR OWN</span></div>
            <div className="field-label copy-label">Optional upload text <span>Suggestions use your idea or filename</span></div>
            <div className="upload-fields copy-fields"><input aria-label="Content title" maxLength={120} placeholder="Title" value={uploadTitle} onChange={(event) => setUploadTitle(event.target.value)}/><input aria-label="Caption" maxLength={2200} placeholder="Caption" value={uploadCaption} onChange={(event) => setUploadCaption(event.target.value)}/><input aria-label="Subtitle" maxLength={100} placeholder="Subtitle or on-media line" value={uploadSubtitle} onChange={(event) => setUploadSubtitle(event.target.value)}/></div>
            <label className="upload-drop"><input type="file" accept="image/*,video/*" onChange={(event) => void uploadFile(event)}/><span className="upload-icon"><CloudUpload size={19}/></span><span><b>Drop in a photo or video</b><small>PNG, JPG, MP4 up to 200 MB</small></span><span className="button button-outline">Browse files</span></label>
            {busy && <div className="busy-line"><LoaderCircle size={15} className="spin"/> Working on it…</div>}
            {message && <div className="toast-message">{message}</div>}
          </section>

          <section className="card planner-card">
            <div className="card-heading"><div><div className="eyebrow">YOUR NEXT POST</div><h2>Make it yours</h2></div><span className="step-pill">02 <span>PLAN</span></span></div>
            {current ? <><div className="selected-content"><button type="button" className="preview-thumb" onClick={() => previewRef.current?.showModal()} aria-label={`View preview of ${current.title}`}>{current.kind === "video" ? <video src={current.media_url} muted preload="metadata"/> : <img src={current.media_url} alt=""/>}<span className="media-type">{current.kind === "video" ? <Video size={12}/> : <ImagePlus size={12}/>} {current.kind}</span><span className="preview-expand"><Maximize2 size={13}/></span></button><div className="selected-info"><button type="button" className="preview-title" onClick={() => previewRef.current?.showModal()}>{current.title}</button><small>{current.subtitle || "No subtitle"}</small><small>{current.source.replaceAll("_", " ")}{current.style ? ` · ${current.style}` : ""} · Added {new Date(current.created_at).toLocaleDateString()}</small><button className="text-button" onClick={() => document.getElementById("asset-picker")?.click()}>Choose different content</button><select id="asset-picker" aria-label="Choose content" value={selected} onChange={(event) => setContent(event.target.value)}>{assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.title}</option>)}</select></div></div>
                {current.source === "template" && <div className="template-editor"><div className="field-label">Edit Publication Materials text <span>Changes the image layout</span></div><input maxLength={70} value={headline} onChange={(event) => setHeadline(event.target.value)} aria-label="Publication Materials headline"/><textarea maxLength={100} rows={2} value={templateBody} onChange={(event) => setTemplateBody(event.target.value)} aria-label="Publication Materials supporting text"/><button className="text-button" onClick={() => void saveTemplate()} disabled={busy}>Update Publication Materials</button></div>}
                <div className="field-label platform-label">Where should it go?</div><div className="platform-pills">{availablePlatforms.map(({ id, name, icon: Icon }) => <button key={id} className={`platform-pill ${targets.includes(id) ? "platform-selected" : ""}`} onClick={() => toggleTarget(id)}><Icon size={15}/>{name}{targets.includes(id) && <Check size={13}/>}</button>)}</div>
                {targets.length > 0 && <div className="tracked-links">{targets.map((platform) => <a key={platform} href={`/product?platform=${platform}&campaign=${encodeURIComponent(current.id)}`} target="_blank" rel="noreferrer">Preview {platforms.find((item) => item.id === platform)?.name} product link ↗</a>)}</div>}
                <div className="caption-list">{targets.map((platform) => <label key={platform} className="caption-field"><span>{platforms.find((item) => item.id === platform)?.name} caption</span><textarea value={captions[platform] ?? current.caption} onChange={(event) => setCaptions((existing) => ({ ...existing, [platform]: event.target.value }))} rows={2}/></label>)}</div>
                <label className="field-label schedule-label">Post when you’re ready <span>Choose a time to schedule</span></label><div className="schedule-row"><input type="datetime-local" value={schedule} onChange={(event) => setSchedule(event.target.value)}/><button className="button button-dark" disabled={busy || targets.length === 0} onClick={() => void schedulePosts()}>{schedule ? <><CalendarClock size={16}/> Schedule</> : <><Send size={15}/> Post now</>}</button></div>
                {!dashboard?.configured.cloudinary && <div className="inline-note note-warn">Live publishing needs Cloudinary for public media links. Local previews stay private to this app.</div>}
                {dashboard?.configured.publicLinks === false && <div className="inline-note note-warn">APP_URL uses localhost. Set it to your public HTTPS tunnel before sharing tracked product links.</div>}
              </> : <div className="empty-planner"><div className="empty-icon"><ImagePlus size={24}/></div><b>Your preview will show up here</b><p>Create Publication Materials or upload a file to get started.</p></div>}
          </section>
        </div>

        <section className="card overview-card" id="insights"><div className="section-heading"><div><div className="eyebrow">THE BIG PICTURE</div><h2>Channel comparison</h2></div><div className="range-pill">Ranked by views <ChevronDown size={14}/></div></div><div className="table-scroll"><table><thead><tr><th>CHANNEL</th><th>VIEWS</th><th>ENGAGEMENT</th><th>DEMO SALES</th><th>POSTS</th><th>METRIC SOURCE</th></tr></thead><tbody>{rankedMetrics.map((metric, index) => <tr key={metric.platform}><td><span className="rank">{String(index + 1).padStart(2,"0")}</span><PlatformIcon platform={metric.platform}/><b>{metric.label}</b></td><td>{metric.views.toLocaleString()}</td><td>{(metric.engagement * 100).toFixed(1)}%</td><td>{metric.sales} <span className="table-sub">· {money.format(metric.revenue)}</span> <span className="source-chip source-demo">simulated</span></td><td>{metric.postCount}</td><td><span className={`source-chip source-${metric.source}`}>{metric.source === "demo" ? "simulated audience" : "live"}</span></td></tr>)}</tbody></table></div><div className="table-foot"><span><i className="source-dot live"/> Live YouTube counts come from YouTube API.</span><span><i className="source-dot demo"/> Other engagement values are a simulated audience. Sales are simulated.</span><button className="text-button" onClick={() => void simulateTraffic()} disabled={busy}>Simulate audience activity</button></div></section>

        <section className="card queue-card" id="calendar"><div className="section-heading"><div><div className="eyebrow">POSTING CALENDAR</div><h2>Recent activity</h2></div><span className="range-pill">One result per channel</span></div>
          {dashboard?.jobs.length ? <div className="queue-list">{dashboard.jobs.map((job) => <article key={job.id} className="queue-row"><div className="queue-preview">{job.kind === "video" ? <video src={job.media_url} muted/> : <img src={job.media_url} alt=""/>}</div><div className="queue-post"><b>{job.title}</b><small>{platforms.find((item) => item.id === job.platform)?.name} · {new Date(job.scheduled_at).toLocaleString()}</small></div><StatusBadge status={job.status}/>{job.permalink && <a className="view-post" href={job.permalink} target="_blank" rel="noreferrer">View post ↗</a>}{job.status === "queued" && <button className="text-button" onClick={() => void publishNow(job.id)}>Post now</button>}{(job.status === "failed" || job.status === "uncertain" || job.status === "needs_review") && <button className="text-button" onClick={() => void retryJob(job.id)}>Retry</button>}{job.error && <span className="error-hint" title={job.error}>{job.error}</span>}</article>)}</div> : <div className="empty-queue"><CalendarClock size={18}/> Your scheduled posts will appear here.</div>}
        </section>

        <section className="card monitor-card"><div className="section-heading"><div><div className="eyebrow">ACTIVITY RECORD</div><h2>AI usage & account activity</h2></div><span className="range-pill">Stored on this device</span></div><div className="monitor-grid"><div><h3>Creation runs</h3>{dashboard?.usage.length ? <div className="monitor-list">{dashboard.usage.map((run) => <div className="monitor-row" key={run.run_id}><span><b>{run.calls} AI call{run.calls === 1 ? "" : "s"}</b><small>{run.duration_ms} ms total · run {run.run_id.slice(0, 8)}</small></span><span className="usage-values">in {run.input_tokens ?? "unavailable"} · out {run.output_tokens ?? "unavailable"} · total {run.total_tokens ?? "unavailable"}</span></div>)}</div> : <p className="monitor-empty">Run totals appear after content generation.</p>}</div><div><h3>AI calls</h3>{dashboard?.aiCalls.length ? <div className="monitor-list">{dashboard.aiCalls.map((call) => <div className="monitor-row" key={call.id}><span><b>{call.operation}</b><small>{call.model} · {call.outcome} · {call.duration_ms} ms</small></span><span className="usage-values">in {call.input_tokens ?? "unavailable"} · out {call.output_tokens ?? "unavailable"} · total {call.total_tokens ?? "unavailable"}</span></div>)}</div> : <p className="monitor-empty">No AI generations yet. Provider usage will appear here per call.</p>}</div><div><h3>Credential events</h3>{dashboard?.credentialEvents.length ? <div className="monitor-list">{dashboard.credentialEvents.map((event) => <div className="monitor-row" key={event.id}><span><b>{event.platform} · {event.event}</b><small>{new Date(event.created_at).toLocaleString()} · {event.outcome}</small></span><span className="usage-values">Expires {event.expires_at ? new Date(event.expires_at).toLocaleString() : "unavailable"}</span></div>)}</div> : <p className="monitor-empty">Credential issuance and refresh events appear after setup.</p>}</div></div></section>
        <footer className="footer-row"><span>Made for the moments that move people.</span><span>AI usage and connection activity are recorded on this device.</span></footer>
      </div>
    </section>
    <dialog ref={previewRef} className="media-preview-dialog" aria-label={current ? `Preview of ${current.title}` : "Content preview"} onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }} onClose={() => previewRef.current?.querySelector("video")?.pause()}>
      {current && <div className="media-preview-panel"><div className="media-preview-header"><div><span className="eyebrow">CONTENT PREVIEW</span><h2>{current.title}</h2></div><button type="button" className="media-preview-close" onClick={() => previewRef.current?.close()} aria-label="Close preview"><X size={20}/></button></div><div className="media-preview-frame">{current.kind === "video" ? <video key={current.id} src={current.media_url} controls playsInline preload="metadata"/> : <img key={current.id} src={current.media_url} alt={current.title}/>}</div>{current.subtitle && <p className="media-preview-subtitle">{current.subtitle}</p>}{current.caption && <p className="media-preview-caption">{current.caption}</p>}</div>}
    </dialog>
  </main>;
}

function StatCard({ label, value, sub, icon }: { label: string; value: string; sub: string; icon: React.ReactNode }) {
  return <article className="stat-card"><div className="stat-top"><span>{label}</span><span className="stat-icon">{icon}</span></div><strong>{value}</strong><small>{sub}</small></article>;
}

function PlatformIcon({ platform }: { platform: Platform }) {
  if (platform === "instagram") return <span className="table-icon icon-ig"><Instagram size={14}/></span>;
  if (platform === "youtube") return <span className="table-icon icon-yt"><Youtube size={14}/></span>;
  return <span className="table-icon icon-fb">f</span>;
}

function StatusBadge({ status }: { status: string }) {
  const label = status === "published" ? "Published" : status === "queued" ? "Scheduled" : status === "processing" ? "Publishing" : status === "needs_review" || status === "uncertain" ? "Check status" : "Needs attention";
  return <span className={`status-badge status-${status}`}><i/>{label}</span>;
}
