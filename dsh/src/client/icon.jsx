/**
 * The sidebar glyph for the CLI Doctor panel row.
 *
 * The shell owns the row box, label, tooltip and highlight; this component draws
 * only the glyph, at the size and selection state the shell passes down
 * (CONTRACT.md §3.3). `data-dsh-panel-entry` marks the one DOM node the plugin
 * owns inside the shell-owned row, following the convention the shipped panels
 * use.
 *
 * @module dsh-cli-doctor/client/icon
 */

/**
 * @param props - the shell's icon share: square edge and selection state.
 * @returns the decorative stethoscope-on-terminal glyph.
 */
export function CliDoctorIcon({ size = 16, active = false } = {}) {
  const edge = Number.isFinite(Number(size)) && Number(size) > 0 ? Number(size) : 16;
  return (
    <svg
      data-dsh-panel-entry="cli-doctor"
      viewBox="0 0 16 16"
      width={edge}
      height={edge}
      fill="none"
      stroke="currentColor"
      strokeWidth={active ? 1.6 : 1.3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="1.75" y="2.25" width="12.5" height="11.5" rx="2" />
      <path d="M4.5 6.25l2 1.75-2 1.75" />
      <path d="M8.5 10.25h3" />
    </svg>
  );
}
