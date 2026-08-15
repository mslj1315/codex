import { type FormEvent, useEffect, useState } from "react";
import { providerApiClient, type ProviderApiClient } from "./api";
import { FeedbackWorkbench } from "./feedback-workbench";
import { sessionClient, type ProviderSession, type SessionClient } from "./session";

type AppState =
  | { status: "restoring" }
  | { status: "anonymous" }
  | { status: "authenticated"; session: ProviderSession };

export interface AppProps {
  session?: SessionClient;
  feedbackApi?: ProviderApiClient;
}

export function App({ session = sessionClient, feedbackApi = providerApiClient }: AppProps) {
  const [state, setState] = useState<AppState>({ status: "restoring" });

  useEffect(() => {
    let active = true;
    session.restore()
      .then((restored) => {
        if (active) setState({ status: "authenticated", session: restored });
      })
      .catch(() => {
        session.clear();
        if (active) setState({ status: "anonymous" });
      });
    return () => { active = false; };
  }, [session]);

  if (state.status === "restoring") return <RestoringView />;
  if (state.status === "anonymous") {
    return <LoginView onAuthenticated={(restored) => setState({ status: "authenticated", session: restored })} session={session} />;
  }

  return (
    <AuthenticatedShell
      feedbackApi={feedbackApi}
      providerSession={state.session}
      onAuthenticationRequired={() => {
        session.clear();
        setState({ status: "anonymous" });
      }}
      onLogout={() => {
        setState({ status: "anonymous" });
        return session.logout();
      }}
    />
  );
}

function RestoringView() {
  return (
    <main className="centered-view">
      <section className="status-panel" role="status" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        <h1>Restoring secure session</h1>
      </section>
    </main>
  );
}

function LoginView({
  onAuthenticated,
  session
}: {
  onAuthenticated(session: ProviderSession): void;
  session: SessionClient;
}) {
  const [loginName, setLoginName] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setFailed(false);
    try {
      onAuthenticated(await session.login(loginName, password));
    } catch {
      setFailed(true);
    } finally {
      setPassword("");
      setSubmitting(false);
    }
  }

  return (
    <main className="centered-view login-surface">
      <section className="login-panel">
        <p className="eyebrow">Service provider workspace</p>
        <h1>Provider Feedback Console</h1>
        <form onSubmit={submit}>
          <label>
            Login name
            <input
              autoComplete="username"
              name="loginName"
              required
              value={loginName}
              onChange={(event) => setLoginName(event.target.value)}
            />
          </label>
          <label>
            Password
            <input
              autoComplete="current-password"
              name="password"
              required
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {failed && <p className="error-message" role="alert">Unable to sign in with those credentials.</p>}
          <button disabled={submitting} type="submit">
            {submitting ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}

function AuthenticatedShell({
  feedbackApi,
  providerSession,
  onAuthenticationRequired,
  onLogout
}: {
  feedbackApi: ProviderApiClient;
  providerSession: ProviderSession;
  onAuthenticationRequired(): void;
  onLogout(): Promise<void>;
}) {
  const { account, capabilities } = providerSession;
  const hasProviderRole = capabilities.providerFeedbackViewer || capabilities.metricCatalogOperator || capabilities.modelPricingOperator;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Provider Feedback Console</p>
          <strong>{account.displayName}</strong>
        </div>
        <button className="secondary-button" onClick={() => void onLogout()} type="button">Sign out</button>
      </header>
      {!hasProviderRole ? (
        <main className="workspace empty-workspace">
          <h1>No provider access</h1>
          <p>This account does not have access to a provider console capability.</p>
        </main>
      ) : (
        <main className="workspace">
          {capabilities.providerFeedbackViewer && (
            <FeedbackWorkbench
              api={feedbackApi}
              canEditMetadata={capabilities.providerFeedbackViewer && capabilities.providerCustomerMetadataEditor}
              onAuthenticationRequired={onAuthenticationRequired}
            />
          )}
          {capabilities.metricCatalogOperator && <CatalogInformation />}
          {capabilities.modelPricingOperator && <ModelPricing api={feedbackApi} />}
        </main>
      )}
    </div>
  );
}

function ModelPricing({ api }: { api: ProviderApiClient }) {
  type Price = { id: string; provider: string; model: string; inputCnyPerMillionTokens: number; outputCnyPerMillionTokens: number; effectiveFrom: string; effectiveTo: string | null; status: string };
  const [items, setItems] = useState<Price[]>([]);
  const [usage, setUsage] = useState<Array<{date:string;provider:string;model:string;inputTokens:number;outputTokens:number;totalTokens:number;totalCostCny:number;callCount:number;successCount:number}>>([]);
  const [active, setActive] = useState<Price | null>(null);
  const [provider, setProvider] = useState(""); const [model, setModel] = useState(""); const [input, setInput] = useState(""); const [output, setOutput] = useState(""); const [effectiveFrom, setEffectiveFrom] = useState(""); const [effectiveTo, setEffectiveTo] = useState("");
  const [error, setError] = useState(false);
  useEffect(() => { let active = true; const now=new Date(); const from=`${now.getUTCFullYear()}-${String(now.getUTCMonth()+1).padStart(2,"0")}-01`; const to=now.toISOString().slice(0,10); Promise.all([api.fetch("/v1/provider-model-pricing/versions"),api.fetch(`/v1/provider-model-pricing/usage?from=${from}&to=${to}`)]).then(async ([versions, aggregates]) => { if (!versions.ok || !aggregates.ok) throw new Error(); return [await versions.json() as {items: Price[]},await aggregates.json() as {items: typeof usage}] as const; }).then(([versions,aggregates]) => { if (active) { setItems(versions.items); setUsage(aggregates.items); } }).catch(() => { if (active) setError(true); }); return () => { active = false; }; }, [api]);
  function payload() { const inputPrice=Number(input); const outputPrice=Number(output); if (!provider.trim() || !model.trim() || !effectiveFrom.trim() || !Number.isFinite(inputPrice) || inputPrice < 0 || !Number.isFinite(outputPrice) || outputPrice < 0) return null; return { provider: provider.trim(), model: model.trim(), inputCnyPerMillionTokens: inputPrice, outputCnyPerMillionTokens: outputPrice, effectiveFrom: effectiveFrom.trim() }; }
  async function save() { const body=payload(); if (!body) { setError(true); return; } setError(false); const path=active ? `/v1/provider-model-pricing/versions/${active.id}` : "/v1/provider-model-pricing/versions"; const response=await api.fetch(path,{method:active ? "PUT" : "POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}); if(!response.ok) { setError(true); return; } const value=await response.json() as Price; setActive(value); setItems((current)=>active ? current.map((item)=>item.id===value.id?value:item) : [value,...current]); setProvider(value.provider); setModel(value.model); setInput(String(value.inputCnyPerMillionTokens)); setOutput(String(value.outputCnyPerMillionTokens)); setEffectiveFrom(value.effectiveFrom); }
  async function transition(action: "publish" | "retire") { if (!active) return; if (action === "retire" && !effectiveTo.trim()) { setError(true); return; } const response=await api.fetch(`/v1/provider-model-pricing/versions/${active.id}/${action}`,{method:"POST",headers:{"Content-Type":"application/json"},body:action==="retire"?JSON.stringify({effectiveTo:effectiveTo.trim()}):undefined}); if(!response.ok) { setError(true); return; } const value=await response.json() as Price; setActive(value); setItems((current)=>current.map((item)=>item.id===value.id?value:item)); setEffectiveTo(value.effectiveTo ?? effectiveTo); }
  return <section className="catalog-panel" aria-labelledby="model-pricing-title"><h2 id="model-pricing-title">Model token pricing</h2><p>Published prices use CNY per one million input or output tokens.</p><label>Provider<input value={provider} onChange={(event)=>setProvider(event.target.value)} /></label><label>Model<input value={model} onChange={(event)=>setModel(event.target.value)} /></label><label>Input CNY per 1M tokens<input inputMode="decimal" value={input} onChange={(event)=>setInput(event.target.value)} /></label><label>Output CNY per 1M tokens<input inputMode="decimal" value={output} onChange={(event)=>setOutput(event.target.value)} /></label><label>Effective from<input value={effectiveFrom} onChange={(event)=>setEffectiveFrom(event.target.value)} /></label>{active?.status === "published" && <label>Scheduled effective to<input value={effectiveTo} onChange={(event)=>setEffectiveTo(event.target.value)} /></label>}{(!active || active.status === "draft") && <button type="button" onClick={()=>void save()}>{active ? "Save draft" : "Create draft"}</button>}{active?.status === "draft" && <button type="button" onClick={()=>void transition("publish")}>Publish</button>}{active?.status === "published" && <button type="button" onClick={()=>void transition("retire")}>Retire</button>}{error ? <p role="alert">Model pricing is unavailable or invalid.</p> : <><ul>{items.map((item) => <li key={item.id}><button type="button" onClick={()=>{setActive(item);setProvider(item.provider);setModel(item.model);setInput(String(item.inputCnyPerMillionTokens));setOutput(String(item.outputCnyPerMillionTokens));setEffectiveFrom(item.effectiveFrom);setEffectiveTo(item.effectiveTo ?? "");}}>{item.provider} / {item.model}: input {item.inputCnyPerMillionTokens}, output {item.outputCnyPerMillionTokens} ({item.status})</button></li>)}</ul><ul>{usage.map((item)=><li key={`${item.date}-${item.provider}-${item.model}`}>{item.date} {item.provider} {item.model}: {item.inputTokens}/{item.outputTokens}/{item.totalTokens} tokens, CNY {item.totalCostCny}, {item.callCount} calls, {item.successCount} successful</li>)}</ul></>}</section>;
}

function CatalogInformation() {
  return (
    <section className="catalog-panel" aria-labelledby="metric-catalog-title">
      <h2 id="metric-catalog-title">Metric catalog</h2>
      <p>Metric catalog publication remains available through the controlled CLI.</p>
    </section>
  );
}
