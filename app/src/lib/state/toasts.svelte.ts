export interface ToastAction {
  label: string;
  fn: () => void;
}

export interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'warn' | 'error';
  /** Optional action buttons (e.g. Undo + Add details). */
  actions?: ToastAction[];
  timeout: number;
}

class ToastState {
  list = $state<Toast[]>([]);
  private nextId = 1;

  show(
    message: string,
    opts: { kind?: Toast['kind']; action?: ToastAction; actions?: ToastAction[]; timeout?: number } = {}
  ): void {
    const actions = opts.actions ?? (opts.action ? [opts.action] : undefined);
    const toast: Toast = {
      id: this.nextId++,
      message,
      kind: opts.kind ?? 'info',
      actions,
      timeout: opts.timeout ?? (actions ? 6000 : 3500)
    };
    this.list = [...this.list, toast];
    setTimeout(() => this.dismiss(toast.id), toast.timeout);
  }

  dismiss(id: number): void {
    this.list = this.list.filter((t) => t.id !== id);
  }
}

export const toasts = new ToastState();
