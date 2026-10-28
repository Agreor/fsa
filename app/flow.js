export function createFlow({ store, makeTransfers, savePreview }) {
  const reconcile = async (result) => {
    if (result.status === 'duplicate_file') return result;
    try { await makeTransfers().reconcile(); return result; }
    catch (error) { return { ...result, reconcileError: error.message }; }
  };
  return {
    async save(preview) { return reconcile(await savePreview(preview, store)); },
    async undo(batchId) { return reconcile(await store.undoBatch(batchId)); },
  };
}
