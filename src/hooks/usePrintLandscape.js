import { useEffect } from 'react';

const STYLE_ID = 'print-landscape-override';

// Forces landscape for this page's print job by injecting a plain,
// UNNAMED `@page { size: landscape; }` rule right before printing and
// removing it right after -- rather than the CSS Paged Media "named page"
// mechanism (`@page someName { size: landscape } .foo { page: someName }`)
// this used to use. Named pages are the textbook-correct way to do this,
// but Chrome has a long-standing bug where switching page types partway
// through fragmenting a box (the very first one, in this case) can leave
// page 1 blank while the real content starts on page 2. Since only one
// report prints at a time, there's nothing to conflict with by just going
// landscape for the whole print job instead of scoping it by name.
export default function usePrintLandscape() {
  useEffect(() => {
    function onBeforePrint() {
      if (document.getElementById(STYLE_ID)) return;
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = '@page { size: landscape; }';
      document.head.appendChild(style);
    }
    function onAfterPrint() {
      document.getElementById(STYLE_ID)?.remove();
    }
    window.addEventListener('beforeprint', onBeforePrint);
    window.addEventListener('afterprint', onAfterPrint);
    return () => {
      window.removeEventListener('beforeprint', onBeforePrint);
      window.removeEventListener('afterprint', onAfterPrint);
      document.getElementById(STYLE_ID)?.remove();
    };
  }, []);
}
