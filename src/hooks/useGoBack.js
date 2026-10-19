import { useLocation, useNavigate } from 'react-router-dom';

// "Back" = the page you were actually on before this one. Falls back to
// `fallback` (the screen's parent) when there's nothing earlier in this
// tab's history -- opened from a bookmark/link, or after a reload that
// started the tab on this page -- where navigate(-1) would leave the app.
export default function useGoBack(fallback) {
  const navigate = useNavigate();
  const location = useLocation();
  return () => {
    if (location.key !== 'default') navigate(-1);
    else navigate(fallback);
  };
}
