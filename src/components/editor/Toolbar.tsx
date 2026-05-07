"use client";

export function Toolbar({
  onInsertStructure,
  onScan,
  onRhymes,
  onHistory,
  onTakes,
  onExport,
  onTags,
  onToggleFont,
  serif,
}: {
  onInsertStructure: () => void;
  onScan: () => void;
  onRhymes: () => void;
  onHistory: () => void;
  onTakes: () => void;
  onExport: () => void;
  onTags: () => void;
  onToggleFont: () => void;
  serif: boolean;
}) {
  return (
    <div className="fade-idle pointer-events-none fixed left-1/2 top-3 z-20 -translate-x-1/2 print:hidden">
      <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-ink-line bg-ink-surface/85 px-2 py-1 text-[11px] text-ink-mute backdrop-blur transition-colors duration-150">
        <ToolBtn onClick={onInsertStructure} title="Insert structure tag (⌘/)">
          ⌘/ tag
        </ToolBtn>
        <Sep />
        <ToolBtn onClick={onRhymes} title="Find rhymes (⌘R)">
          rhymes
        </ToolBtn>
        <Sep />
        <ToolBtn onClick={onScan} title="Scan handwritten lyrics">
          scan
        </ToolBtn>
        <Sep />
        <ToolBtn onClick={onTakes} title="Recorded vocal takes">
          takes
        </ToolBtn>
        <Sep />
        <ToolBtn onClick={onHistory} title="Version history (⌘⇧H)">
          history
        </ToolBtn>
        <Sep />
        <ToolBtn onClick={onTags} title="Edit tags">
          tags
        </ToolBtn>
        <Sep />
        <ToolBtn onClick={onExport} title="Export">
          export
        </ToolBtn>
        <Sep />
        <ToolBtn onClick={onToggleFont} title="Toggle serif/mono">
          {serif ? "serif" : "mono"}
        </ToolBtn>
      </div>
    </div>
  );
}

function ToolBtn({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="rounded-full px-2.5 py-1 transition-colors duration-150 hover:bg-ink-line hover:text-ink-text"
    >
      {children}
    </button>
  );
}

function Sep() {
  return <span className="text-ink-mute/30">·</span>;
}
