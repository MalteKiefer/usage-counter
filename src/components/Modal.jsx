import { useEffect, useRef } from 'react';

export default function Modal({ title, onClose, children }) {
  const dialog = useRef(null);

  useEffect(() => {
    const opener = document.activeElement;
    dialog.current?.focus();
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={dialog} className="modal" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        {children}
      </div>
    </div>
  );
}
