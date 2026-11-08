// Runs tasks one after another, so an earlier request cannot finish after a newer one and overwrite it.
export function serial() {
  let tail = Promise.resolve();
  return (task) => {
    const run = tail.then(task);
    tail = run.catch(() => {});
    return run;
  };
}
