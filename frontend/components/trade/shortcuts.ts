// Trade page (/) — keyboard shortcuts. Everything here is a view action:
// switching interval, flipping the panel's side, focusing a field, opening or
// closing a panel. Nothing places, cancels or modifies an order — submitting
// stays a deliberate click, so a stray keypress can never move money.
//
// Bound once from TradingTerminal's init(). Every lookup is lazy, so this can
// be called before or after the rest of the page is wired.

const KEY_TO_IV_INDEX: Record<string, number> = {
  '1': 0, '2': 1, '3': 2, '4': 3, '5': 4, '6': 5, '7': 6,
};

/** True while the user is typing, so shortcuts don't eat their input. */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable === true
  );
}

function click(id: string) {
  (document.getElementById(id) as HTMLElement | null)?.click();
}

// Esc closes whatever is open, innermost-first. Modals are dismissed via their
// own close control rather than by stripping .hidden — that way each modal's
// existing teardown (the TP/SL dialog resolves its pending promise) still runs.
function escape(): void {
  const modal = document.querySelector('.modal-overlay:not(.hidden)');
  if (modal) {
    (modal.querySelector('.modal-close, #tpslCancel') as HTMLElement | null)?.click();
    return;
  }
  document.getElementById('indMenu')?.classList.add('hidden');
  document.getElementById('mktDropdown')?.classList.add('hidden');
  document.getElementById('mktBackdrop')?.classList.add('hidden');
  document.getElementById('modePopup')?.classList.add('hidden');
  document.getElementById('modeBackdrop')?.classList.add('hidden');
}

export function initShortcuts(): void {
  document.addEventListener('keydown', (e) => {
    // Let the browser's own chords (copy, reload, devtools, …) through.
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape') return escape();
    if (isTyping(e.target)) return;

    const ivIdx = KEY_TO_IV_INDEX[e.key];
    if (ivIdx !== undefined) {
      const btns = document.querySelectorAll<HTMLElement>('.iv-btn');
      btns[ivIdx]?.click();
      return;
    }

    const rdo = (window as any).rdo;
    switch (e.key.toLowerCase()) {
      case 'b': rdo?.setSide?.(true); break;
      case 's': rdo?.setSide?.(false); break;
      case 'm': click('mktBtn'); break;
      case 'o': (window as any).toggleObFloat?.(); break;
      case 'i': click('indBtn'); break;
      case '?': rdo?.toggleModeHelp?.(); break;
      case 'a':
        // Focus the size field — the one input worth reaching without the mouse.
        (document.getElementById('sizeInput') as HTMLInputElement | null)?.focus();
        break;
      default: return;
    }
    e.preventDefault();
  });
}
