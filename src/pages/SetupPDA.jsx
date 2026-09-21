import { useEffect, useState } from 'react';
import { getPdaSites, generateAllPda, generatePda } from '../api/client';
import useCanEditSite from '../hooks/useCanEditSite';
import styles from './SetupPDA.module.css';

// ─────────────────────────────────────────────────────────────────────────────
// ResultPanel — shows files written / errors after a generation run
// ─────────────────────────────────────────────────────────────────────────────
function ResultPanel({ result }) {
  if (!result) return null;
  return (
    <div className={`${styles.result} ${result.success ? styles.resultOk : styles.resultErr}`}>
      <div className={styles.resultHeader}>
        <span className={result.success ? styles.okIcon : styles.errIcon}>
          {result.success ? '✓' : '✗'}
        </span>
        <span className={styles.resultTitle}>
          {result.success
            ? `Generated ${result.files_written.length} files`
            : `${result.errors.length} error${result.errors.length !== 1 ? 's' : ''}`}
        </span>
        <span className={styles.resultDir}>{result.output_dir}</span>
      </div>

      {result.files_written.length > 0 && (
        <div className={styles.fileList}>
          {result.files_written.map(f => (
            <span key={f} className={styles.fileChip}>{f}</span>
          ))}
        </div>
      )}

      {result.errors.length > 0 && (
        <div className={styles.errorList}>
          {result.errors.map((e, i) => (
            <div key={i} className={styles.errorItem}>⚠ {e}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SiteCard — one site group with its own Generate button and result
// ─────────────────────────────────────────────────────────────────────────────
function SiteCard({ site, onGenerated, editable }) {
  const [busy,   setBusy]   = useState(false);
  const [result, setResult] = useState(null);
  const [error,  setError]  = useState(null);

  async function generate() {
    setBusy(true);
    setResult(null);
    setError(null);
    try {
      const data = await generatePda(site.name);
      setResult(data);
      onGenerated?.(site.name, data);
    } catch (ex) {
      setError(ex.response?.data?.detail ?? ex.message ?? 'Generation failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`${styles.card} ${result ? (result.success ? styles.cardOk : styles.cardErr) : ''}`}>
      <div className={styles.cardTop}>
        <div className={styles.cardInfo}>
          <span className={styles.cardName}>{site.name}</span>
          <span className={styles.cardCodes}>
            Sites: {site.site_codes.join(', ')}
          </span>
          <span className={styles.cardDir}>{site.upload_dir}</span>
        </div>
        <button
          className={styles.genBtn}
          onClick={generate}
          disabled={busy || !editable}
        >
          {busy ? <span className={styles.spinner}>⟳</span> : '▶ Generate'}
        </button>
      </div>

      {error  && <div className={styles.cardError}>⚠ {error}</div>}
      <ResultPanel result={result} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────
export default function SetupPDA() {
  const { hasAnyEditAccess: editable } = useCanEditSite();
  const [sites,      setSites]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [loadErr,    setLoadErr]    = useState(null);
  const [allBusy,    setAllBusy]    = useState(false);
  const [allResults, setAllResults] = useState(null);
  const [allError,   setAllError]   = useState(null);

  useEffect(() => {
    getPdaSites()
      .then(data => setSites(data.sites ?? []))
      .catch(ex => setLoadErr(ex.response?.data?.detail ?? 'Failed to load site configuration'))
      .finally(() => setLoading(false));
  }, []);

  async function generateAll() {
    setAllBusy(true);
    setAllResults(null);
    setAllError(null);
    try {
      const data = await generateAllPda();
      setAllResults(data.results ?? []);
    } catch (ex) {
      setAllError(ex.response?.data?.detail ?? ex.message ?? 'Generation failed');
    } finally {
      setAllBusy(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.heading}>
            Update PDA Files
            {!editable && <span className={styles.viewOnlyBadge}>View only</span>}
          </h2>
          <p className={styles.sub}>
            Generates SITE.TXT, ROUTE.TXT, POINTS.TXT, QDATA.TXT, INC*.TXT, GUARD.TXT
            and writes them to the FTP upload folder for each configured site.
          </p>
        </div>
        <button
          className={styles.generateAllBtn}
          onClick={generateAll}
          disabled={allBusy || loading || sites.length === 0 || !editable}
        >
          {allBusy
            ? <><span className={styles.spinner}>⟳</span> Generating…</>
            : '▶ Generate All Sites'}
        </button>
      </div>

      {/* ── Global error / results ── */}
      {allError && <div className={styles.globalError}>⚠ {allError}</div>}

      {allResults && (
        <div className={styles.allResults}>
          <div className={styles.allResultsHeader}>
            All sites generated —{' '}
            {allResults.filter(r => r.success).length} / {allResults.length} succeeded
          </div>
          {allResults.map(r => <ResultPanel key={r.name} result={r} />)}
        </div>
      )}

      {/* ── Site cards ── */}
      <div className={styles.cards}>
        {loading && <div className={styles.loading}>Loading site configuration…</div>}

        {loadErr && (
          <div className={styles.loadErr}>
            <strong>Could not load pda_sites.json</strong>
            <p>{loadErr}</p>
            <p className={styles.hint}>
              Check that <code>pda_sites.json</code> exists in the API project root and
              the API server is running.
            </p>
          </div>
        )}

        {!loading && !loadErr && sites.length === 0 && (
          <div className={styles.empty}>
            No site groups configured. Edit <code>pda_sites.json</code> in the API project root.
          </div>
        )}

        {sites.map(site => (
          <SiteCard
            key={site.name}
            site={site}
            onGenerated={() => {}}
            editable={editable}
          />
        ))}
      </div>

      {/* ── File reference table ── */}
      <details className={styles.reference}>
        <summary className={styles.referenceSummary}>File reference — what goes in each file</summary>
        <table className={styles.refTable}>
          <thead>
            <tr><th>File</th><th>Filter</th><th>Content</th></tr>
          </thead>
          <tbody>
            {[
              ['SITE.TXT',      'Site-filtered', 'customer_code[10] + site_code[10] + site_name[20]'],
              ['ROUTE.TXT',     'Site-filtered', 'site_code[10] + route_code[10] + route_name[20]  (non-template only)'],
              ['POINTS.TXT',    'Site-filtered', 'point_code|description|route_code|route_name|[notes…]|'],
              ['QDATA.TXT',     'Global',        'question_id|route|point|seq|type|desc|options×7|jumps×5|mask|hi|lo|filename|masktype|req|'],
              ['INC.TXT',       'Global',        'name[30] + code[10] + N  or  Y+sop_jump_point'],
              ['INC1.TXT',      'Global',        'own_code[10] + name[30] + master_code[10] + N/Y'],
              ['INC2.TXT',      'Global',        'own_code[10] + name[30] + sub1_code[10] + N/Y'],
              ['INC3.TXT',      'Global',        'own_code[10] + name[30] + sub2_code[10] + N/Y'],
              ['GUARD.TXT',     'Global',        'card_number[10] + first_name[20] + last_name[20]'],
              ['LISTFILES.TXT', 'Global',        'One filename per line (from type-8 picklist questions)'],
              ['SHOWFILES.TXT', 'Global',        'One filename per line (from question File_Name field)'],
              ['QTAG.TXT',      'Global',        'Index into QDATA.TXT (legacy Palm — route+point+seqno+offset)'],
            ].map(([file, filter, content]) => (
              <tr key={file}>
                <td><code>{file}</code></td>
                <td className={filter === 'Global' ? styles.global : styles.filtered}>{filter}</td>
                <td>{content}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
