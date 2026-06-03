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
  onPerform,
  onVoiceScore,
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
  onPerform: () => void;
  onVoiceScore: () => void;
  serif: boolean;
}) {
  return (
    <div className="fade-idle pointer-events-none fixed left-1/2 top-3 z-20 -translate-x-1/2 max-w-[calc(100vw-2rem)] print:hidden">
      <div className="pointer-events-auto flex items-center gap-1 rounded-md border border-ink-line bg-ink-surface/85 px-2 py-1 text-[11px] text-ink-mute backdrop-blur transition-colors duration-150 overflow-x-auto scrollbar-hide">
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
        {/* Takes opens the takes panel; perform shortcut opens takes with record intent */}
        <ToolBtn onClick={onTakes} title="Recorded takes — audio, video, performance">
          takes
        </ToolBtn>
        <Sep />
        <button
          onClick={onPerform}
          title="Perform — play music with your hands or touch"
          className="px-2.5 py-1 text-amber-gold transition-colors duration-150 hover:bg-amber-gold/10"
        >
          perform
        </button>
        <Sep />
        <ToolBtn onClick={onVoiceScore} title="Voice to Score — hum a melody">
          voice score
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
      className="px-2.5 py-1 transition-colors duration-150 hover:bg-ink-line hover:text-ink-text"
    >
      {children}
    </button>
  );
}

function Sep() {
  return <span className="text-ink-mute/30">·</span>;
}
