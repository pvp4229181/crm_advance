import {
  useState,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { X, LoaderCircle, MoreHorizontal, Trash2 } from 'lucide-react';
import { clsx } from 'clsx';
export function Button({
  className,
  children,
  ...p
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={clsx('btn', className)} {...p}>
      {children}
    </button>
  );
}
export function Modal({
  title,
  children,
  onClose,
  width = 'max-w-2xl',
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  width?: string;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const candidates = () =>
      [
        ...(dialog?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
        ) ?? []),
      ].filter((element) => element.getClientRects().length > 0);
    candidates()[0]?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key !== 'Tab') return;
      const elements = candidates();
      const first = elements[0],
        last = elements.at(-1);
      if (!first) {
        event.preventDefault();
        dialog?.focus();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog?.addEventListener('keydown', keyboard);
    return () => {
      dialog?.removeEventListener('keydown', keyboard);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={clsx('w-full bg-white shadow-2xl rounded-md', width)}
      >
        <div className="h-12 flex items-center justify-between border-b px-4">
          <h2 id={titleId} className="font-semibold text-[15px]">
            {title}
          </h2>
          <button type="button" aria-label="Close dialog" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
export function Empty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center text-center">
      <div className="text-sm font-semibold text-slate-600">{title}</div>
      <p className="mt-1 text-xs text-slate-400">{detail}</p>
    </div>
  );
}
export function Loading() {
  return (
    <div className="flex h-64 items-center justify-center">
      <LoaderCircle className="animate-spin text-[#0284c7]" size={24} />
    </div>
  );
}
export function QueryError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => unknown;
}) {
  return (
    <div
      role="alert"
      className="m-4 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800"
    >
      <p className="font-semibold">Unable to load this page</p>
      <p className="mt-1">
        {error instanceof Error ? error.message : 'Please try again.'}
      </p>
      <Button type="button" className="mt-3" onClick={() => retry()}>
        Try again
      </Button>
    </div>
  );
}
export function Avatar({ name, size = 28 }: { name?: string; size?: number }) {
  return (
    <span
      style={{ width: size, height: size }}
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-[#e0f2fe] text-[10px] font-bold text-[#0284c7]"
    >
      {(name ?? '?')
        .split(' ')
        .map((x) => x[0])
        .slice(0, 2)
        .join('')}
    </span>
  );
}

// Extra actions rendered above the destructive one, e.g. moving a deal between stages.
// The popup is portalled to <body>: a transformed or backdrop-filtered ancestor (a dragged or
// dark-mode pipeline card) would otherwise become the containing block for its fixed position.
export type MenuItem = {
  label: string;
  onSelect: () => void;
  active?: boolean;
  disabled?: boolean;
};
export function RowMenu({
  label = 'Delete',
  onDelete,
  busy,
  disabled,
  items = [],
  itemsTitle,
}: {
  label?: string;
  onDelete: () => void;
  busy?: boolean;
  disabled?: boolean;
  items?: MenuItem[];
  itemsTitle?: string;
}) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  return (
    <>
      <button
        type="button"
        title="More actions"
        disabled={disabled}
        className="align-middle text-slate-500 hover:text-slate-900 disabled:opacity-40"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setAt((current) =>
            current ? null : { x: rect.right, y: rect.bottom },
          );
        }}
      >
        <MoreHorizontal size={15} />
      </button>
      {at &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-40"
              onMouseDown={() => setAt(null)}
            />
            <div
              style={{ top: at.y + 4, left: Math.max(8, at.x - 160) }}
              className="fixed z-50 max-h-80 w-44 overflow-auto rounded-md border bg-white py-1 shadow-lg"
            >
              {items.length > 0 && (
                <>
                  {itemsTitle && (
                    <div className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      {itemsTitle}
                    </div>
                  )}
                  {items.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      disabled={busy || item.disabled}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-slate-50 disabled:opacity-40 ${item.active ? 'font-semibold text-[#0369a1]' : 'text-slate-700'}`}
                      onClick={() => {
                        setAt(null);
                        item.onSelect();
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                  <div className="my-1 border-t" />
                </>
              )}
              <button
                type="button"
                disabled={busy}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                onClick={() => {
                  setAt(null);
                  onDelete();
                }}
              >
                <Trash2 size={14} />
                {label}
              </button>
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
