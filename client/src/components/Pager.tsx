interface Props {
  page: number;
  total: number;
  limit: number;
  onChange: (page: number) => void;
  label: string;
}

// Hidden when everything fits on one page.
export function Pager({ page, total, limit, onChange, label }: Props) {
  const pages = Math.ceil(total / limit);
  if (pages <= 1) return null;

  return (
    <nav className="pager" aria-label={label}>
      <button type="button" onClick={() => onChange(page - 1)} disabled={page <= 1}>
        Previous
      </button>
      <span>
        Page {page} of {pages}
      </span>
      <button type="button" onClick={() => onChange(page + 1)} disabled={page >= pages}>
        Next
      </button>
    </nav>
  );
}
