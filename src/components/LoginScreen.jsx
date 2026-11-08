import { useT } from '../i18n.js';
import { loginFailureKey } from '../lib/login.js';

export default function LoginScreen() {
  const t = useT();
  const failureKey = loginFailureKey(window.location.search);
  return (
    <main className="login card">
      <h1 className="brand">
        <span className="flame">🔥</span> {t('app.title')}
      </h1>
      <h2>{t('login.title')}</h2>
      <p className="muted">{t('login.hint')}</p>
      {failureKey && <div className="banner error">{t(failureKey)}</div>}
      <button className="primary" onClick={() => window.location.assign('/auth/login')}>
        {t('login.button')}
      </button>
    </main>
  );
}
