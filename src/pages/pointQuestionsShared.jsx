import { useMemo, useState } from 'react';
import styles from './PointQuestions.module.css';

// Shared between PointQuestions.jsx (one point) and BulkPointQuestions.jsx
// (apply one question list to several points at once) -- keeps the jump-type
// rules and grid controls from drifting out of sync between the two screens.

export const MAX_SLOTS = 10;

export const TYPE_LABEL = {
  '1': 'YES/NO',
  '2': 'MULTICHOICE',
  '3': 'ALPHA/NUM',
  '4': 'LOW/NORMAL/HIGH',
  '5': 'MULTISELECT',
  '6': 'SHOWFILE',
  '7': 'ASSET SCAN',
  '8': 'PICKLIST',
  '9': 'CLONE JUMP',
  '10': 'SIGNATURE',
  '11': 'PHOTO',
};

// Which jump slots are active for a question type, and their answer labels.
// Matches the legacy VB6 frmRoutesPointsQuestions.SetTypes() logic:
//   1 YES/NO            -> jump1=Yes, jump2=No
//   2 MULTICHOICE        -> jump1-5 tied to option1-5 (blank option disables its jump)
//   3 ALPHA/NUM          -> jump1 only, generic forward jump
//   4 LOW/NORMAL/HIGH    -> jump1=Low, jump2=Normal, jump3=High
//   5 MULTISELECT        -> jump1 only (legacy code caps this at 1 jump even though
//                           older docs describe 5 — the shipped app only allows 1)
//   6 SHOWFILE           -> jump1 only
//   7 ASSET SCAN         -> jump1 only
//   8 PICKLIST           -> jump1 only
//   9 CLONE JUMP         -> jump1 only, destination point code
//   10 SIGNATURE         -> jump1 only
//   11 PHOTO             -> jump1 only
export function jumpLabels(question) {
  if (!question) return [null, null, null, null, null];
  const t = String(question.question_type ?? '');
  switch (t) {
    case '1': return ['YES', 'NO', null, null, null];
    case '2': return [
        question.option1 || null,
        question.option2 || null,
        question.option3 || null,
        question.option4 || null,
        question.option5 || null,
      ];
    case '3':  return ['NEXT', null, null, null, null];
    case '4':  return ['LOW', 'NORMAL', 'HIGH', null, null];
    case '5':  return ['NEXT', null, null, null, null];
    case '6':  return ['NEXT', null, null, null, null];
    case '7':  return ['NEXT', null, null, null, null];
    case '8':  return ['NEXT', null, null, null, null];
    case '9':  return ['DEST', null, null, null, null];
    case '10': return ['NEXT', null, null, null, null];
    case '11': return ['NEXT', null, null, null, null];
    default:   return [null, null, null, null, null];
  }
}

export function isPointCode(val) {
  if (!val) return false;
  const t = val.trim();
  if (!t || t === '0' || t === '98' || t === '99') return false;
  if (/^\d{1,4}$/.test(t)) return false;
  return true;
}

export function jumpLabel(val) {
  if (!val || val === '') return '—';
  if (val === '0')  return 'Exit Point';
  if (val === '98') return '→ Incidents';
  if (val === '99') return 'Exit Route';
  const tr = val.trim();
  if (isPointCode(val)) return `Pt: ${tr}`;
  return `Seq ${val}`;
}

export const mkEmpty = () => ({ questionId: null, answerRequired: false, jumps: ['0','0','0','0','0'] });

export function rpqToSlot(rpq) {
  return {
    questionId:     rpq.question_id,
    answerRequired: rpq.answer_required === 'Y',
    jumps: [rpq.jump1 ?? '', rpq.jump2 ?? '', rpq.jump3 ?? '', rpq.jump4 ?? '', rpq.jump5 ?? ''],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// JumpSelect — compact dropdown for one jump slot
// ─────────────────────────────────────────────────────────────────────────────
// excludeIds: point_ids that must never appear as a jump-to-point target
// (the point(s) currently being edited, so a row can't jump to itself).
export function JumpSelect({
  value, onChange, slotIdx, slots, routePoints, incidentsRoutePoints, excludeIds,
  isCloneDest, isJump1, questionsById, disabled,
}) {
  // Point-code jump targets = points on the current route, UNION points on the
  // special "Incidents1" route (legacy VB6 clone-jump / SOP destination points).
  const jumpablePoints = useMemo(() => {
    const seen = new Set();
    const merged = [];
    // A hidden SOP is still a valid jump target for whichever slot already
    // points at it (excluding it here would make the <select> show blank
    // for an existing, working configuration) -- hiding only keeps it out
    // of every OTHER slot's picker, where it'd be offered as a NEW choice.
    const selectedCode = value ? value.trim() : null;
    [...routePoints, ...incidentsRoutePoints].forEach(rp => {
      if (excludeIds?.has(rp.point_id) || !rp.point?.point_code) return;
      if (seen.has(rp.point_id)) return;
      if (rp.point.is_hidden === 'Y' && rp.point.point_code.trim() !== selectedCode) return;
      seen.add(rp.point_id);
      merged.push(rp);
    });
    merged.sort((a, b) => a.point.point_code.localeCompare(b.point.point_code));
    return merged;
  }, [routePoints, incidentsRoutePoints, excludeIds, value]);

  const options = useMemo(() => {
    if (isCloneDest) {
      const opts = [{ value: '', label: '— point —' }];
      jumpablePoints.forEach(rp => {
        opts.push({
          value: rp.point.point_code.padEnd(10),
          label: `${rp.point.point_code.trim()} – ${rp.point.description ?? ''}`,
        });
      });
      return opts;
    }
    const opts = [
      { value: '',   label: '(—)' },
      { value: '0',  label: '0 Exit Pt' },
    ];
    // 96/97 are only ever offered on jump1 in the legacy app.
    if (isJump1) {
      opts.push({ value: '97', label: '97 Last Scan (keep back)' });
      opts.push({ value: '96', label: '96 Last Scan + link photo' });
    }
    opts.push({ value: '98', label: '98 Incidents' });
    opts.push({ value: '99', label: '99 Exit Route' });
    slots.forEach((s, i) => {
      if (i > slotIdx && s.questionId) {
        const fq = questionsById[s.questionId];
        opts.push({ value: String(i + 1), label: `Seq ${i + 1}` + (fq ? ` ${fq.description.slice(0, 28)}` : '') });
      }
    });
    jumpablePoints.forEach(rp => {
      opts.push({
        value: rp.point.point_code.padEnd(10),
        label: `Pt: ${rp.point.point_code.trim()}`,
      });
    });
    return opts;
  }, [isCloneDest, isJump1, slotIdx, slots, jumpablePoints, questionsById]);

  const selectedLabel = options.find(o => o.value === value)?.label ?? '';

  return (
    <select
      className={styles.jumpSel}
      style={{ color: jumpValueColor(value) }}
      value={value}
      title={selectedLabel}
      onChange={e => onChange(e.target.value)}
      disabled={disabled}
    >
      {options.map(o => (
        <option key={o.value} value={o.value} style={{ color: jumpOptionColor(o.value) }}>{o.label}</option>
      ))}
    </select>
  );
}

// A native <select>'s <option> text can't be part-colored (e.g. "Seq 4" in
// blue, "COMMENT" in black, within the same option) -- that's a hard
// browser limitation, not a CSS gap. This colors the whole displayed value
// instead, by which of the three jump-target categories it falls into, so
// the three are still easy to tell apart at a glance:
//   Seq N        (same-checklist jump, plain digit string)      -> blue
//   0/96/97/98/99 (control-flow special codes)                  -> amber
//   Pt: CODE     (cross-point jump, 10-char padded point code)   -> black
function jumpValueColor(value) {
  if (!value) return undefined; // '(—)' / no jump -- inherit the default color
  // Point-code values are always .padEnd(10) (see `options` above), and many
  // real point codes are pure digits (e.g. "0000000005") -- checking length
  // FIRST is required, or a plain-numeric point code would be misread as a
  // Seq number (seq/special-code values are never longer than 2 chars).
  if (value.length === 10) return undefined;
  if (['0', '96', '97', '98', '99'].includes(value)) return '#b45309';
  return '#3b6fe0';
}

// Chromium's native <option> popup inherits `color` from the owning <select>
// when an option has no color of its own -- so with jumpValueColor(value)
// left undefined for '(—)' and Pt: codes, every "uncolored" option was
// silently picking up whatever category color the CURRENTLY SELECTED value
// happened to be (e.g. all options rendering amber because "0 Exit Pt" was
// selected). Options need an explicit color on every branch, never
// `undefined`, so they can't inherit the select's current color.
function jumpOptionColor(value) {
  const c = jumpValueColor(value);
  return c ?? '#1a1a2e';
}

// ─────────────────────────────────────────────────────────────────────────────
// QuestionPicker — filter + select in a compact form
// ─────────────────────────────────────────────────────────────────────────────
export function QuestionPicker({ value, onChange, allQuestions, disabled }) {
  const [filter, setFilter] = useState('');

  const filtered = useMemo(() => {
    if (!filter) return allQuestions;
    const lc = filter.toLowerCase();
    const res = allQuestions.filter(q =>
      q.description.toLowerCase().includes(lc) ||
      (q.category ?? '').toLowerCase().includes(lc)
    );
    if (value && !res.find(q => q.id === value)) {
      const sel = allQuestions.find(q => q.id === value);
      if (sel) return [sel, ...res];
    }
    return res;
  }, [filter, allQuestions, value]);

  return (
    <div className={styles.qPickerWrap}>
      <input
        className={styles.qFilter}
        value={filter}
        onChange={e => setFilter(e.target.value)}
        placeholder="filter…"
        title="Type to filter questions"
        disabled={disabled}
      />
      <select
        className={styles.qSel}
        value={value ?? ''}
        onChange={e => {
          setFilter('');
          onChange(e.target.value ? parseInt(e.target.value, 10) : null);
        }}
        disabled={disabled}
      >
        <option value="">— select —</option>
        {filtered.map(q => (
          <option key={q.id} value={q.id}>
            {q.category ? `[${q.category}] ` : ''}{q.description}
          </option>
        ))}
      </select>
    </div>
  );
}
