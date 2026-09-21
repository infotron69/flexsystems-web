import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import html2canvas from 'html2canvas';
import {
  getGuards, getCustomers, getSites, getRoutes, getRoutePoints,
  getRoutePointQuestions, getPointsByCode, getPointAllQuestions,
  getIncidents, getIncidentSub1, getIncidentSub2, getIncidentSub3,
  createTransaction, getListFile,
} from '../api/client';
import { jumpLabels } from './pointQuestionsShared';
import logo from '../assets/flexsystems-logo.png';
import styles from './PdaEmulator.module.css';

function timestampForFilename() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

const MAX_QA_SLOTS = 10;

// GET /points/{id}/questions returns a point's RoutePointQuestion rows across
// every route it's allocated to -- group by route and keep only the fullest
// one, same fix as PointQuestions.jsx's flow chart (a point often carries an
// identical seqno sequence independently on more than one route).
function oneRouteWorth(rows) {
  if (!rows.length) return rows;
  const byRoute = new Map();
  for (const r of rows) {
    if (!byRoute.has(r.route_id)) byRoute.set(r.route_id, []);
    byRoute.get(r.route_id).push(r);
  }
  let best = [];
  for (const list of byRoute.values()) {
    if (list.length > best.length) best = list;
  }
  return best;
}

// Resolves a point code's own checklist -- same route/point vs cross-route
// fallback as PointQuestions.jsx's fetchPointQuestionsByCode, generalized to
// not depend on that component's state.
async function resolveChecklist(code, { routeId, routePoints }) {
  const same = routePoints.find(r => r.point?.point_code?.trim() === code);
  if (same) {
    try {
      const qs = await getRoutePointQuestions(routeId, same.point_id);
      if (qs.length) return { point: same.point, questions: qs };
    } catch { /* fall through */ }
    try { return { point: same.point, questions: oneRouteWorth(await getPointAllQuestions(same.point_id)) }; }
    catch { return { point: same.point, questions: [] }; }
  }
  try {
    const pts = await getPointsByCode(code);
    if (!pts.length) return { point: null, questions: [] };
    return { point: pts[0], questions: oneRouteWorth(await getPointAllQuestions(pts[0].id)) };
  } catch { return { point: null, questions: [] }; }
}

const emptyVisit = () => ({ scannedPointId: null, scannedPointCode: '', scannedPointDesc: '', answers: [], note: null });

export default function PdaEmulator() {
  const navigate = useNavigate();
  // Deep-link support: /setup/pda-emulator/:routeId/:pointId (e.g. a "PDA
  // Emulator ->" shortcut from Route Point Questions) pre-loads the route
  // and immediately scans straight into that point's checklist, skipping
  // the customer/site/route picker -- only the operator still needs picking.
  const { routeId: deepRouteId, pointId: deepPointId } = useParams();
  const phoneFrameRef = useRef(null);
  const [recording, setRecording] = useState(false);
  const mediaRecorderRef = useRef(null);

  // ── Setup stage ──────────────────────────────────────────────────────────
  // A deep link is a testing shortcut (jump straight to a specific route's
  // checklist) -- it skips the new-device boot/setup lifecycle below since
  // that's not what a deep link is for. A plain visit starts the same way an
  // actual out-of-the-box device would: splash, then "not set up yet".
  // home = the real device's persistent Main screen (clock, clock-in status,
  // Select Route) -- clockIn and routePicker are separate screens reached
  // from it, matching the real app rather than one combined form.
  const [stage, setStage] = useState(deepRouteId ? 'clockIn' : 'boot'); // boot | home | clockIn | routePicker | patrol | checklist | incident | endRoute | summary
  const [clockedIn, setClockedIn] = useState(false);
  const [clockTime, setClockTime] = useState(new Date());
  const [guards, setGuards] = useState([]);
  const [sites, setSites] = useState([]);
  const [allRoutes, setAllRoutes] = useState([]);
  const [expandedSites, setExpandedSites] = useState({});
  const [guardCard, setGuardCard] = useState('');
  const [operatorEntry, setOperatorEntry] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [siteId, setSiteId] = useState('');
  const [routeId, setRouteId] = useState(deepRouteId ?? '');
  const [routePoints, setRoutePoints] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    getGuards().then(setGuards);
    // Nearly every tenant has exactly one real (non-Incidents1) customer, so
    // there's nothing worth picking -- auto-select it instead of showing a
    // dropdown for a choice that doesn't exist in practice.
    getCustomers().then(cs => { if (cs.length) selectCustomer(cs[0].id); });
  }, []);

  // Splash auto-advances like a real boot screen -- also click-to-skip so a
  // live demo isn't stuck waiting on it. Skips straight to Home: this
  // emulator always runs against an already-provisioned tenant, so there's
  // no "scan setup code" step to show.
  useEffect(() => {
    if (stage !== 'boot') return;
    const t = setTimeout(() => setStage('home'), 1600);
    return () => clearTimeout(t);
  }, [stage]);

  // Live clock on the Home screen, same as the real device.
  useEffect(() => {
    const t = setInterval(() => setClockTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Same lookup as ClockInScreen.js's findOperator: exact card number, the
  // numeric value with leading zeros stripped (badge barcodes often omit
  // them), or a name substring.
  function findGuard(value) {
    const v = (value || '').trim().toUpperCase();
    if (!v) return null;
    const vStripped = v.replace(/^0+/, '') || '0';
    return guards.find(g => {
      const gid = (g.card_number || '').trim().toUpperCase();
      const gidStripped = gid.replace(/^0+/, '') || '0';
      const fullName = `${g.first_name ?? ''} ${g.last_name ?? ''}`.trim().toUpperCase();
      return gid === v || gidStripped === vStripped || fullName.includes(v);
    });
  }

  function submitOperatorEntry() {
    const g = findGuard(operatorEntry);
    if (!g) { setErr(`No operator found for: "${operatorEntry}"`); return; }
    setErr(null);
    setGuardCard(g.id);
    setOperatorEntry('');
  }

  function confirmClockIn() {
    if (!guardCard) { setErr('Pick an operator first.'); return; }
    setErr(null);
    setClockedIn(true);
    // A deep link only needs an operator picked -- site/customer/route are
    // already known, so skip straight into the patrol it named instead of
    // detouring through Home and the route picker.
    if (deepRouteId) startPatrol();
    else setStage('home');
  }

  function clockOut() {
    setClockedIn(false);
    setGuardCard('');
  }

  // Renders just the phone frame (not the surrounding admin-tool chrome) to
  // a canvas and downloads it -- marketing screenshots of a specific screen,
  // not a screenshot of this whole page.
  async function takeScreenshot() {
    if (!phoneFrameRef.current) return;
    const canvas = await html2canvas(phoneFrameRef.current, { backgroundColor: null, scale: 2 });
    canvas.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `flexpatrol-${stage}-${timestampForFilename()}.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  }

  // getDisplayMedia/MediaRecorder rather than a canvas-frame loop -- a real
  // screen/tab capture the browser already knows how to encode, instead of
  // reimplementing video encoding client-side. The browser's own share-a-tab
  // picker is unavoidable (no way to pre-target just the phone frame from
  // that dialog), so the person recording still has to choose this tab --
  // but once they do, Region Capture (below) crops the resulting video down
  // to just the phone frame automatically.
  async function toggleRecording() {
    if (recording) {
      mediaRecorderRef.current?.stop();
      return;
    }
    let stream;
    try {
      // preferCurrentTab (Chrome/Edge) pre-selects this tab in the share
      // picker so it's a single confirm click instead of hunting for the
      // right tab/window -- the picker itself can't be skipped entirely,
      // browsers won't let a page silently choose what it records.
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'browser' },
        audio: false,
        preferCurrentTab: true,
      });
    } catch {
      return; // person cancelled the share picker
    }

    // Region Capture (Chrome/Edge 104+): crops the captured video to the
    // phone frame's on-screen bounds, so the recording shows just the
    // device -- not the sidebar/admin chrome around it -- as long as the
    // person picked "this tab" in the dialog above. Silently no-ops on
    // browsers without it, or if they picked a different tab/window/screen
    // instead (cropTo only works against a surface that includes the
    // element it's cropping to) -- recording still proceeds uncropped.
    const [videoTrack] = stream.getVideoTracks();
    if (window.CropTarget && phoneFrameRef.current && videoTrack.cropTo) {
      try {
        const cropTarget = await CropTarget.fromElement(phoneFrameRef.current);
        await videoTrack.cropTo(cropTarget);
      } catch {
        // Not croppable (different tab/window/screen picked, or the
        // element moved) -- keep recording, just uncropped.
      }
    }

    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    const chunks = [];
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      setRecording(false);
      const blob = new Blob(chunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `flexpatrol-recording-${timestampForFilename()}.webm`;
      a.click();
      URL.revokeObjectURL(url);
    };
    // The browser's own "Stop sharing" control ends the stream outside our
    // button entirely -- treat that the same as pressing Stop here.
    stream.getVideoTracks()[0].onended = () => recorder.stop();
    mediaRecorderRef.current = recorder;
    recorder.start();
    setRecording(true);
  }

  function selectCustomer(id) {
    setCustomerId(id); setSiteId(''); setRouteId(''); setSites([]); setAllRoutes([]);
    if (!id) return;
    getSites({ customer_id: id }).then(setSites);
  }

  // Mirrors RoutesScreen.js: one section per site, routes listed under it --
  // no separate site-picker step, since the real device shows every site's
  // routes at once (whatever's in ROUTE.TXT) rather than drilling down.
  useEffect(() => {
    const realSites = sites.filter(s => s.id !== 'Incidents1' && s.name !== 'Incidents1');
    if (!realSites.length) { setAllRoutes([]); return; }
    Promise.all(
      realSites.map(s => getRoutes({ site_id: s.id }).then(rs => rs.map(r => ({ ...r, siteId: s.id, siteName: s.name }))))
    ).then(lists => setAllRoutes(lists.flat()));
  }, [sites]);

  function toggleSite(siteId) {
    setExpandedSites(prev => ({ ...prev, [siteId]: prev[siteId] === false ? true : false }));
  }

  function selectRoute(route) {
    setRouteId(route.id);
    setSiteId(route.siteId);
  }

  async function startPatrol() {
    if (!guardCard || !routeId) { setErr('Pick an operator and a route first.'); return; }
    setErr(null);
    setLoading(true);
    try {
      const rp = await getRoutePoints(routeId);
      const filtered = rp.filter(r => r.point);
      setRoutePoints(filtered);
      setVisitLog([]);
      setStage('patrol');

      if (deepPointId) {
        const target = filtered.find(r => r.point?.point_code?.trim() === deepPointId.trim());
        if (target) await enterPointChecklist(target, routeId);
        else setErr(`"${deepPointId}" is not on this route.`);
      } else {
        // FIRSTPOINT convention (legacy PDA, FlexPatrol-Mobile's
        // getFirstPointForRoute/FirstPointCheck): a point whose code starts
        // with "FIRST" is auto-scanned the instant the patrol screen opens,
        // no manual scan needed -- only when starting fresh, not when a
        // specific point was explicitly deep-linked.
        const firstPoint = filtered.find(r => r.point?.point_code?.trim().toUpperCase().startsWith('FIRST'));
        if (firstPoint) await enterPointChecklist(firstPoint, routeId);
      }
    } catch {
      setErr('Failed to load route points');
    } finally {
      setLoading(false);
    }
  }

  // ── Patrol stage ─────────────────────────────────────────────────────────
  const [visitLog, setVisitLog] = useState([]);
  const [scanCode, setScanCode] = useState('');

  const guard = guards.find(g => g.id === guardCard || g.card_number === guardCard);
  const guardName = guard ? `${guard.first_name ?? ''} ${guard.last_name}`.trim() : guardCard;

  // Shared by scanPoint (looks up rp by typed/clicked code) and startPatrol's
  // deep-link auto-scan (already has rp from the just-fetched route points,
  // so it doesn't need to wait on routePoints state to settle first).
  async function enterPointChecklist(rp, forRouteId) {
    setErr(null);
    setLoading(true);
    try {
      const qs = await getRoutePointQuestions(forRouteId, rp.point_id);
      const cl = qs.length ? { point: rp.point, questions: qs } : { point: rp.point, questions: oneRouteWorth(await getPointAllQuestions(rp.point_id)) };
      setCurrentVisit({ ...emptyVisit(), scannedPointId: rp.point_id, scannedPointCode: rp.point.point_code.trim(), scannedPointDesc: rp.point.description });
      setTrail([rp.point.point_code.trim()]);
      if (!cl.questions.length) {
        // No checklist configured anywhere for this point -- record the
        // visit immediately, same as a real PDA scan of a bare checkpoint.
        finalizeVisit({ ...emptyVisit(), scannedPointId: rp.point_id, scannedPointCode: rp.point.point_code.trim(), scannedPointDesc: rp.point.description });
        return;
      }
      setChecklist(cl);
      setIdx(0);
      setHistory([]);
      setScanCode('');
      setStage('checklist');
    } catch {
      setErr('Failed to load this point\'s questions');
    } finally {
      setLoading(false);
    }
  }

  function scanPoint(code) {
    const trimmed = (code || '').trim();
    if (!trimmed) return;
    const rp = routePoints.find(r => r.point?.point_code?.trim() === trimmed);
    if (!rp) { setErr(`"${trimmed}" is not on this route.`); return; }
    return enterPointChecklist(rp, routeId);
  }

  // ── Checklist stage ──────────────────────────────────────────────────────
  const [currentVisit, setCurrentVisit] = useState(emptyVisit());
  const [checklist, setChecklist] = useState({ point: null, questions: [] });
  const [idx, setIdx] = useState(0);
  const [trail, setTrail] = useState([]);
  // Snapshots taken right before each jump/advance -- lets the Back button
  // step to the previous question (including across a cross-point jump)
  // instead of only abandoning the whole visit.
  const [history, setHistory] = useState([]);
  const question = checklist.questions[idx]?.question ?? null;
  const rpq = checklist.questions[idx] ?? null;

  function finalizeVisit(visit = currentVisit) {
    setVisitLog(prev => [...prev, visit]);
    setCurrentVisit(emptyVisit());
    setChecklist({ point: null, questions: [] });
    setIdx(0);
    setTrail([]);
    setHistory([]);
    setStage('patrol');
  }

  // `visit` is threaded through explicitly rather than read from the
  // `currentVisit` closure -- resolveJump can run synchronously right after
  // recordAnswer's setState, before that update has actually flushed, so
  // reading `currentVisit` here would silently drop the answer that was
  // just recorded.
  async function resolveJump(jumpValue, visit = currentVisit) {
    const v = (jumpValue || '').trim();
    if (!v) { advanceSequential(visit); return; }
    if (v === '0') { finalizeVisit(visit); return; }
    if (v === '97' || v === '96') { finalizeVisit({ ...visit, note: 'Repeat Last Scan requested' }); return; }
    if (v === '98') { setCurrentVisit(visit); setStage('incident'); return; }
    if (v === '99') { finalizeVisit(visit); setStage('endRoute'); return; }
    if (/^\d{1,4}$/.test(v)) {
      const n = parseInt(v, 10);
      const targetIdx = checklist.questions.findIndex(q => q.seqno === n);
      if (targetIdx < 0) { finalizeVisit(visit); return; }
      setCurrentVisit(visit);
      setIdx(targetIdx);
      return;
    }
    setLoading(true);
    try {
      const resolved = await resolveChecklist(v, { routeId, routePoints });
      if (!resolved.questions.length) {
        finalizeVisit({ ...visit, note: `${visit.note ?? ''} (jumped to ${v}, no further checklist found)`.trim() });
        return;
      }
      setCurrentVisit(visit);
      setTrail(prev => [...prev, v]);
      setChecklist(resolved);
      setIdx(0);
    } finally {
      setLoading(false);
    }
  }

  // Abandon the in-progress visit without recording it -- mirrors backing out
  // of a scan on a real device before it's finalized (nothing is written
  // until a jump/finalize resolves the checklist).
  function abandonVisit() {
    setCurrentVisit(emptyVisit());
    setChecklist({ point: null, questions: [] });
    setIdx(0);
    setTrail([]);
    setHistory([]);
    resetIncidentPicker();
    setStage('patrol');
  }

  // Back button: step to the previous question (undoing its answer) if one
  // was recorded this visit, otherwise nothing to step back to -- abandon.
  function goBack() {
    if (history.length === 0) { abandonVisit(); return; }
    const prev = history[history.length - 1];
    setHistory(h => h.slice(0, -1));
    setChecklist(prev.checklist);
    setIdx(prev.idx);
    setCurrentVisit(prev.currentVisit);
    setTrail(prev.trail);
    resetIncidentPicker();
    setStage('checklist');
  }

  function advanceSequential(visit = currentVisit) {
    setCurrentVisit(visit);
    if (idx + 1 < checklist.questions.length) setIdx(idx + 1);
    else finalizeVisit(visit);
  }

  // CLONE JUMP (type 9) is navigation-only -- follow it immediately, no
  // answer UI, no answer recorded (mirrors the manual: "the app records
  // everything against the checkpoint you actually scanned").
  useEffect(() => {
    if (stage === 'checklist' && rpq && question?.question_type === '9') {
      resolveJump(rpq.jump1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, idx, checklist]);

  function submitAnswer(answerText, jumpValue) {
    // A RoutePointQuestion row can exist with no Question assigned at all
    // (an empty slot in the checklist) -- nothing to record in that case,
    // just resolve wherever its jump points.
    // Only ALPHA/NUM (type 3) is genuine free-typed text a real device's
    // physical keyboard would force to caps -- every other type either
    // already reads as caps (YES/NO), is numeric, or carries raw data a
    // case change would corrupt outright (SIGNATURE strokes, PHOTO/SHOWFILE
    // filenames, ASSET SCAN tag values), so those are left exactly as-is.
    const recordedAnswer = question?.question_type === '3' && answerText
      ? answerText.toUpperCase()
      : answerText;
    const updatedVisit = !question || currentVisit.answers.length >= MAX_QA_SLOTS ? currentVisit : {
      ...currentVisit,
      answers: [...currentVisit.answers, { questionId: question.id, description: question.description, answer: recordedAnswer }],
    };
    setHistory(h => [...h, { checklist, idx, currentVisit, trail }]);
    resolveJump(jumpValue, updatedVisit);
  }

  // ── Incident picker (mid-checklist jump=98, or an End Route missed point) ──
  const [incMasters, setIncMasters] = useState([]);
  const [incSub1s, setIncSub1s] = useState([]);
  const [incSub2s, setIncSub2s] = useState([]);
  const [incSub3s, setIncSub3s] = useState([]);
  const [selMaster, setSelMaster] = useState(null);
  const [selSub1, setSelSub1] = useState(null);
  const [selSub2, setSelSub2] = useState(null);
  const [selSub3, setSelSub3] = useState(null);
  // End Route's missed-point reason is ONE shared drilldown for the whole
  // batch, not one per point -- matches the real app's single "REASON FOR
  // MISSED POINTS" picker in its End Route modal (PatrolScreen.js), not a
  // per-row dropdown. Kept as separate state from the mid-checklist incident
  // picker above so the two don't leak into each other.
  const [missedIncMasters, setMissedIncMasters] = useState([]);
  const [missedIncSub1s, setMissedIncSub1s] = useState([]);
  const [missedIncSub2s, setMissedIncSub2s] = useState([]);
  const [missedIncSub3s, setMissedIncSub3s] = useState([]);
  const [missedSelMaster, setMissedSelMaster] = useState(null);
  const [missedSelSub1, setMissedSelSub1] = useState(null);
  const [missedSelSub2, setMissedSelSub2] = useState(null);
  const [missedSelSub3, setMissedSelSub3] = useState(null);

  useEffect(() => { if (stage === 'incident' && incMasters.length === 0) getIncidents().then(setIncMasters); }, [stage, incMasters.length]);
  useEffect(() => { if (stage === 'endRoute' && missedIncMasters.length === 0) getIncidents().then(setMissedIncMasters); }, [stage, missedIncMasters.length]);

  function pickMaster(item) {
    setSelMaster(item); setSelSub1(null); setSelSub2(null); setSelSub3(null);
    setIncSub1s([]); setIncSub2s([]); setIncSub3s([]);
    if (item) getIncidentSub1(item.id).then(setIncSub1s);
  }
  function pickSub1(item) {
    setSelSub1(item); setSelSub2(null); setSelSub3(null);
    setIncSub2s([]); setIncSub3s([]);
    if (item) getIncidentSub2(item.id).then(setIncSub2s);
  }
  function pickSub2(item) {
    setSelSub2(item); setSelSub3(null);
    setIncSub3s([]);
    if (item) getIncidentSub3(item.id).then(setIncSub3s);
  }

  async function confirmIncident() {
    const deepest = selSub3 ?? selSub2 ?? selSub1 ?? selMaster;
    if (!deepest) { setErr('Select at least an incident category.'); return; }
    const withInc = {
      ...currentVisit,
      inc: selMaster?.code ?? null,
      inc1: selSub1?.code ?? null,
      inc2: selSub2?.code ?? null,
      inc3: selSub3?.code ?? null,
    };
    setCurrentVisit(withInc);
    resetIncidentPicker();

    if (deepest.has_sop_questions === 'Y' && deepest.sop_jump_point) {
      setLoading(true);
      try {
        const resolved = await resolveChecklist(deepest.sop_jump_point.trim(), { routeId, routePoints });
        if (resolved.questions.length) {
          setTrail(prev => [...prev, deepest.sop_jump_point.trim()]);
          setChecklist(resolved);
          setIdx(0);
          setStage('checklist');
          return;
        }
      } finally {
        setLoading(false);
      }
    }
    finalizeVisit(withInc);
  }

  function resetIncidentPicker() {
    setSelMaster(null); setSelSub1(null); setSelSub2(null); setSelSub3(null);
    setIncSub1s([]); setIncSub2s([]); setIncSub3s([]);
  }

  function pickMissedMaster(item) {
    setMissedSelMaster(item); setMissedSelSub1(null); setMissedSelSub2(null); setMissedSelSub3(null);
    setMissedIncSub1s([]); setMissedIncSub2s([]); setMissedIncSub3s([]);
    if (item) getIncidentSub1(item.id).then(setMissedIncSub1s);
  }
  function pickMissedSub1(item) {
    setMissedSelSub1(item); setMissedSelSub2(null); setMissedSelSub3(null);
    setMissedIncSub2s([]); setMissedIncSub3s([]);
    if (item) getIncidentSub2(item.id).then(setMissedIncSub2s);
  }
  function pickMissedSub2(item) {
    setMissedSelSub2(item); setMissedSelSub3(null);
    setMissedIncSub3s([]);
    if (item) getIncidentSub3(item.id).then(setMissedIncSub3s);
  }
  function resetMissedReasonPicker() {
    setMissedSelMaster(null); setMissedSelSub1(null); setMissedSelSub2(null); setMissedSelSub3(null);
    setMissedIncSub1s([]); setMissedIncSub2s([]); setMissedIncSub3s([]);
  }

  // ── End Route / summary ──────────────────────────────────────────────────
  // Points whose code starts with C/V/H (Clone/Virtual/Half-clone) are never
  // real standalone checkpoints -- they only exist as SOP jump targets, so
  // the real PDA excludes them from "missed" regardless of whether they were
  // scanned (getMissedPointsFromScanned's isVirtualCloneOrHalf gate, both in
  // the original VB.NET PocketPC app and its Xamarin rewrite).
  const missedPoints = routePoints.filter(rp =>
    !/^[cvh]/i.test(rp.point.point_code.trim()) && !visitLog.some(v => v.scannedPointId === rp.point_id)
  );
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState(null);

  // Exit stays clickable at all times, same as the real app -- it blocks
  // with an error rather than disabling the button (PatrolScreen.js's
  // finishRoute: tapping EXIT always fires, then Alert.alert('Incident
  // Reason Required', ...) if none was picked, when there's anything missed).
  function finishEndRoute() {
    const missedReason = missedSelSub3 ?? missedSelSub2 ?? missedSelSub1 ?? missedSelMaster;
    if (missedPoints.length > 0 && !missedReason) {
      setErr('Incident Reason Required — select a reason for the missed points before exiting.');
      return;
    }
    setErr(null);
    const missedVisits = missedPoints.map(rp => ({
      scannedPointId: rp.point_id,
      scannedPointCode: rp.point.point_code.trim(),
      scannedPointDesc: rp.point.description,
      missed: true,
      inc: missedSelMaster?.code ?? null,
      inc1: missedSelSub1?.code ?? null,
      inc2: missedSelSub2?.code ?? null,
      inc3: missedSelSub3?.code ?? null,
      answers: [],
      note: null,
    }));
    setVisitLog(prev => [...prev, ...missedVisits]);
    setStage('summary');
  }

  function continuePatrol() {
    setErr(null);
    resetMissedReasonPicker();
    setStage('patrol');
  }

  // The phone frame's Android nav bar back triangle -- mirrors whatever the
  // in-app Back control for the current stage already does, same as a real
  // device's hardware/gesture back button.
  function handleAndroidBack() {
    if (stage === 'checklist' || stage === 'incident') goBack();
    else if (stage === 'endRoute') continuePatrol();
    else if (stage === 'clockIn' || stage === 'routePicker') setStage('home');
    else navigate('/setup');
  }

  async function submitAsTestTransactions() {
    setSubmitting(true);
    setSubmitResult(null);
    const now = new Date().toISOString();
    const results = { ok: 0, failed: 0, errors: [] };
    for (const v of visitLog) {
      const payload = {
        route_id: routeId,
        point_id: v.scannedPointId,
        trans_date: now,
        trans_time: now,
        point_desc: v.scannedPointDesc,
        // Real PDA hardware keyboards force caps on everything typed -- this
        // emulator only means anything as a stand-in for that device, so its
        // free-text fields need the same transform, or default_response
        // exception-matching (also stored upper-case) would misbehave here
        // in a way it never would on a real device.
        guard: (guardName || 'EMULATOR').toUpperCase(),
        notes: v.note ? v.note.toUpperCase() : null,
        inc: v.inc ?? null, inc1: v.inc1 ?? null, inc2: v.inc2 ?? null, inc3: v.inc3 ?? null,
        missed_point: v.missed ? 'Y' : 'N',
        site_code: siteId || null,
        customer_code: customerId || null,
        pda_id: 'EMULATOR',
      };
      v.answers.slice(0, MAX_QA_SLOTS).forEach((a, i) => {
        payload[`question_id${i + 1}`] = a.questionId;
        payload[`answer${i + 1}`] = a.answer;
      });
      try {
        await createTransaction(payload);
        results.ok += 1;
      } catch (ex) {
        results.failed += 1;
        results.errors.push(`${v.scannedPointCode}: ${ex.response?.data?.detail ?? ex.message}`);
      }
    }
    setSubmitResult(results);
    setSubmitting(false);
  }

  function startNewSimulation() {
    setStage('home');
    setVisitLog([]);
    setCurrentVisit(emptyVisit());
    setChecklist({ point: null, questions: [] });
    setIdx(0);
    setTrail([]);
    setMissedReasons({});
    setSubmitResult(null);
    setScanCode('');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className={styles.pageOuter}>
      <div className={styles.deviceLabel}>PDA Emulator — device preview</div>
      <div className={styles.captureToolbar}>
        <button className={styles.captureBtn} onClick={takeScreenshot}>📸 Screenshot</button>
        <button className={recording ? styles.captureBtnRecording : styles.captureBtn} onClick={toggleRecording}>
          {recording ? '⏹ Stop Recording' : '⏺ Record'}
        </button>
      </div>
      <div className={styles.phoneFrame} ref={phoneFrameRef}>
        <div className={styles.speaker} />

        <div className={styles.statusBar}>
          <span>9:41</span>
          <span className={styles.statusIcons}>
            <span className={styles.signalIcon} aria-hidden="true">
              <i /><i /><i /><i />
            </span>
            <span className={styles.wifiIcon} aria-hidden="true" />
            <span className={styles.batteryIcon} aria-hidden="true"><i /></span>
          </span>
        </div>

        <div className={styles.appBar}>
          <button className={styles.appBarBack} onClick={() => navigate('/setup')} aria-label="Back to Setup">←</button>
          <span className={styles.appBarTitle}>FlexPatrol Mobile</span>
        </div>

        <div className={styles.phoneContent}>
          {err && <div className={styles.error} onClick={() => setErr(null)}>{err} (click to dismiss)</div>}

      {stage === 'boot' && (
        <div className={styles.bootScreen} onClick={() => setStage('home')}>
          <img src={logo} alt="Flex Systems" className={styles.bootLogo} />
        </div>
      )}

      {stage === 'home' && (
        <div className={styles.homeScreen}>
          <img src={logo} alt="Flex Systems" className={styles.homeLogo} />
          <div className={styles.homeClock}>{clockTime.toLocaleTimeString('en-US', { hour12: false })}</div>
          <div className={styles.homeDate}>
            {clockTime.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
          </div>

          <div className={styles.statusPill}>
            {clockedIn ? (
              <>
                <span className={styles.statusDotOn} aria-hidden="true" />
                <span className={styles.statusText}>
                  <span className={styles.statusLabel}>Clocked In</span>
                  <span className={styles.statusName}>{guardName}</span>
                </span>
                <button className={styles.clockOutBtn} onClick={clockOut}>Clock Out</button>
              </>
            ) : (
              <>
                <span className={styles.statusDotOff} aria-hidden="true" />
                <span className={styles.statusLabel}>Not Clocked In</span>
              </>
            )}
          </div>

          <div className={styles.homeSectionLabel}>Actions</div>
          {!clockedIn ? (
            <button className={styles.homeActionBtn} onClick={() => setStage('clockIn')}>🔑 Clock In</button>
          ) : (
            <button className={styles.homeActionBtn} onClick={() => setStage('routePicker')}>📋 Select Route</button>
          )}

          <div className={styles.homeSectionLabel}>System</div>
          <div className={styles.homeTileRow}>
            <div className={styles.homeTile}><span>📡</span>Communications</div>
            <div className={styles.homeTile}><span>⚙️</span>Settings</div>
          </div>

          <div className={styles.homeFooter}>
            FlexPatrol v1.1.0 (Emulator)<br />
            © 2026 FlexSystems, LLC. All rights reserved.
          </div>
          <button className={styles.exitAppBtn} onClick={() => navigate('/setup')}>Exit App</button>
        </div>
      )}

      {stage === 'clockIn' && (
        <div className={styles.clockInScreen}>
          <div className={styles.searchRow}>
            <input
              className={styles.searchInput}
              value={operatorEntry}
              onChange={e => setOperatorEntry(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submitOperatorEntry()}
              placeholder="Enter operator ID or name…"
              autoFocus
            />
            <button className={styles.goBtn} onClick={submitOperatorEntry}>GO</button>
          </div>

          <div className={styles.clockInMid}>
            {guardCard && guard && (
              <div className={styles.selectedOperatorCard}>
                <span className={styles.operatorAvatar}>
                  {((guard.first_name?.[0] || '') + (guard.last_name?.[0] || '')).toUpperCase()}
                </span>
                <span className={styles.operatorInfo}>
                  <span className={styles.operatorName}>{guardName}</span>
                  <span className={styles.operatorIdText}>ID: {guard.card_number?.trim()}</span>
                </span>
                <span className={styles.operatorCheck}>✓</span>
              </div>
            )}
            {deepRouteId && (
              <div className={styles.deepLinkNote}>
                Pre-loaded route <strong>{deepRouteId}</strong>
                {deepPointId && <> — will scan point <strong>{deepPointId}</strong> immediately</>}
              </div>
            )}
          </div>

          <div className={styles.clockInFooter}>
            <button className={styles.clockInBtn} onClick={confirmClockIn} disabled={loading || !guardCard}>
              {loading ? 'Loading…' : guardCard ? `CLOCK IN — ${guardName}` : 'ENTER OR SCAN OPERATOR ID'}
            </button>
          </div>
        </div>
      )}

      {stage === 'routePicker' && (
        <div className={styles.routePickerScreen}>
          {allRoutes.length === 0 ? (
            <div className={styles.emptyState}>
              <p>No routes loaded.</p>
            </div>
          ) : (
            <div className={styles.routeSections}>
              {Object.values(
                allRoutes.reduce((acc, r) => {
                  (acc[r.siteId] ??= { siteId: r.siteId, siteName: r.siteName, routes: [] }).routes.push(r);
                  return acc;
                }, {})
              ).map(section => {
                const isExpanded = expandedSites[section.siteId] !== false;
                return (
                  <div key={section.siteId}>
                    <button className={styles.siteHeader} onClick={() => toggleSite(section.siteId)}>
                      <span className={styles.siteIcon}>{isExpanded ? '▾' : '▸'}</span>
                      <span className={styles.siteName}>{section.siteName}</span>
                      <span className={styles.routeCount}>{section.routes.length}</span>
                    </button>
                    {isExpanded && section.routes.map(r => {
                      const isSelected = routeId === r.id;
                      return (
                        <button
                          key={r.id}
                          className={isSelected ? `${styles.routeRow} ${styles.routeRowSelected}` : styles.routeRow}
                          onClick={() => selectRoute(r)}
                        >
                          <span className={isSelected ? `${styles.routeDot} ${styles.routeDotSelected}` : styles.routeDot} />
                          <span className={styles.routeInfo}>
                            <span className={isSelected ? `${styles.routeName} ${styles.routeNameSelected}` : styles.routeName}>
                              {r.name}
                            </span>
                            <span className={styles.routeIdText}>{r.route_code}</span>
                          </span>
                          {isSelected && <span className={styles.routeCheck}>✓</span>}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}

          <div className={styles.routeFooter}>
            {routeId && (
              <div className={styles.selectedRouteBadge}>
                {allRoutes.find(r => r.id === routeId)?.name}
              </div>
            )}
            <button className={styles.beginRouteBtn} onClick={startPatrol} disabled={loading || !routeId}>
              {loading ? 'Loading…' : routeId ? 'BEGIN ROUTE →' : 'SELECT A ROUTE ABOVE'}
            </button>
          </div>
        </div>
      )}

      {stage === 'patrol' && (
        <div className={styles.card}>
          <div className={styles.progressRow}>
            <strong>{visitLog.length} / {routePoints.length}</strong> points visited
            <button className={styles.endRouteBtn} onClick={() => setStage('endRoute')}>END ROUTE</button>
          </div>

          <div className={styles.scanRow}>
            <input
              className={styles.scanInput}
              value={scanCode}
              onChange={e => setScanCode(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && scanPoint(scanCode)}
              placeholder="Scan (type) a point code…"
              autoFocus
            />
            <button className={styles.primaryBtn} onClick={() => scanPoint(scanCode)} disabled={loading}>GO</button>
          </div>

          <ul className={styles.pointList}>
            {[...routePoints].sort((a, b) => a.point.point_code.localeCompare(b.point.point_code)).map(rp => {
              const done = visitLog.some(v => v.scannedPointId === rp.point_id);
              return (
                <li key={rp.point_id} className={done ? styles.pointDone : ''}>
                  <div className={styles.pointTopRow}>
                    <span className={styles.pointCode}>{rp.point.point_code.trim()}</span>
                    <span className={styles.pointStatus}>{done ? '✓ Done' : 'Pending'}</span>
                  </div>
                  <div className={styles.pointBottomRow}>
                    <span className={styles.pointDesc}>{rp.point.description}</span>
                    <button className={styles.scanBtn} onClick={() => scanPoint(rp.point.point_code.trim())} disabled={loading}>
                      Scan
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {stage === 'checklist' && (
        <div className={styles.card}>
          <button className={styles.backBtn} style={{ marginLeft: 0, marginBottom: 12 }} onClick={goBack}>
            {history.length > 0 ? '‹ Previous Question' : '‹ Back to Patrol'}
          </button>
          <div className={styles.trailRow}>
            Following: {trail.join(' → ')}
          </div>
          {!rpq ? (
            <div>No questions here.</div>
          ) : question?.question_type === '9' ? (
            <div className={styles.loading}>Following clone jump…</div>
          ) : (
            <QuestionForm rpq={rpq} question={question} onAnswer={submitAnswer} />
          )}
          {currentVisit.answers.length > 0 && (
            <div className={styles.answersLog}>
              <h4>Answered so far ({currentVisit.answers.length}/{MAX_QA_SLOTS}):</h4>
              <ol>
                {currentVisit.answers.map((a, i) => <li key={i}>{a.description}: <strong>{a.answer}</strong></li>)}
              </ol>
            </div>
          )}
        </div>
      )}

      {stage === 'incident' && (
        <div className={styles.card}>
          <button className={styles.backBtn} style={{ marginLeft: 0, marginBottom: 12 }} onClick={goBack}>
            {history.length > 0 ? '‹ Previous Question' : '‹ Back to Patrol'}
          </button>
          <h3>Log an Incident</h3>
          <IncidentDrilldown
            masters={incMasters} sub1s={incSub1s} sub2s={incSub2s} sub3s={incSub3s}
            selMaster={selMaster} selSub1={selSub1} selSub2={selSub2} selSub3={selSub3}
            onMaster={pickMaster} onSub1={pickSub1} onSub2={pickSub2} onSub3={setSelSub3}
          />
          <button className={styles.primaryBtn} onClick={confirmIncident}>Confirm</button>
        </div>
      )}

      {stage === 'endRoute' && (
        <div className={styles.card}>
          <h3>End Route</h3>
          <div className={styles.endRouteStats}>
            <span className={styles.statCompleted}>Points Completed: {visitLog.length}</span>
            <span className={styles.statMissed}>Missed Points: {missedPoints.length}</span>
          </div>
          {missedPoints.length > 0 && (
            <>
              <p><strong>Missed:</strong></p>
              <ul className={styles.missedBulletList}>
                {missedPoints.map(rp => <li key={rp.point_id}>· {rp.point.description}</li>)}
              </ul>
              <p className={styles.requiredBadge}>⚠ REASON FOR MISSED POINTS (REQUIRED)</p>
              <IncidentDrilldown
                masters={missedIncMasters} sub1s={missedIncSub1s} sub2s={missedIncSub2s} sub3s={missedIncSub3s}
                selMaster={missedSelMaster} selSub1={missedSelSub1} selSub2={missedSelSub2} selSub3={missedSelSub3}
                onMaster={pickMissedMaster} onSub1={pickMissedSub1} onSub2={pickMissedSub2} onSub3={setMissedSelSub3}
              />
            </>
          )}
          {err && <div className={styles.error}>{err}</div>}
          <div className={styles.formActions}>
            <button className={styles.backBtn} style={{ marginLeft: 0 }} onClick={continuePatrol}>Continue Patrol</button>
            <button className={styles.primaryBtn} onClick={finishEndRoute}>Exit Route →</button>
          </div>
        </div>
      )}

      {stage === 'summary' && (
        <div className={styles.card}>
          <h3>Route Summary</h3>
          <div className={styles.summaryTableWrap}>
            <table className={styles.summaryTable}>
              <thead>
                <tr><th>Point</th><th>Status</th><th>Incident</th><th>Answers</th></tr>
              </thead>
              <tbody>
                {visitLog.map((v, i) => (
                  <tr key={i}>
                    <td>{v.scannedPointCode} — {v.scannedPointDesc}</td>
                    <td>{v.missed ? 'Missed' : 'Visited'}{v.note ? ` (${v.note})` : ''}</td>
                    <td>{v.inc || '—'}</td>
                    <td>{v.answers.length === 0 ? '—' : v.answers.map(a => `${a.description}: ${a.answer}`).join('; ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {submitResult && (
            <div className={styles.submitResult}>
              {submitResult.ok} transaction(s) saved{submitResult.failed > 0 && `, ${submitResult.failed} failed`}.
              {submitResult.errors.map((e, i) => <div key={i} className={styles.error}>{e}</div>)}
            </div>
          )}

          <div className={styles.formActions}>
            <button className={styles.primaryBtn} onClick={submitAsTestTransactions} disabled={submitting || !!submitResult}>
              {submitting ? 'Submitting…' : 'Submit as Test Transaction(s)'}
            </button>
            <button className={styles.backBtn} onClick={startNewSimulation}>Start New Simulation</button>
          </div>
        </div>
      )}
        </div>

        <div className={styles.navBar}>
          <span className={styles.navBackHit} onClick={handleAndroidBack} role="button" aria-label="Back" tabIndex={0}>
            <span className={styles.navTriangle} aria-hidden="true" />
          </span>
          <span className={styles.navCircle} aria-hidden="true" />
          <span className={styles.navSquare} aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// QuestionForm — type-specific answer UI for one question
// ─────────────────────────────────────────────────────────────────────────────
function QuestionForm({ rpq, question, onAnswer }) {
  const [text, setText] = useState('');
  const [checked, setChecked] = useState(() => new Set());
  const type = question?.question_type;
  const labels = jumpLabels(question);
  const jumps = [rpq.jump1, rpq.jump2, rpq.jump3, rpq.jump4, rpq.jump5];

  useEffect(() => { setText(''); setChecked(new Set()); }, [rpq.id]);

  return (
    <div className={styles.questionBox}>
      <div className={styles.questionText}>
        {question?.description ?? '—'}
        {rpq.answer_required === 'Y' && <span className={styles.requiredBadge}> *required</span>}
      </div>

      {type === '1' && (
        <div className={styles.btnRow}>
          <button className={styles.yesBtn} onClick={() => onAnswer('YES', rpq.jump1)}>YES</button>
          <button className={styles.noBtn} onClick={() => onAnswer('NO', rpq.jump2)}>NO</button>
        </div>
      )}

      {type === '2' && (
        <div className={styles.btnRow}>
          {labels.map((label, i) => label ? (
            <button key={i} className={styles.choiceBtn} onClick={() => onAnswer(label, jumps[i])}>{label}</button>
          ) : null)}
        </div>
      )}

      {type === '4' && (
        <NumericAnswer question={question} onSubmit={(value, band) => {
          const bandIdx = band === 'LOW' ? 0 : band === 'HIGH' ? 2 : 1;
          onAnswer(value, jumps[bandIdx]);
        }} />
      )}

      {type === '5' && (
        <>
          <div className={styles.checkboxCol}>
            {[question.option1, question.option2, question.option3, question.option4, question.option5]
              .filter(Boolean).map(opt => (
                <label key={opt}>
                  <input
                    type="checkbox"
                    checked={checked.has(opt)}
                    onChange={() => setChecked(prev => {
                      const n = new Set(prev);
                      n.has(opt) ? n.delete(opt) : n.add(opt);
                      return n;
                    })}
                  />
                  {opt}
                </label>
              ))}
          </div>
          <button className={styles.primaryBtn} onClick={() => onAnswer([...checked].join(', ') || '(none)', rpq.jump1)}>Next</button>
        </>
      )}

      {type === '6' && (
        <>
          <div className={styles.fileBox}>File: {question.file_name || '(no file configured)'}</div>
          <button className={styles.primaryBtn} onClick={() => onAnswer(question.file_name || 'shown', rpq.jump1)}>Acknowledge / Next</button>
        </>
      )}

      {type === '10' && (
        <button className={styles.primaryBtn} onClick={() => onAnswer('(signature captured)', rpq.jump1)}>✓ Sign / Next</button>
      )}

      {type === '11' && (
        <button className={styles.primaryBtn} onClick={() => onAnswer('(photo captured)', rpq.jump1)}>📷 Take Photo / Next</button>
      )}

      {(type === '3' || type === '7') && (
        <div className={styles.textRow}>
          <input
            className={styles.scanInput}
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={type === '7' ? 'Scan asset barcode…' : 'Enter response…'}
            onKeyDown={e => e.key === 'Enter' && onAnswer(text, rpq.jump1)}
            autoFocus
          />
          <button className={styles.primaryBtn} onClick={() => onAnswer(text, rpq.jump1)}>Next</button>
        </div>
      )}

      {type === '8' && (
        question.option1 && (question.option3 === 'LookupType' || question.option3 === 'TreeType') ? (
          <LookupAnswer question={question} onAnswer={value => onAnswer(value, rpq.jump1)} />
        ) : (
          <div className={styles.textRow}>
            <input
              className={styles.scanInput}
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="Enter list selection…"
              onKeyDown={e => e.key === 'Enter' && onAnswer(text, rpq.jump1)}
              autoFocus
            />
            <button className={styles.primaryBtn} onClick={() => onAnswer(text, rpq.jump1)}>Next</button>
          </div>
        )
      )}

      {!type && (
        <>
          <div className={styles.error}>This question has no type configured in Question Setup.</div>
          <button className={styles.primaryBtn} onClick={() => onAnswer('(no type configured)', rpq.jump1)}>Skip / Next</button>
        </>
      )}
    </div>
  );
}

function NumericAnswer({ question, onSubmit }) {
  const [value, setValue] = useState('');
  function submit() {
    const num = parseFloat(value);
    let band = 'NORMAL';
    if (question.low_alarm && num < parseFloat(question.low_alarm)) band = 'LOW';
    else if (question.high_alarm && num > parseFloat(question.high_alarm)) band = 'HIGH';
    onSubmit(value, band);
  }
  return (
    <div className={styles.textRow}>
      <input
        className={styles.scanInput}
        type="number"
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder={`Enter value (Low ${question.low_alarm ?? '?'} / High ${question.high_alarm ?? '?'})`}
        onKeyDown={e => e.key === 'Enter' && submit()}
        autoFocus
      />
      <button className={styles.primaryBtn} onClick={submit} disabled={value === ''}>Next</button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LookupAnswer — real PICKLIST rendering for Lookup and Rollup XML lists
// (see "Flex Rollup and Lookup Configuration Guide"). option1=List File
// Name, option2=List Node path, option3="LookupType"/"TreeType",
// option4=Lookup Name (ParentListID filter -- blank for rollups, since
// option2's path already names the specific rollup tree).
//
// LookupType is a flat <LU ParentListID=".." Value=".."/> list, filtered to
// option4 -- one tap answers the question. TreeType is an arbitrary-depth
// drill-down (real files range 2-4 levels: Level1..LevelN, tag names not
// hardcoded here since depth varies file to file) -- tapping a node with its
// own children drills in; tapping a leaf (no children) answers with the
// full path joined by " > ".
// ─────────────────────────────────────────────────────────────────────────────
function LookupAnswer({ question, onAnswer }) {
  const isTree = question.option3 === 'TreeType';
  const [loadErr, setLoadErr] = useState(null);
  const [options, setOptions] = useState(null); // null = loading
  const [path, setPath] = useState([]);
  const [stack, setStack] = useState([]); // previous `options` arrays, for Back

  useEffect(() => {
    let cancelled = false;
    setOptions(null);
    setLoadErr(null);
    setPath([]);
    setStack([]);
    getListFile(question.option1)
      .then(text => {
        if (cancelled) return;
        const doc = new DOMParser().parseFromString(text, 'application/xml');
        if (doc.querySelector('parsererror')) throw new Error('parse error');
        if (isTree) {
          // option2 is the full path to the specific rollup tree, e.g.
          // "/Rollups/SiteRollup" -- walk it from the document root.
          const segments = (question.option2 || '').split('/').filter(Boolean);
          let node = doc.documentElement;
          for (const seg of segments) {
            const child = [...node.children].find(c => c.tagName === seg);
            if (child) node = child;
          }
          setOptions([...node.children]);
        } else {
          const all = [...doc.getElementsByTagName('LU')];
          setOptions(all.filter(el => el.getAttribute('ParentListID') === question.option4));
        }
      })
      .catch(() => { if (!cancelled) setLoadErr(`Could not load "${question.option1}" from this site's ListFiles folder.`); });
    return () => { cancelled = true; };
  }, [question.option1, question.option2, question.option3, question.option4, isTree]);

  function pick(el) {
    const value = el.getAttribute('Value') ?? '';
    if (!isTree) { onAnswer(value); return; }
    const children = [...el.children];
    if (children.length === 0) {
      onAnswer([...path, value].join(' > '));
    } else {
      setStack(prev => [...prev, options]);
      setPath(prev => [...prev, value]);
      setOptions(children);
    }
  }

  function goBack() {
    setOptions(stack[stack.length - 1]);
    setStack(prev => prev.slice(0, -1));
    setPath(prev => prev.slice(0, -1));
  }

  if (loadErr) return <div className={styles.error}>{loadErr}</div>;
  if (options === null) return <div className={styles.loading}>Loading list…</div>;

  return (
    <div>
      {path.length > 0 && (
        <div className={styles.trailRow}>
          <button className={styles.backBtn} onClick={goBack} style={{ marginRight: 8 }}>‹ Back</button>
          {path.join(' > ')}
          {/* The real device lets you stop and submit at any level, not just
              a leaf -- selecting a mid-tree node enables Done immediately
              (RollupQuestion.vb's RollupTreeView_AfterSelect). */}
          <button className={styles.primaryBtn} style={{ marginLeft: 10 }} onClick={() => onAnswer(path.join(' > '))}>
            ✓ Use This
          </button>
        </div>
      )}
      {options.length === 0 ? (
        <div className={styles.error}>No options found{question.option4 ? ` for "${question.option4}"` : ''}.</div>
      ) : (
        <div className={styles.btnRow}>
          {options.map((el, i) => (
            <button key={i} className={styles.choiceBtn} onClick={() => pick(el)}>
              {el.getAttribute('Value')}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Incident drill-down (used both mid-checklist and for missed points)
// ─────────────────────────────────────────────────────────────────────────────
function IncidentDrilldown({ masters, sub1s, sub2s, sub3s, selMaster, selSub1, selSub2, onMaster, onSub1, onSub2, onSub3, selSub3 }) {
  return (
    <div>
      <div className={styles.formRow}>
        <label>Incident</label>
        <select value={selMaster?.id ?? ''} onChange={e => onMaster(masters.find(m => m.id === e.target.value) ?? null)}>
          <option value="">— select —</option>
          {masters.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </div>
      {selMaster && sub1s.length > 0 && (
        <div className={styles.formRow}>
          <label>Sub Category 1</label>
          <select value={selSub1?.id ?? ''} onChange={e => onSub1(sub1s.find(s => s.id === e.target.value) ?? null)}>
            <option value="">— none —</option>
            {sub1s.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      )}
      {selSub1 && sub2s.length > 0 && (
        <div className={styles.formRow}>
          <label>Sub Category 2</label>
          <select value={selSub2?.id ?? ''} onChange={e => onSub2(sub2s.find(s => s.id === e.target.value) ?? null)}>
            <option value="">— none —</option>
            {sub2s.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      )}
      {selSub2 && sub3s.length > 0 && (
        <div className={styles.formRow}>
          <label>Sub Category 3</label>
          <select value={selSub3?.id ?? ''} onChange={e => onSub3(sub3s.find(s => s.id === e.target.value) ?? null)}>
            <option value="">— none —</option>
            {sub3s.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      )}
    </div>
  );
}

