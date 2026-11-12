"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowRight, Eye, EyeOff, LockKeyhole } from "lucide-react";
import "./auth.css";

type Props = { mode: "login"; canRegister: boolean } | { mode: "register"; needsSetupKey: boolean; closed: boolean };

export default function AuthForm(props: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [setupKey, setSetupKey] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const registering = props.mode === "register";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    if (registering && password !== confirm) { setError("Passwords do not match."); return; }
    setBusy(true);
    try {
      const response = await fetch(`/api/auth/${registering ? "register" : "login"}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(registering ? { email, password, setupKey } : { email, password }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) { setError(result.error ?? "Could not sign in. Please try again."); return; }
      window.location.assign("/");
    } catch { setError("Could not reach the studio. Please try again."); }
    finally { setBusy(false); }
  }

  return <main className="auth-page">
    <div className="auth-layout">
      <section className="auth-story" aria-label="Post House content studio">
        <Link href="/product" className="auth-brand"><img src="/brand/post-house-mark.svg" alt="" width="36" height="36"/><span>post house<small>CONTENT STUDIO</small></span></Link>
        <div className="auth-story-copy"><span className="auth-kicker">YOUR WORKSPACE, YOUR VOICE</span><h1>Good stories deserve a place to grow.</h1><p>Create, plan, and see how your posts come together from one focused studio.</p></div>
        <div className="auth-story-footer"><span className="auth-story-line"/> A quiet space for the work behind every post.</div>
      </section>
      <section className="auth-panel" aria-label={registering ? "Create owner account" : "Sign in"}>
        <div className="auth-card">
          <div className="auth-card-icon"><LockKeyhole size={23} aria-hidden="true"/></div>
          <div className="auth-kicker">{registering ? "FIRST-TIME SETUP" : "WELCOME BACK"}</div>
          <h2>{registering ? "Create your studio account." : "Sign in to your studio."}</h2>
          <p className="auth-intro">{registering ? "Set up the owner account once. Your posts and settings stay in this studio." : "Pick up where you left off."}</p>
          {registering && props.closed ? <div className="auth-closed"><strong>Registration is closed.</strong><p>This studio already has an owner account.</p><Link href="/login">Go to sign in <ArrowRight size={16}/></Link></div> :
            <form onSubmit={(event) => void submit(event)} className="auth-form">
              <label htmlFor="auth-email">Email address</label><input id="auth-email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com"/>
              <label htmlFor="auth-password">Password</label><div className="auth-password"><input id="auth-password" type={showPassword ? "text" : "password"} autoComplete={registering ? "new-password" : "current-password"} minLength={registering ? 12 : undefined} maxLength={128} required value={password} onChange={(event) => setPassword(event.target.value)} placeholder={registering ? "At least 12 characters" : "Your password"}/><button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? <EyeOff size={18}/> : <Eye size={18}/>}</button></div>
              {registering && <><label htmlFor="auth-confirm">Confirm password</label><input id="auth-confirm" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={confirm} onChange={(event) => setConfirm(event.target.value)} placeholder="Enter it again"/>
                {props.needsSetupKey && <><label htmlFor="auth-setup">Setup key</label><input id="auth-setup" type="password" autoComplete="off" required value={setupKey} onChange={(event) => setSetupKey(event.target.value)} placeholder="STUDIO_PASSWORD from your .env file"/><p className="auth-field-help">This is the existing STUDIO_PASSWORD value, used only to create the first account.</p></>}</>}
              {error && <p className="auth-error" role="alert">{error}</p>}
              <button type="submit" className="auth-submit" disabled={busy}>{busy ? "Please wait…" : registering ? "Create account" : "Sign in"}<ArrowRight size={17} aria-hidden="true"/></button>
            </form>}
          <p className="auth-switch">{registering ? <><Link href="/login">Already registered? Sign in</Link></> : props.canRegister ? <><span>First time here?</span> <Link href="/register">Create owner account</Link></> : "Owner access only"}</p>
        </div>
      </section>
    </div>
  </main>;
}
