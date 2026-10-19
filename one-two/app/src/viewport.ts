// Phones show the keyboard over the page instead of resizing it. iOS then pans the whole page to keep the
// text box in view, which pushes the answer sheet's question off screen and can leave the page shifted after
// the keyboard closes. Instead we measure the part of the screen the keyboard leaves visible and let the
// answer sheet fill exactly that (CSS: --vv-top, --vv-h, html.keyboard, html.typing).

export function trackViewport(): void {
  const root = document.documentElement;
  const vv = window.visualViewport;

  const update = () => {
    if (!vv) return;
    root.style.setProperty('--vv-top', `${Math.max(0, vv.offsetTop)}px`);
    root.style.setProperty('--vv-h', `${vv.height}px`);
    root.classList.toggle('keyboard', window.innerHeight - vv.height > 100);
  };
  vv?.addEventListener('resize', update);
  vv?.addEventListener('scroll', update);
  update();

  const isField = (el: EventTarget | null) => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
  document.addEventListener('focusin', (e) => { if (isField(e.target)) root.classList.add('typing'); });
  document.addEventListener('focusout', (e) => {
    if (!isField(e.target)) return;
    // Let focus settle (tapping from one field to another fires out-then-in), then undo any page shift.
    setTimeout(() => {
      if (isField(document.activeElement)) return;
      root.classList.remove('typing');
      window.scrollTo(0, 0);
      update();
    }, 80);
  });
  // Rotating with the keyboard open can also leave the page shifted.
  window.addEventListener('orientationchange', () => setTimeout(() => { window.scrollTo(0, 0); update(); }, 300));
}
