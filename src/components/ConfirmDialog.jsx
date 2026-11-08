import { useCallback, useEffect, useId, useRef, useState } from 'react';

// Replaces window.confirm with the app's own dialog. The provider registers the request function, so any
// component can call confirm(message) without a hook. It resolves to true or false.
let request = null;
export const confirm = (message) => (request ? request(message) : Promise.resolve(false));

export function ConfirmProvider({ t, children }) {
  const [pending, setPending] = useState(null);
  const resolveOpen = useRef(null);
  const returnFocus = useRef(null);
  const cancelButton = useRef(null);
  const questionId = useId();

  // Closes the open question with a result and gives focus back to the control that asked.
  const answer = useCallback((result) => {
    const resolve = resolveOpen.current;
    resolveOpen.current = null;
    setPending(null);
    resolve?.(result);
    returnFocus.current?.focus?.();
    returnFocus.current = null;
  }, []);

  useEffect(() => {
    // Asking again answers the open question with false, so no caller waits forever.
    request = (message) =>
      new Promise((resolve) => {
        const wasOpen = resolveOpen.current !== null;
        resolveOpen.current?.(false);
        resolveOpen.current = resolve;
        // Only the first question remembers where focus came from; the dialog's own buttons must not.
        if (!wasOpen) returnFocus.current = document.activeElement;
        setPending({ message });
      });
    return () => {
      // Unmounting closes an open question, so its caller is not left waiting.
      resolveOpen.current?.(false);
      resolveOpen.current = null;
      request = null;
    };
  }, []);

  useEffect(() => {
    if (!pending) return undefined;
    cancelButton.current?.focus();
    // Capture phase, so Escape only closes this dialog and not the panel behind it.
    function onKey(e) {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      answer(false);
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [pending, answer]);

  return (
    <>
      {children}
      {pending && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && answer(false)}>
          <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby={questionId}>
            <p id={questionId}>{pending.message}</p>
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
