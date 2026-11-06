// afterChange, when given, runs after every import or undo and may return a count of what it changed.
export function createFlow({ store, makeTransfers, savePreview, afterChange }) {
  const reconcile = async (result) => {
    if (result.status === 'duplicate_file') return result;
    try {
      await makeTransfers().reconcile();
      return afterChange ? { ...result, tripsMatched: await afterChange() } : result;
    } catch (error) { return { ...result, reconcileError: error.message }; }
  };
  return {
    async save(preview) { return reconcile(await savePreview(preview, store)); },
    async undo(batchId) { return reconcile(await store.undoBatch(batchId)); },
  };
}
