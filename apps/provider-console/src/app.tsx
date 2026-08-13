import { type FormEvent, useEffect, useState } from "react";
import { sessionClient, type ProviderSession, type SessionClient } from "./session";

type AppState =
  | { status: "restoring" }
  | { status: "anonymous" }
  | { status: "authenticated"; session: ProviderSession };

export interface AppProps {
  session?: SessionClient;
}

export function App({ session = sessionClient }: AppProps) {
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
      providerSession={state.session}
      onLogout={async () => {
        await session.logout();
        setState({ status: "anonymous" });
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
  providerSession,
  onLogout
}: {
  providerSession: ProviderSession;
  onLogout(): Promise<void>;
}) {
  const { account, capabilities } = providerSession;
  const hasProviderRole = capabilities.providerFeedbackViewer || capabilities.metricCatalogOperator;

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
          {capabilities.providerFeedbackViewer && <FeedbackWorkbenchStub />}
          {capabilities.metricCatalogOperator && <CatalogInformation />}
        </main>
      )}
    </div>
  );
}

function FeedbackWorkbenchStub() {
  return (
    <section aria-labelledby="customer-feedback-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Read-only aggregate view</p>
          <h1 id="customer-feedback-title">Customer Feedback</h1>
        </div>
      </div>
      <div className="workbench-stub" role="status">Feedback workbench ready</div>
    </section>
  );
}

function CatalogInformation() {
  return (
    <section className="catalog-panel" aria-labelledby="metric-catalog-title">
      <h2 id="metric-catalog-title">Metric catalog</h2>
      <p>Metric catalog publication remains available through the controlled CLI.</p>
    </section>
  );
}
