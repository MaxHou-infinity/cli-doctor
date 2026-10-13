/**
 * The CLI Doctor main panel.
 *
 * Renders the read-only diagnosis produced by the Host half (CONTRACT.md §2) as
 * the two layers the contract asks for — tool layer and dependency layer — per
 * ecosystem, in the fixed block order, with the dashboard's five summary
 * counters on top (CONTRACT.md §3.4).
 *
 * Constraints honored here: inline styles only (no CSS file, no DOM injection,
 * no global stylesheet), tolerant rendering of any missing/null report field,
 * `type="button"` + `aria-busy` + `role="alert"` accessibility hooks, and no
 * timer or state update left behind after unmount.
 *
 * @module dsh-cli-doctor/client/panel
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { checkStatus, fetchHealth } from './api.js';
import {
  KIND_DEP,
  KIND_TOOL,
  SUMMARY_FIELDS,
  candidateBelowCurrent,
  formatDuration,
  formatScope,
  formatTimestamp,
  groupReport,
  impactView,
  recommendationFor,
  skippedChecks,
  statusFor,
  summarize,
} from './view.js';

/** Package version injected by scripts/build-client.mjs; null outside a build. */
const BUILD_VERSION = typeof __CLI_DOCTOR_VERSION__ === 'string' && __CLI_DOCTOR_VERSION__ ? __CLI_DOCTOR_VERSION__ : null;

/** Neutral accents that stay readable on both light and dark shell themes. */
const TONES = {
  anomaly: '#b45309',
  update: '#2563eb',
  steady: 'inherit',
  unknown: '#a16207',
  recommended: '#047857',
  review: '#b45309',
  blocked: '#b91c1c',
};

const STATE_LABELS = {
  idle: '空闲',
  running: '诊断中',
  done: '诊断完成',
  error: '诊断失败',
};

const MUTED = 'rgba(127,127,127,0.9)';
const HAIRLINE = '1px solid rgba(127,127,127,0.28)';

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
  },
  headerMain: { display: 'flex', alignItems: 'baseline', gap: '8px', minWidth: '160px' },
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
  progress: { color: MUTED, fontSize: '12px' },
  alert: {
    border: '1px solid rgba(185,28,28,0.5)',
    borderRadius: '6px',
    padding: '10px 12px',
    color: '#b91c1c',
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '10px',
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
  meta: { color: MUTED, fontSize: '12px', display: 'flex', flexWrap: 'wrap', gap: '12px', margin: 0 },
  skipped: { color: MUTED, fontSize: '12px', margin: 0 },
  section: { border: HAIRLINE, borderRadius: '8px', padding: '12px' },
  sectionHead: { display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '10px', marginBottom: '6px' },
  sectionTitle: { margin: 0, fontSize: '14px', fontWeight: 600 },
  sectionCount: { color: MUTED, fontSize: '12px' },
  layerLabel: { fontSize: '12px', color: MUTED, margin: '6px 0 4px' },
  cards: { display: 'flex', flexDirection: 'column', gap: '8px' },
  card: { border: HAIRLINE, borderRadius: '6px', padding: '10px', display: 'flex', flexDirection: 'column', gap: '6px' },
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

/** The five dashboard counters. */
function SummaryBar({ counts }) {
  return (
    <div style={S.summary}>
      {SUMMARY_FIELDS.map(([field, label]) => (
        <div key={field} style={S.summaryCell}>
          <strong style={S.summaryValue}>{counts[field]}</strong>
          <span style={S.summaryLabel}>{label}</span>
        </div>
      ))}
    </div>
  );
}

/** One ecosystem block: tool layer on top, dependency layer in a disclosure. */
function EcosystemBlock({ block }) {
  return (
    <section style={S.section}>
      <div style={S.sectionHead}>
        <h3 style={S.sectionTitle}>{block.title}</h3>
        <span style={S.sectionCount}>
          {`${block.tools.length} 个工具${block.deps.length ? ` / ${block.deps.length} 个依赖` : ''}`}
        </span>
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
      {block.deps.length ? (
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
 * The main-slot page. Takes no props: everything it shows comes from the Host
 * route it calls when the user asks for a diagnosis.
 *
 * @returns the diagnosis panel.
 */
export function CliDoctorPanel() {
  const [phase, setPhase] = useState('idle');
  const [report, setReport] = useState(null);
  const [checkedAt, setCheckedAt] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const [waitedMs, setWaitedMs] = useState(0);
  const [version, setVersion] = useState(BUILD_VERSION);

  const mountedRef = useRef(true);
  const runningRef = useRef(false);
  const controllerRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (controllerRef.current && typeof controllerRef.current.abort === 'function') {
        controllerRef.current.abort();
        controllerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    fetchHealth(controller ? { signal: controller.signal } : {}).then((health) => {
      if (cancelled || !health || !health.version) return;
      setVersion(health.version);
    });
    return () => {
      cancelled = true;
      if (controller && typeof controller.abort === 'function') controller.abort();
    };
  }, []);

  const run = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    controllerRef.current = controller;
    const startedAt = Date.now();
    setPhase('running');
    setWaitedMs(0);
    setErrorMessage(null);
    timerRef.current = setInterval(() => {
      if (mountedRef.current) setWaitedMs(Date.now() - startedAt);
    }, 1000);
    try {
      const result = await checkStatus(controller ? { signal: controller.signal } : {});
      if (!mountedRef.current) return;
      setReport(result.report);
      setCheckedAt(result.checkedAt);
      setPhase('done');
    } catch (error) {
      if (!mountedRef.current) return;
      if (error && error.name === 'AbortError') return;
      const message = error && typeof error.message === 'string' && error.message ? error.message : String(error);
      setErrorMessage(message);
      setPhase('error');
    } finally {
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (controllerRef.current === controller) controllerRef.current = null;
      runningRef.current = false;
    }
  }, []);

  const counts = useMemo(() => summarize(report), [report]);
  const blocks = counts.blocks;
  const skipped = useMemo(() => skippedChecks(report), [report]);
  const running = phase === 'running';
  const stateLabel = STATE_LABELS[phase] || STATE_LABELS.idle;

  return (
    <div style={S.root} data-dsh-cli-doctor="">
      <header style={S.header}>
        <div style={S.headerMain}>
          <h2 style={S.title}>CLI Doctor</h2>
          <span style={S.version}>{`插件版本 ${version || '未知'}`}</span>
        </div>
        <div style={S.headerActions}>
          <span style={S.state} aria-live="polite">{`当前状态：${stateLabel}`}</span>
          <button
            type="button"
            style={running ? { ...S.button, ...S.buttonBusy } : S.button}
            onClick={run}
            disabled={running}
            aria-busy={running ? 'true' : 'false'}
          >
            一键诊断当前状态
          </button>
        </div>
      </header>

      <div style={S.body} data-dsh-cli-doctor-scroll="">
        {running ? (
          <p style={S.progress} aria-live="polite">{`正在检查，联网查询可能需要几分钟… 已等待 ${formatDuration(waitedMs)}`}</p>
        ) : null}

        {phase === 'error' && errorMessage ? (
          <div style={S.alert} role="alert">
            <span>{`检查未完成：${errorMessage}`}</span>
            <button type="button" style={S.button} onClick={run}>
              重试
            </button>
          </div>
        ) : null}

        {phase === 'idle' && !report ? (
          <p style={S.hint}>首次打开不会自动检查。点击「一键诊断当前状态」运行一次只读诊断；结果不会写入任何文件。</p>
        ) : null}

        {report ? (
          <>
            <SummaryBar counts={counts} />
            <p style={S.meta}>
              <span>{`生成时间：${formatTimestamp(report.generated_at)}`}</span>
              <span>{`范围：${formatScope(report)}`}</span>
              <span>{`耗时：${formatDuration(report.elapsed_ms)}`}</span>
              {checkedAt ? <span>{`本次检查：${formatTimestamp(checkedAt)}`}</span> : null}
            </p>
            {skipped.length ? <p style={S.skipped}>{`未检查：${skipped.join('；')}`}</p> : null}
            {blocks.length ? (
              blocks.map((block) => <EcosystemBlock key={block.key} block={block} />)
            ) : (
              <p style={S.empty}>没有发现可展示的 CLI 工具。请查看终端环境与 PATH。</p>
            )}
            <p style={S.footer}>只读检查：本插件只读取本机工具与依赖的版本信息，未执行任何升级。</p>
          </>
        ) : null}
      </div>
    </div>
  );
}
