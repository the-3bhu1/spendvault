/**
 * Bring the first invalid field of a form into view.
 *
 * Every form in the app marks an invalid field with `border-danger` — plain inputs via their
 * className, CustomPicker via its `error` prop — so a single query finds whichever comes first in
 * document order, regardless of the field's type.
 *
 * Why this exists: a save handler that fails validation and simply returns is indistinguishable
 * from a dead button when the offending field happens to be scrolled out of view. The user sees no
 * close, no message, no change. Call this on every validation failure so the form always points at
 * what it wants.
 *
 * @param container Scope for the lookup — pass the scrolling element (a `.modal-body` ref, a
 * subview wrapper) so a second, unrelated modal mounted elsewhere can't be matched instead.
 * Falls back to the first `.modal-body` in the document.
 */
export const scrollToFirstError = (container?: HTMLElement | null) => {
  // Deferred a tick: the errors that add `border-danger` are set in the same event handler that
  // calls this, so the class isn't in the DOM until React has committed that state.
  setTimeout(() => {
    const root: ParentNode | null = container ?? document.querySelector('.modal-body');
    const firstErrorEl = root?.querySelector('.border-danger');
    if (!firstErrorEl) return;
    // Scroll the whole labelled group when there is one, so the user sees the field's label and
    // message rather than a bare input cropped at the edge of the viewport.
    (firstErrorEl.closest('.input-group') || firstErrorEl).scrollIntoView({
      behavior: 'smooth',
      block: 'center'
    });
  }, 50);
};
