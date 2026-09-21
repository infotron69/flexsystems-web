import { useEffect, useState } from 'react';
import { getMe } from '../api/client';

// Mirrors the backend's per-site, per-module edit matrix (app.auth
// get_editable_site_scope / get_questions_edit_scope): unrestricted users
// (empty site_access) can edit everything; restricted users are gated by
// the relevant Can_Edit* flag for that site.
export default function useCanEditSite() {
  const [me, setMe] = useState(null);

  useEffect(() => {
    getMe().then(setMe).catch(() => setMe(null));
  }, []);

  const unrestricted = !!me && me.site_access.length === 0;

  function canEdit(siteId, module = 'routes') {
    if (!me) return true; // fail open while loading -- backend still enforces
    if (unrestricted) return true;
    const access = me.site_access.find(a => a.site_id === siteId);
    if (!access) return false;
    return module === 'questions' ? access.can_edit_questions : access.can_edit;
  }

  // For shared/non-site-scoped config (the master Question Library): true if
  // unrestricted, or restricted with edit rights on at least one site.
  const hasAnyEditAccess = !me || unrestricted
    || me.site_access.some(a => a.can_edit || a.can_edit_questions);

  return { me, loaded: !!me, unrestricted, canEdit, hasAnyEditAccess };
}
