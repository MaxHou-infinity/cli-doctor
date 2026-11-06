/**
 * The CLI Doctor main panel.
 *
 * Renders the read-only diagnosis produced by the Host half (CONTRACT.md §2,
 * §v2.1) as the two layers the contract asks for — tool layer and dependency
 * layer — per ecosystem, in the fixed block order, with the dashboard's five
 * summary counters (tool layer only) on top plus the dependency-risk cells added
 * by CONTRACT.md §v2.3.
 *
 * v0.3 keeps every rendering guarantee from v1 §3.4 (five counters, five blocks,
 * both layers, tolerant rendering of missing/null fields, read-only footer, the
 * single `data-dsh-cli-doctor-scroll` container and the fill-the-slot height
 * contract) and adds the workflow that makes the panel a state hub rather than a
 * one-shot report page:
 *
 * - state lives in the module store (`./store.js`), so it survives unmount;
 * - mount bootstraps health → snapshot → (stale-gate) one automatic full check;
 * - a running check can be cancelled, and a failure keeps the previous report;
 * - freshness and staleness are visible in the header;
 * - semantic colours come from `--dsw-alias-*` tokens with the v1 hex as a
 *   fallback, and `aria-live` only announces phase transitions (never the 1 s
 *   wait ticker).
 *
 * Constraints honoured here: inline styles only (no CSS file, no DOM injection,
 * no global stylesheet), `type="button"` on every button, and no timer of our
 * own — the store owns the single 1 s ticker and clears it when a run ends.
 *
 * @module dsh-cli-doctor/client/panel
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { bootstrap, cancelCurrentCheck, retryBootstrap, runCheck, setSummaryFilter, useStore } from './store.js';
import { CLIPBOARD_FAILED_TEXT, CLIPBOARD_UNAVAILABLE_TEXT, COPY_FEEDBACK_MS, copyText } from './clipboard.js';
import { buildJsonReport, buildMarkdownReport } from './report.js';
import {
  DEP_RISK_FIELDS,
  KIND_DEP,
  KIND_TOOL,
  SUMMARY_FIELDS,
  candidateBelowCurrent,
  formatDuration,
  formatScope,
  formatTimestamp,
  impactView,
  isStale,
  modeCaveat,
  modeLabel,
  recommendationFor,
  relativeTime,
  skippedChecks,
  statusFor,
  summarize,
  timestampAgeMs,
  toolMatchesSummaryFilter,
} from './view.js';

/** Package version injected by scripts/build-client.mjs; null outside a build. */
const BUILD_VERSION = typeof __CLI_DOCTOR_VERSION__ === 'string' && __CLI_DOCTOR_VERSION__ ? __CLI_DOCTOR_VERSION__ : null;

/**
 * Semantic accents. Each value is a platform theme token with the v1 hex kept as
 * the fallback, so a shell that has not defined the token (or a future rename)
 * still renders the old colour instead of breaking (CONTRACT.md §v2.3, design
 * appendix E). `TONES` is never a bare hex.
 */
const TONES = {
  anomaly: 'var(--dsw-alias-state-warn-primary, #b45309)',
  update: 'var(--dsw-alias-brand-primary, #2563eb)',
  steady: 'inherit',
  unknown: 'var(--dsw-alias-state-warn-primary, #a16207)',
  recommended: 'var(--dsw-alias-state-success-primary, #047857)',
  review: 'var(--dsw-alias-state-warn-primary, #b45309)',
  blocked: 'var(--dsw-alias-state-error-primary, #b91c1c)',
};

const STATE_LABELS = {
  idle: '空闲',
  running: '诊断中',
  done: '诊断完成',
  error: '诊断失败',
};

/** The wait line prefix per run reason; the automatic one must admit it is automatic. */
const RUN_REASON_TEXT = {
  auto: '数据已过期或尚未诊断，正在自动做一次只读诊断（可取消）。',
  attached: '已连接本机正在进行的诊断，等待结果。',
  manual: '正在检查，联网查询可能需要几分钟…',
  retry: '正在重新检查，联网查询可能需要几分钟…',
};

const MUTED = 'var(--dsw-alias-label-secondary, rgba(127,127,127,0.9))';
const HAIRLINE = '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.28))';
const CARD_BG = 'var(--dsw-alias-bg-layer-1, transparent)';
const WARN_COLOR = 'var(--dsw-alias-state-warn-primary, #b45309)';
const DANGER_COLOR = 'var(--dsw-alias-state-error-primary, #b91c1c)';

const S = {
  // The main slot's occupant must fill the center column itself: the shell's
  // column is `display:flex; overflow:hidden`, so a panel that only grows with
  // its content is clipped and can never show a scrollbar. `flex: 1 1 auto` is
  // kept alongside `height: 100%` so the panel fills the remaining space no
  // matter how the parent resolves its own height.
  root: {
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    flex: '1 1 auto',
    height: '100%',
    minHeight: 0,
    minWidth: 0,
    gap: '12px',
    padding: '16px',
    width: '100%',
    color: 'var(--dsw-alias-label-primary, inherit)',
    background: 'var(--dsw-alias-bg-base, transparent)',
    fontSize: '13px',
    lineHeight: 1.55,
    fontFamily: 'inherit',
  },
  header: {
    flexShrink: 0,
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '10px',
    paddingBottom: '10px',
    borderBottom: HAIRLINE,
    position: 'relative',
  },
  headerMain: { display: 'flex', alignItems: 'baseline', gap: '8px', minWidth: '160px', flexWrap: 'wrap' },
  // The only scroll container: everything below the fixed header lives here so
  // a long report can always be scrolled to its last card. `minHeight: 0` is
  // what lets a flex child actually shrink and scroll instead of overflowing.
  body: {
    flex: '1 1 auto',
    minHeight: 0,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    paddingRight: '8px',
    overflowY: 'auto',
    overflowX: 'hidden',
    overscrollBehavior: 'contain',
  },
  title: { margin: 0, fontSize: '16px', fontWeight: 600 },
  version: { color: MUTED, fontSize: '12px' },
  freshness: { color: MUTED, fontSize: '12px' },
  headerActions: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' },
  state: { color: MUTED, fontSize: '12px' },
  button: {
    padding: '6px 14px',
    borderRadius: '6px',
    border: HAIRLINE,
    background: 'transparent',
    color: 'inherit',
    fontSize: '13px',
    fontFamily: 'inherit',
    cursor: 'pointer',
  },
  buttonBusy: { cursor: 'progress', opacity: 0.65 },
  dangerButton: {
    padding: '6px 14px',
    borderRadius: '6px',
    border: `1px solid ${DANGER_COLOR}`,
    background: 'transparent',
    color: DANGER_COLOR,
    fontSize: '13px',
    fontFamily: 'inherit',
    cursor: 'pointer',
  },
  progress: { color: MUTED, fontSize: '12px', margin: 0 },
  alert: {
    border: `1px solid ${DANGER_COLOR}`,
    borderRadius: '6px',
    padding: '10px 12px',
    color: DANGER_COLOR,
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '10px',
  },
  warnBanner: {
    border: `1px solid ${WARN_COLOR}`,
    borderRadius: '6px',
    padding: '8px 12px',
    color: WARN_COLOR,
    fontSize: '12px',
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '10px',
  },
  notice: {
    border: HAIRLINE,
    borderRadius: '6px',
    padding: '8px 12px',
    color: MUTED,
    fontSize: '12px',
    margin: 0,
  },
  hint: { color: MUTED, margin: 0 },
  summary: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
  },
  summaryCell: {
    flex: '1 1 110px',
    border: HAIRLINE,
    borderRadius: '6px',
    padding: '8px 10px',
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  summaryValue: { fontSize: '18px', fontWeight: 600 },
  summaryLabel: { color: MUTED, fontSize: '12px' },
  riskBar: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '8px',
  },
  riskCell: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '6px',
    border: `1px solid ${DANGER_COLOR}`,
    borderRadius: '6px',
    padding: '4px 10px',
    color: DANGER_COLOR,
    fontSize: '12px',
  },
  riskValue: { fontSize: '14px', fontWeight: 600 },
  riskNote: { color: MUTED, fontSize: '11px' },
  meta: { color: MUTED, fontSize: '12px', display: 'flex', flexWrap: 'wrap', gap: '12px', margin: 0 },
  modeNote: {
    color: WARN_COLOR,
    fontSize: '12px',
    margin: 0,
  },
  expired: {
    color: WARN_COLOR,
    fontSize: '12px',
    margin: 0,
    border: `1px solid ${WARN_COLOR}`,
    borderRadius: '6px',
    padding: '6px 10px',
  },
  skipped: { color: MUTED, fontSize: '12px', margin: 0 },
  section: { border: HAIRLINE, borderRadius: '8px', padding: '12px', background: CARD_BG },
  sectionHead: { display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '10px', marginBottom: '6px' },
  sectionTitle: { margin: 0, fontSize: '14px', fontWeight: 600 },
  sectionCount: { color: MUTED, fontSize: '12px' },
  layerLabel: { fontSize: '12px', color: MUTED, margin: '6px 0 4px' },
  cards: { display: 'flex', flexDirection: 'column', gap: '8px' },
  card: { border: HAIRLINE, borderRadius: '6px', padding: '10px', display: 'flex', flexDirection: 'column', gap: '6px', background: CARD_BG },
  cardHead: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '8px' },
  identity: { display: 'flex', alignItems: 'baseline', gap: '8px' },
  kind: { color: MUTED, fontSize: '11px', border: HAIRLINE, borderRadius: '4px', padding: '0 5px' },
  name: { margin: 0, fontSize: '13px', fontWeight: 600 },
  tag: { border: HAIRLINE, borderRadius: '999px', padding: '1px 9px', fontSize: '12px', whiteSpace: 'nowrap' },
  versions: { display: 'flex', flexWrap: 'wrap', gap: '16px' },
  field: { display: 'flex', flexDirection: 'column', gap: '1px' },
  fieldLabel: { color: MUTED, fontSize: '11px' },
  fieldValue: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '12px' },
  recommendation: { display: 'flex', flexDirection: 'column', gap: '2px' },
  recommendationLabel: { fontSize: '12px', fontWeight: 600 },
  advice: { margin: 0, fontSize: '12px', color: MUTED },
  impactScope: { margin: 0, fontSize: '12px', color: MUTED },
  impactNone: { margin: 0, fontSize: '12px', color: MUTED },
  details: { fontSize: '12px' },
  detailsSummary: { cursor: 'pointer', color: MUTED },
  list: { margin: '6px 0 0', paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '2px' },
  note: { margin: 0, fontSize: '12px', color: MUTED },
  command: { display: 'flex', flexDirection: 'column', gap: '1px' },
  code: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '12px',
    border: HAIRLINE,
    borderRadius: '4px',
    padding: '3px 6px',
    wordBreak: 'break-all',
    background: 'transparent',
  },
  deps: { marginTop: '6px' },
  footer: { color: MUTED, fontSize: '12px', margin: 0, borderTop: HAIRLINE, paddingTop: '8px' },
  empty: { color: MUTED, margin: 0 },
  // Visually hidden live region: it only exists so phase changes (and one-shot
  // notices) are announced; the 1 s wait ticker never writes here.
  summaryButton: {
    flex: '1 1 110px',
    border: HAIRLINE,
    borderRadius: '6px',
    padding: '8px 10px',
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    textAlign: 'left',
    font: 'inherit',
    color: 'inherit',
    background: 'transparent',
    cursor: 'pointer',
  },
  summaryCellActive: {
    border: '1px solid var(--dsw-alias-brand-primary, #2563eb)',
    color: 'var(--dsw-alias-brand-primary, #2563eb)',
    background: 'var(--dsw-alias-bg-layer-2, transparent)',
  },
  filterNote: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '10px',
    margin: 0,
    color: MUTED,
    fontSize: '12px',
    border: HAIRLINE,
    borderRadius: '6px',
    padding: '8px 12px',
  },
  emptyState: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' },
  copyFeedback: { margin: 0, fontSize: '12px', color: 'var(--dsw-alias-state-success-primary, #047857)' },
  copyFeedbackError: { margin: 0, fontSize: '12px', color: DANGER_COLOR },
  copyPanel: {
    border: HAIRLINE,
    borderRadius: '6px',
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  copyHint: { margin: 0, fontSize: '12px', color: MUTED },
  copyArea: {
    width: '100%',
    boxSizing: 'border-box',
    minHeight: '160px',
    resize: 'vertical',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '12px',
    lineHeight: 1.5,
    border: HAIRLINE,
    borderRadius: '6px',
    padding: '8px',
    background: 'transparent',
    color: 'inherit',
  },
  copyActions: { display: 'flex', flexWrap: 'wrap', gap: '8px' },
  copyPrimary: {
    padding: '6px 14px',
    borderRadius: '6px',
    border: '1px solid var(--dsw-alias-brand-primary, #2563eb)',
    background: 'transparent',
    color: 'var(--dsw-alias-brand-primary, #2563eb)',
    fontSize: '13px',
    fontFamily: 'inherit',
    cursor: 'pointer',
  },
  srOnly: {
    position: 'absolute',
    width: '1px',
    height: '1px',
    padding: 0,
    margin: '-1px',
    overflow: 'hidden',
    clip: 'rect(0 0 0 0)',
    whiteSpace: 'nowrap',
    border: 0,
  },
};

/** Version field text: the value as-is, or a placeholder. */
function displayVersion(value) {
  if (typeof value === 'string' && value) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '未核验';
}

/** Text of an arbitrary note-ish field, or null. */
function noteText(value) {
  if (typeof value === 'string' && value) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

/** `[label, tone]` status pill. */
function Tag({ label, tone }) {
  return <span style={{ ...S.tag, color: TONES[tone] || 'inherit' }}>{label}</span>;
}

/** Label + monospace value pair. */
function Field({ label, value }) {
  return (
    <span style={S.field}>
      <span style={S.fieldLabel}>{label}</span>
      <span style={S.fieldValue}>{value}</span>
    </span>
  );
}

/** Dependency-impact block for one entry, mirroring the dashboard's disclosure. */
function ImpactBlock({ impact }) {
  if (!impact.checked) return <p style={S.impactScope}>依赖检查：未完成或该生态暂不支持。</p>;
  const { counts } = impact;
  const hasConflict = impact.entries.some((entry) => entry.tone === 'conflict');
  const summary = `直接依赖 ${counts.dependents} 个 · 间接依赖 ${counts.indirect} 个${counts.uncertain ? ` · 待核验 ${counts.uncertain} 项` : ''}`;
  return (
    <div>
      <p style={S.impactScope}>{`已检查：${impact.scope || '范围未标注'}。未扫描其他项目目录或虚拟环境。`}</p>
      {impact.hasEntries ? (
        <details style={S.details} open={hasConflict}>
          <summary style={S.detailsSummary}>{summary}</summary>
          <ul style={S.list}>
            {impact.entries.map((entry, index) => (
              <li
                key={`${index}-${entry.text}`}
                style={entry.tone === 'conflict' ? { color: TONES.blocked } : entry.tone === 'uncertain' ? { color: TONES.review } : undefined}
              >
                {entry.text}
              </li>
            ))}
          </ul>
        </details>
      ) : (
        <p style={S.impactNone}>未发现已装项目声明依赖此工具。</p>
      )}
    </div>
  );
}

/** One tool/dependency card. */
function ToolCard({ item, kind }) {
  const tool = item && typeof item === 'object' ? item : {};
  const [status, tone] = statusFor(tool, kind);
  const [recommendation, recommendationTone, explanation] = recommendationFor(tool, kind);
  const impact = impactView(tool);
  const anomaly = candidateBelowCurrent(tool);
  const name = noteText(tool.name) || '未知工具';
  const latest = displayVersion(tool.latest);
  const command = noteText(tool.upgrade_cmd);
  const note = noteText(tool.note);
  const versionLineNote = noteText(tool.version_line_anomaly);
  const showCommand = Boolean(command) && tool.outdated === true && !anomaly && recommendationTone !== 'blocked';
  return (
    <article style={S.card}>
      <div style={S.cardHead}>
        <div style={S.identity}>
          <span style={S.kind}>{kind}</span>
          <h4 style={S.name}>{name}</h4>
        </div>
        <Tag label={status} tone={tone} />
      </div>
      <div style={S.versions}>
        <Field label="当前版本" value={displayVersion(tool.current)} />
        <Field label="目标版本" value={latest} />
      </div>
      <div style={{ ...S.recommendation, color: TONES[recommendationTone] || 'inherit' }}>
        <span style={S.recommendationLabel}>{`升级建议 · ${recommendation}`}</span>
        <p style={S.advice}>{explanation}</p>
      </div>
      <ImpactBlock impact={impact} />
      {anomaly ? <p style={S.note}>{`仓库 latest 候选：${latest}`}</p> : null}
      {versionLineNote ? <p style={S.note}>{`版本线提示：${versionLineNote}`}</p> : null}
      {note ? <p style={S.note}>{note}</p> : null}
      {showCommand ? (
        <div style={S.command}>
          <span style={S.fieldLabel}>手动命令</span>
          <code style={S.code}>{command}</code>
        </div>
      ) : null}
    </article>
  );
}

/**
 * The five dashboard counters (tool layer) plus the dependency-risk cells.
 *
 * Every counter is a `<button aria-pressed>` that toggles the summary-card filter
 * (CONTRACT.md §v2.8); the risk cells stay read-only because dependencies are
 * hidden while a tool filter is active. Risk cells render only when non-zero.
 */
function SummaryBar({ counts, filter, onSelect }) {
  return (
    <>
      <div style={S.summary} role="group" aria-label="汇总计数，点击卡片可筛选工具列表">
        {SUMMARY_FIELDS.map(([field, label]) => {
          const active = field === 'toolCount' ? filter === null : filter === field;
          return (
            <button
              key={field}
              type="button"
              aria-pressed={active ? 'true' : 'false'}
              style={active ? { ...S.summaryButton, ...S.summaryCellActive } : S.summaryButton}
              onClick={() => onSelect(field)}
            >
              <strong style={S.summaryValue}>{counts[field]}</strong>
              <span style={S.summaryLabel}>{label}</span>
            </button>
          );
        })}
      </div>
      {DEP_RISK_FIELDS.some(([field]) => counts[field] > 0) ? (
        <div style={S.riskBar}>
          {DEP_RISK_FIELDS.filter(([field]) => counts[field] > 0).map(([field, label]) => (
            <div key={field} style={S.riskCell}>
              <strong style={S.riskValue}>{counts[field]}</strong>
              <span>{label}</span>
            </div>
          ))}
          <span style={S.riskNote}>依赖层风险（不计入上方工具计数）</span>
        </div>
      ) : null}
    </>
  );
}

/**
 * One ecosystem block: tool layer on top, dependency layer in a disclosure.
 *
 * While the summary-card filter is active only matching tool cards are rendered,
 * the dependency layer is hidden (CONTRACT.md §v2.8) and the head shows
 * 「匹配 N / 共 M」 against the block's full tool count.
 */
function EcosystemBlock({ block, filterActive }) {
  return (
    <section style={S.section}>
      <div style={S.sectionHead}>
        <h3 style={S.sectionTitle}>{block.title}</h3>
        {filterActive ? (
          <span style={S.sectionCount}>{`匹配 ${block.tools.length} / 共 ${block.totalToolCount} 个工具`}</span>
        ) : (
          <span style={S.sectionCount}>
            {`${block.tools.length} 个工具${block.deps.length ? ` / ${block.deps.length} 个依赖` : ''}`}
          </span>
        )}
        <span style={{ ...S.sectionCount, color: 'inherit' }}>{`有可用更新 ${block.updateCount}`}</span>
      </div>
      <p style={S.layerLabel}>工具类</p>
      {block.tools.length ? (
        <div style={S.cards}>
          {block.tools.map((item, index) => (
            <ToolCard key={`tool-${index}`} item={item} kind={KIND_TOOL} />
          ))}
        </div>
      ) : (
        <p style={S.empty}>本生态未发现工具。</p>
      )}
      {!filterActive && block.deps.length ? (
        <details style={S.deps}>
          <summary style={S.detailsSummary}>{`依赖包类 · 查看 ${block.deps.length} 个依赖`}</summary>
          <div style={{ ...S.cards, marginTop: '8px' }}>
            {block.deps.map((item, index) => (
              <ToolCard key={`dep-${index}`} item={item} kind={KIND_DEP} />
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}

/**
 * The check-mode caveat, rendered with a warning tone so a `fast` run is never
 * mistaken for a complete update verdict (CONTRACT.md §v2.2).
 */
function ModeNote({ mode }) {
  const caveat = modeCaveat(mode);
  if (!caveat) return null;
  return <p style={S.modeNote}>{caveat}</p>;
}

/**
 * The main-slot page. Takes no props: state and the mount bootstrap come from
 * the module store, so switching panels away and back preserves the report.
 *
 * @returns the diagnosis panel.
 */
export function CliDoctorPanel() {
  const state = useStore();
  const {
    phase, report, checkedAt, mode, error, waitedMs, version,
    bootstrapping, bootstrapped, bootError, autoCheck, autoStarted, stale, snapshotAgeMs, ttlMs,
    notice, cancelling, runReason, summaryFilter,
  } = state;

  const [copyFeedback, setCopyFeedback] = useState(null);
  const [copyFallback, setCopyFallback] = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // The "已复制" confirmation lives for COPY_FEEDBACK_MS; failure text stays
  // until the next copy attempt or the fallback panel is closed.
  useEffect(() => {
    if (!copyFeedback || copyFeedback.kind !== 'ok') return undefined;
    const timer = setTimeout(() => setCopyFeedback(null), COPY_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [copyFeedback]);

  const counts = useMemo(() => summarize(report), [report]);
  const skipped = useMemo(() => skippedChecks(report), [report]);
  // The summary cards keep global numbers; only the rendered tool list narrows.
  const blocks = useMemo(() => {
    if (!summaryFilter) return counts.blocks;
    return counts.blocks
      .map((block) => ({
        ...block,
        tools: block.tools.filter((tool) => toolMatchesSummaryFilter(tool, summaryFilter)),
        totalToolCount: block.tools.length,
      }))
      .filter((block) => block.tools.length > 0);
  }, [counts.blocks, summaryFilter]);
  const filterLabel = useMemo(() => {
    const found = SUMMARY_FIELDS.find(([field]) => field === summaryFilter);
    return found ? found[1] : null;
  }, [summaryFilter]);
  const running = phase === 'running';
  const stateLabel = STATE_LABELS[phase] || STATE_LABELS.idle;
  const effectiveCheckedAt = checkedAt || (report && typeof report.generated_at === 'string' ? report.generated_at : null);
  const ageMs = snapshotAgeMs !== null ? snapshotAgeMs : timestampAgeMs(effectiveCheckedAt);
  const expired = Boolean(report) && (stale === true || isStale(ageMs, ttlMs));
  const freshness = report
    ? `上次诊断 ${relativeTime(effectiveCheckedAt)}${expired ? ' · 数据已过期' : ''}`
    : bootstrapping
      ? '正在读取上次诊断…'
      : '尚未诊断';
  const waitPrefix = RUN_REASON_TEXT[runReason] || RUN_REASON_TEXT.manual;
  const announcement = notice ? notice.text : `当前状态：${stateLabel}`;
  const showAutoHint = !report && !running && bootstrapped && !bootError && phase === 'idle';
  const autoHintText = autoCheck
    ? (autoStarted
      ? '本次打开已自动检查过一次，结果缓存在本机；点击「一键诊断当前状态」可再检查一次。'
      : '首次打开会自动做一次只读诊断，结果缓存在本机；随时可以取消。')
    : '首次打开不会自动检查。点击「一键诊断当前状态」运行一次只读诊断；结果缓存在本机。';

  const copyMeta = {
    pluginVersion: version || BUILD_VERSION || null,
    checkedAt,
    mode,
    elapsedMs: report && Number.isFinite(report.elapsed_ms) ? report.elapsed_ms : null,
    stale: expired,
    now: Date.now(),
  };
  const onCopy = async (kind) => {
    if (!report) return;
    // A copy must never mutate the report or touch the network (v2.8).
    const text = kind === 'json' ? buildJsonReport(report) : buildMarkdownReport(report, copyMeta);
    const result = await copyText(text);
    if (!mountedRef.current) return;
    if (result.ok) {
      setCopyFallback(null);
      setCopyFeedback({ id: Date.now(), kind: 'ok', message: '已复制' });
      return;
    }
    const reason = result.reason === 'unavailable'
      ? CLIPBOARD_UNAVAILABLE_TEXT
      : `${CLIPBOARD_FAILED_TEXT}${result.message ? `（${result.message}）` : ''}`;
    setCopyFeedback({ id: Date.now(), kind: 'error', message: reason });
    setCopyFallback({ id: Date.now(), kind, text });
  };
  const onPrimary = () => {
    void runCheck({ reason: 'manual', force: 1 });
  };
  const onCancel = () => {
    void cancelCurrentCheck();
  };
  const onRetryBootstrap = () => {
    void retryBootstrap();
  };

  return (
    <div style={S.root} data-dsh-cli-doctor="">
      <header style={S.header}>
        <div style={S.headerMain}>
          <h2 style={S.title}>CLI Doctor</h2>
          <span style={S.version}>{`插件版本 ${version || BUILD_VERSION || '未知'}`}</span>
        </div>
        <div style={S.headerActions}>
          <span style={S.freshness}>{freshness}</span>
          <span style={S.state}>{`当前状态：${stateLabel}`}</span>
          {report ? (
            <>
              <button
                type="button"
                style={S.copyPrimary}
                onClick={() => void onCopy('markdown')}
                aria-label="复制 Markdown 诊断报告（可直接粘贴给 AI）"
              >
                复制报告
              </button>
              <button
                type="button"
                style={S.button}
                onClick={() => void onCopy('json')}
                aria-label="复制原始 JSON 诊断报告"
              >
                复制原始 JSON
              </button>
              {copyFeedback ? (
                <span
                  data-dsh-cli-doctor-copy-feedback=""
                  style={copyFeedback.kind === 'ok' ? S.copyFeedback : S.copyFeedbackError}
                  role="status"
                  aria-live="polite"
                >
                  {copyFeedback.message}
                </span>
              ) : null}
            </>
          ) : null}
          {running ? (
            <button
              type="button"
              style={cancelling ? { ...S.dangerButton, ...S.buttonBusy } : S.dangerButton}
              onClick={onCancel}
              disabled={cancelling}
            >
              {cancelling ? '取消中…' : '取消'}
            </button>
          ) : null}
          <button
            type="button"
            style={running ? { ...S.button, ...S.buttonBusy } : S.button}
            onClick={onPrimary}
            disabled={running}
          >
            一键诊断当前状态
          </button>
        </div>
        {/* Phase-only live region: the 1 s wait ticker never writes here. */}
        <span role="status" aria-live="polite" aria-atomic="true" style={S.srOnly}>{announcement}</span>
      </header>

      <div
        style={S.body}
        data-dsh-cli-doctor-scroll=""
        aria-busy={running ? 'true' : 'false'}
      >
        {bootError ? (
          <div style={S.warnBanner} role="status">
            <span>{bootError.message}</span>
            <button type="button" style={S.button} onClick={onRetryBootstrap}>
              重试连接
            </button>
          </div>
        ) : null}

        {running ? (
          <p style={S.progress} aria-live="off">
            {`${waitPrefix} 已等待 ${formatDuration(waitedMs)}${cancelling ? ' · 正在取消…' : ''}`}
          </p>
        ) : null}

        {notice ? (
          <p style={notice.kind === 'error' ? S.warnBanner : S.notice} role="status">
            {notice.kind === 'cancelled' ? '已取消。上次结果（如有）仍显示在下方。' : notice.text}
          </p>
        ) : null}

        {copyFallback ? (
          <div style={S.copyPanel} data-dsh-cli-doctor-copy="">
            <p style={S.copyHint}>
              {`${copyFeedback ? `${copyFeedback.message} ` : ''}下方是${copyFallback.kind === 'json' ? '原始 JSON' : 'Markdown 报告'}全文，可全选手动复制（只读，不会修改报告）。`}
            </p>
            <textarea
              style={S.copyArea}
              readOnly
              value={copyFallback.text}
              aria-label="手动复制诊断报告"
              rows={10}
              autoFocus
              onFocus={(event) => {
                try {
                  event.currentTarget.select();
                } catch {
                  /* jsdom and some shells do not implement select(); manual copy still works. */
                }
              }}
            />
            <div style={S.copyActions}>
              <button type="button" style={S.button} onClick={() => setCopyFallback(null)}>
                关闭
              </button>
            </div>
          </div>
        ) : null}

        {phase === 'error' && error ? (
          <div style={S.alert} role="alert">
            <span>{`检查未完成：${error.message}`}</span>
            <button type="button" style={S.button} onClick={onPrimary}>
              重试
            </button>
          </div>
        ) : null}

        {!report && bootstrapping ? <p style={S.hint}>正在读取上次诊断结果…</p> : null}
        {!report && !running && !bootstrapping && !bootstrapped ? <p style={S.hint}>正在准备诊断面板…</p> : null}

        {showAutoHint ? <p style={S.hint}>{autoHintText}</p> : null}

        {report ? (
          <>
            <SummaryBar counts={counts} filter={summaryFilter} onSelect={setSummaryFilter} />
            <ModeNote mode={mode} />
            {expired ? (
              <p style={S.expired} role="status">
                {`数据已过期（上次诊断 ${relativeTime(effectiveCheckedAt)}），建议重新诊断。`}
              </p>
            ) : null}
            <p style={S.meta}>
              <span>{`生成时间：${formatTimestamp(report.generated_at)}`}</span>
              <span>{`范围：${formatScope(report)}`}</span>
              <span>{`耗时：${formatDuration(report.elapsed_ms)}`}</span>
              {modeLabel(mode) ? <span>{`检查档位：${modeLabel(mode)}`}</span> : null}
              {checkedAt ? <span>{`检查时间：${formatTimestamp(checkedAt)}（${relativeTime(checkedAt)}）`}</span> : null}
            </p>
            {skipped.length ? <p style={S.skipped}>{`未检查：${skipped.join('；')}`}</p> : null}
            {summaryFilter ? (
              <div style={S.filterNote} role="status">
                <span>
                  {`正在按「${filterLabel || summaryFilter}」筛选工具：只显示匹配的工具卡，依赖层已隐藏（依赖计数仍见上方汇总）。`}
                </span>
                <button type="button" style={S.button} onClick={() => setSummaryFilter(summaryFilter)}>
                  清除筛选
                </button>
              </div>
            ) : null}
            {blocks.length ? (
              blocks.map((block) => (
                <EcosystemBlock key={block.key} block={block} filterActive={Boolean(summaryFilter)} />
              ))
            ) : (
              <div style={S.emptyState}>
                <p style={S.empty}>
                  {summaryFilter
                    ? `没有符合「${filterLabel || summaryFilter}」筛选的工具。`
                    : '没有发现可展示的 CLI 工具。请查看终端环境与 PATH。'}
                </p>
                {summaryFilter ? (
                  <button type="button" style={S.button} onClick={() => setSummaryFilter(summaryFilter)}>
                    清除筛选
                  </button>
                ) : null}
              </div>
            )}
            <p style={S.footer}>只读检查：本插件只读取本机工具与依赖的版本信息，未执行任何升级；结果缓存在本机，过期后重新诊断。</p>
          </>
        ) : null}
      </div>
    </div>
  );
}
