import { useEffect, useRef, useState } from 'react';

// Replaces window.confirm with the app's own dialog. The provider registers the request function, so any
// component can call confirm(message) without a hook. It resolves to true or false.
let request = null;
export const confirm = (message) => (request ? request(message) : Promise.resolve(false));

export function ConfirmProvider({ t, children }) {
  const [pending, setPending] = useState(null);
  const cancelButton = useRef(null);

  useEffect(() => {
    request = (message) => new Promise((resolve) => setPending({ message, resolve }));
    return () => {
      request = null;
    };
  }, []);

  function answer(result) {
    pending.resolve(result);
    setPending(null);
  }

  useEffect(() => {
    if (!pending) return undefined;
    cancelButton.current?.focus();
    // Capture phase, so Escape only closes this dialog and not the panel behind it.
    function onKey(e) {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      pending.resolve(false);
      setPending(null);
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [pending]);

  return (
    <>
      {children}
      {pending && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && answer(false)}>
          <div className="modal" role="alertdialog" aria-modal="true" aria-label={t('common.confirm')}>
            <p>{pending.message}</p>
            <div className="modal-actions">
              <button ref={cancelButton} className="ghost" onClick={() => answer(false)}>
                {t('common.cancel')}
              </button>
              <button className="primary" onClick={() => answer(true)}>
                {t('common.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
