import { useT } from '../i18n.js';

const FAILURES = { failed: 'login.failed', denied: 'login.denied' };

export default function LoginScreen() {
  const t = useT();
  const failure = new URLSearchParams(window.location.search).get('login');
  return (
    <main className="login card">
      <h1 className="brand">
        <span className="flame">🔥</span> {t('app.title')}
      </h1>
      <h2>{t('login.title')}</h2>
      <p className="muted">{t('login.hint')}</p>
      {FAILURES[failure] && <div className="banner error">{t(FAILURES[failure])}</div>}
      <button className="primary" onClick={() => window.location.assign('/auth/login')}>
        {t('login.button')}
      </button>
    </main>
  );
}
