import { useEffect, useState } from 'react';
import { getListFile, saveListFile } from '../api/client';
import useCanEditSite from '../hooks/useCanEditSite';
import styles from './LotoTypeList.module.css';

// This page edits ONE specific Lookup/Rollup list file (see the "Flex Rollup
// and Lookup Configuration Guide" and Questions.jsx's PICKLIST/CHECKLIST
// option fields) -- it's intentionally not a general-purpose list-file
// manager. Questions.jsx force-uppercases List File Name/List Node/Lookup
// Name (option1/2/4) on every save, so FILENAME and every ParentListID here
// are kept upper-case too -- both the API's file lookup and the real mobile
// app's ParentListID match are already case-insensitive/trimmed (see
// parseLookupListXml), but matching the DB's actual casing outright avoids
// depending on that fallback at all.
const FILENAME = 'LOTOTYPE.XML';
const PARENT_LIST_ID = 'LOTOTYPE';

const EMPTY_TEMPLATE =
  '<?xml version="1.0" encoding="utf-8"?>\n<LookupList>\n</LookupList>\n';

// OSHA 1910.147 energy-source categories, plus "Stored Energy" -- covered by
// OSHA's "or other energy" catch-all rather than named as its own category,
// but called out separately on nearly every real-world LOTO checklist since
// it's the one people most often miss after the primary source is cut
// (residual charge, a spring still under tension, a flywheel coasting down).
const STANDARD_LOTO_TYPES = [
  'Electrical',
  'Mechanical',
  'Hydraulic',
  'Pneumatic',
  'Thermal',
  'Chemical',
  'Gravity / Potential Energy',
  'Stored Energy',
];

// Per-type field-verification checklist items -- what a compliance inspector
// confirms once a piece of equipment has (supposedly) been locked out under
// that energy type. Each group gets its own ParentListID so a CHECKLIST_TYPE
// question can point at just one type's items via its Lookup Name field.
// DefaultChecked="Y" on every item: these are all required verification
// steps, so an unchecked item at submit time should flag the same way an
// unexpected Yes/No answer does (see CHECKLIST_TYPE in Questions.jsx).
const CHECKLIST_ITEMS_BY_TYPE = {
  Electrical: {
    parentListId: 'LOTOCHECKLIST_ELECTRICAL',
    items: [
      'Main disconnect / breaker locked out',
      'Lockout device and personal tag applied and legible',
      'Zero-energy state verified with a rated meter',
      'Capacitors and other stored charge discharged/grounded',
      'Attempted-start test performed -- no response',
    ],
  },
  Mechanical: {
    parentListId: 'LOTOCHECKLIST_MECHANICAL',
    items: [
      'All moving parts (belts, gears, flywheels) fully stopped',
      'Mechanical stop/block installed on parts that could move by momentum',
      'Lockout device applied to the energy-isolating device',
      'Residual motion (coast-down) confirmed stopped before work begins',
      'Attempted-start test performed -- no motion observed',
    ],
  },
  Hydraulic: {
    parentListId: 'LOTOCHECKLIST_HYDRAULIC',
    items: [
      'Hydraulic pump/power unit isolated and locked out',
      'All pressure bled from lines, cylinders and accumulators',
      'Pressure gauge confirmed reads zero',
      'Blocking/pins installed to prevent gravity-fall of raised components',
      'Bleeder/drain valve opened and tagged',
    ],
  },
  Pneumatic: {
    parentListId: 'LOTOCHECKLIST_PNEUMATIC',
    items: [
      'Air/gas supply valve closed and locked out',
      'All lines and reservoirs bled down to atmospheric pressure',
      'Pressure gauge confirmed reads zero',
      'Air receiver/accumulator drained',
      'Blocking installed on air-actuated components that could move',
    ],
  },
  Chemical: {
    parentListId: 'LOTOCHECKLIST_CHEMICAL',
    items: [
      'Chemical feed/supply valves closed and locked out',
      'Lines flushed, purged or neutralized per SDS/site procedure',
      'Required PPE confirmed available and worn',
      'Checked for reactive or incompatible residual chemicals',
      'Ventilation confirmed adequate before work begins',
    ],
  },
  Thermal: {
    parentListId: 'LOTOCHECKLIST_THERMAL',
    items: [
      'Heat source (steam, hot fluid, furnace) isolated and locked out',
      'Surface temperature verified safe, or PPE confirmed',
      'Steam/hot lines bled and drained',
      'Cool-down period observed before work begins',
      'Cold/cryogenic sources also isolated and checked, if applicable',
    ],
  },
  'Gravity / Potential Energy': {
    parentListId: 'LOTOCHECKLIST_GRAVITY',
    items: [
      'All suspended loads lowered to rest or physically blocked',
      'Mechanical blocks, pins or stands installed under raised components',
      'Confirmed load will not shift or fall during work',
      'Crane/hoist controls locked out where applicable',
      'Area beneath suspended/raised components barricaded',
    ],
  },
  'Stored Energy': {
    parentListId: 'LOTOCHECKLIST_STOREDENERGY',
    items: [
      'Springs relaxed/blocked or tension released',
      'Capacitors discharged and verified with a meter',
      'Flywheels/rotating members confirmed fully stopped',
      'Residual pressure in "de-energized" lines re-checked with a gauge',
      'Stored-energy indicators (accumulator gauges, spring indicators) at zero/neutral',
    ],
  },
};

function escapeXmlAttr(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function newGuid() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  // Fallback for older browsers -- not cryptographically strong, but these
  // GUIDs only need to be unique within one list file.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function luLine(parentListId, value, defaultChecked) {
  const checkedAttr = defaultChecked ? ' DefaultChecked="Y"' : '';
  return `  <LU ID="${newGuid()}" ParentListID="${parentListId}" Value="${escapeXmlAttr(value)}"${checkedAttr} />`;
}

// Inserts one or more new <LU> lines just before the closing </LookupList>
// tag, preserving whatever's already in the file. Returns null (instead of
// the new text) if no closing tag was found, so the caller can warn instead
// of silently mangling hand-edited XML.
function insertLuLines(xmlText, lines) {
  const closeIdx = xmlText.lastIndexOf('</LookupList>');
  if (closeIdx === -1) return null;
  return xmlText.slice(0, closeIdx) + lines.join('\n') + '\n' + xmlText.slice(closeIdx);
}

export default function LotoTypeList() {
  // Admin-only (backend enforces the same gate on PUT /pda/listfile via
  // require_unrestricted -- this just keeps a site-restricted user from
  // loading a page that would only 403 on Save, same pattern as Users.jsx).
  const { me, unrestricted } = useCanEditSite();
  const editable = unrestricted;

  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(null);

  const [newValue, setNewValue] = useState('');
  const [insertErr, setInsertErr] = useState(null);

  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState(null);
  const [saveErr, setSaveErr] = useState(null);

  useEffect(() => {
    if (!me) return;
    if (!unrestricted) { setLoading(false); return; }
    getListFile(FILENAME)
      .then(text => setContent(text))
      .catch(ex => {
        if (ex.response?.status === 404) {
          setContent(EMPTY_TEMPLATE);
        } else {
          setLoadErr(ex.response?.data?.detail ?? ex.message ?? 'Failed to load list file');
        }
      })
      .finally(() => setLoading(false));
  }, [me, unrestricted]);

  function applyInsert(lines) {
    if (lines.length === 0) return;
    const next = insertLuLines(content, lines);
    if (next === null) {
      setInsertErr('Could not find a </LookupList> closing tag to insert into -- fix the XML by hand, or click "Reset to blank template".');
      return;
    }
    setInsertErr(null);
    setContent(next);
    setSaveResult(null);
  }

  function addValue(value) {
    const trimmed = value.trim();
    if (!trimmed) return;
    applyInsert([luLine(PARENT_LIST_ID, trimmed, false)]);
  }

  function addStandardTypes() {
    const toAdd = STANDARD_LOTO_TYPES.filter(v =>
      !new RegExp(`Value\\s*=\\s*"${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'i').test(content)
    );
    applyInsert(toAdd.map(v => luLine(PARENT_LIST_ID, v, false)));
  }

  // Inserts every type's checklist group that isn't already present (checked
  // by ParentListID, not by item text -- an admin may have already edited a
  // group's wording, and re-inserting would duplicate the whole group).
  function addChecklists() {
    const lines = [];
    for (const { parentListId, items } of Object.values(CHECKLIST_ITEMS_BY_TYPE)) {
      if (content.includes(`ParentListID="${parentListId}"`)) continue;
      for (const item of items) lines.push(luLine(parentListId, item, true));
    }
    applyInsert(lines);
  }

  async function save() {
    setSaving(true);
    setSaveResult(null);
    setSaveErr(null);
    try {
      const data = await saveListFile(FILENAME, content);
      setSaveResult(data);
    } catch (ex) {
      setSaveErr(ex.response?.data?.detail ?? ex.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (me && !unrestricted) {
    return (
      <div className={styles.page}>
        <div className={styles.header}><h2 className={styles.heading}>LOTO Type List</h2></div>
        <div className={styles.saveErr}>Admin access required — this account is restricted to specific sites.</div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.heading}>LOTO Type List</h2>
          <p className={styles.sub}>
            Edits <code>{FILENAME}</code>. The type picklist reads Lookup Name <code>{PARENT_LIST_ID}</code>;
            each energy type's own inspection checklist reads Lookup Name <code>LOTOCHECKLIST_&lt;TYPE&gt;</code> (e.g.{' '}
            <code>LOTOCHECKLIST_ELECTRICAL</code>) -- set these on a PICKLIST/CHECKLIST question in{' '}
            <a href="/setup/questions">Question Setup</a> (List File Name/List Node/Lookup Name are saved
            upper-cased there regardless of how you type them, so match that case here too).
          </p>
          <p className={styles.sub}>
            Note: today the type picklist always advances to the <em>same</em> next question regardless of which
            type is picked -- the mobile app doesn't yet support jumping to a different checklist per selected
            value. Until that's built, wire each type's checklist to its own separate question/point rather than
            expecting the picklist to route there automatically.
          </p>
        </div>
        <button className={styles.saveBtn} onClick={save} disabled={saving || loading || !editable}>
          {saving ? <span className={styles.spinner}>⟳</span> : '💾 Save'}
        </button>
      </div>

      {loading && <div className={styles.loading}>Loading…</div>}

      {loadErr && (
        <div className={styles.loadErr}>
          <strong>Could not load {FILENAME}</strong>
          <p>{loadErr}</p>
        </div>
      )}

      {!loading && !loadErr && (
        <>
          <div className={styles.toolbar}>
            <input
              className={styles.addInput}
              placeholder="Add a LOTO type (e.g. Steam)"
              value={newValue}
              onChange={e => setNewValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  addValue(newValue);
                  setNewValue('');
                }
              }}
              disabled={!editable}
              maxLength={50}
            />
            <button
              className={styles.addBtn}
              onClick={() => { addValue(newValue); setNewValue(''); }}
              disabled={!editable || !newValue.trim()}
            >
              + Add
            </button>
            <button className={styles.stdBtn} onClick={addStandardTypes} disabled={!editable}>
              + Insert standard OSHA types
            </button>
            <button className={styles.stdBtn} onClick={addChecklists} disabled={!editable}>
              + Insert per-type inspection checklists
            </button>
            <button
              className={styles.resetBtn}
              onClick={() => { setContent(EMPTY_TEMPLATE); setInsertErr(null); setSaveResult(null); }}
              disabled={!editable}
            >
              Reset to blank template
            </button>
          </div>

          {insertErr && <div className={styles.insertErr}>⚠ {insertErr}</div>}

          <textarea
            className={styles.editor}
            value={content}
            onChange={e => { setContent(e.target.value); setSaveResult(null); }}
            spellCheck={false}
            disabled={!editable}
          />

          {saveErr && <div className={styles.saveErr}>⚠ {saveErr}</div>}

          {saveResult && (
            <div className={`${styles.result} ${saveResult.success ? styles.resultOk : styles.resultErr}`}>
              <div className={styles.resultHeader}>
                <span className={saveResult.success ? styles.okIcon : styles.errIcon}>
                  {saveResult.success ? '✓' : '✗'}
                </span>
                <span>
                  {saveResult.success
                    ? `Saved to ${saveResult.written.length} site${saveResult.written.length !== 1 ? 's' : ''}`
                    : `${saveResult.errors.length} error(s) while saving`}
                </span>
              </div>
              {saveResult.written.map(p => <div key={p} className={styles.pathLine}>{p}</div>)}
              {saveResult.errors.map((e, i) => <div key={i} className={styles.errorItem}>⚠ {e}</div>)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
