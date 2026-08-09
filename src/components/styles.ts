// Shared Tailwind class strings for the recurring control styles.

export const inputCls = 'w-full bg-white/[0.07] border border-white/15 text-white text-sm px-3 py-2.5 focus:outline-none focus:border-white/40 placeholder:text-white/40';

// inputCls with the error border swapped in: a full string rather than a
// suffix appended to inputCls, so it does not depend on CSS rule order.
export const inputErrorCls = 'w-full bg-white/[0.07] border border-red-400/60 text-white text-sm px-3 py-2.5 focus:outline-none focus:border-red-400/60 placeholder:text-white/40';

// The sender <select> in both composers: inputCls sized to the address
// column, full-width when the row stacks below sm.
export const selectCls = 'w-full sm:w-48 sm:shrink-0 bg-white/[0.07] border border-white/15 text-white text-sm px-3 py-2.5 focus:outline-none focus:border-white/40';

// Read-only stand-in shown in place of selectCls when the sender is locked.
export const lockedSenderCls = 'w-full sm:w-48 sm:shrink-0 flex items-center text-sm text-white/35 border border-white/10 bg-white/[0.04] px-3 py-2.5';

export const btnPrimary = 'text-sm font-bold px-4 py-2 bg-white/80 text-black hover:bg-gold transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer';
export const btnGhost = 'text-sm px-4 py-2 border border-white/20 text-white/75 hover:text-white hover:border-white/40 transition-colors cursor-pointer';
export const btnDanger = 'text-xs leading-none text-red-400/60 hover:text-red-400 transition-colors cursor-pointer';

// Bordered destructive action at btnGhost's size (the contact Delete).
export const btnDangerOutline = 'text-sm px-4 py-2 border border-red-400/30 text-red-400/80 hover:text-red-400 hover:border-red-400/55 transition-colors cursor-pointer';

// Underlined inline text action (the draft Edit button).
export const btnLink = 'text-xs text-white/65 hover:text-white underline underline-offset-2 decoration-white/30 hover:decoration-white/60 transition-colors cursor-pointer disabled:opacity-40';

// Gold inline text action (+ Reply, + Reply all, Forward, + Email, + New).
export const btnGold = 'text-xs text-gold/70 hover:text-gold transition-colors cursor-pointer';

// Muted inline text action (Retry, the CC/BCC reveal toggles).
export const btnMuted = 'text-xs text-white/50 hover:text-white/80 transition-colors cursor-pointer';
