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
          {capabilities.providerFeedbackViewer && (
            <FeedbackWorkbench
              api={feedbackApi}
              canEditMetadata={capabilities.providerFeedbackViewer && capabilities.providerCustomerMetadataEditor}
              onAuthenticationRequired={onAuthenticationRequired}
            />
          )}
          {capabilities.metricCatalogOperator && <CatalogInformation />}
        </main>
      )}
    </div>
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
