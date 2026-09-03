/**
 * dsh-ide — tiny shared store for the IDE overlay open state.
 *
 * The header action (conversation.session.header.actions) and the floating
 * layer (shell.overlay) are separate slot entries in the same plugin bundle,
 * so they share state through a module-scoped store rather than props.
 */

type Listener = () => void;

let open = false;
const listeners = new Set<Listener>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

export const ideStore = {
  isOpen: (): boolean => open,
  open: (): void => {
    open = true;
    emit();
  },
  close: (): void => {
    open = false;
    emit();
  },
  toggle: (): void => {
    open = !open;
    emit();
  },
  subscribe: (listener: Listener): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
