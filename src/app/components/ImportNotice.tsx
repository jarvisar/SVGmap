import { useImportNotice } from '../routes.ts';

export function ImportNotice() {
  const errors = useImportNotice((s) => s.errors);
  if (errors.length === 0) return null;
  return (
    <div className="toast" role="alert">
      <span>{errors.join(' ')}</span>
      <button type="button" className="btn btn-small" onClick={() => useImportNotice.setState({ errors: [] })}>
        OK
      </button>
    </div>
  );
}
