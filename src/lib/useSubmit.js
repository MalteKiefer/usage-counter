import { useState } from 'react';

// Runs an async save, tracks busy and error state, and resets the form after success.
export function useSubmit(save, reset) {
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  async function submit(payload) {
    setError(null);
    setSaving(true);
    try {
      await save(payload);
      reset();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return { error, saving, submit, fail: setError };
}
