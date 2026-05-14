import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';

import {
  AGENTS_MODAL_AVATAR_ZOOM,
  HUE_SHIFT_MIN_DEG,
  HUE_SHIFT_SLIDER_MAX_DEG,
  HUE_SHIFT_SLIDER_MIN_DEG,
  MAX_CONTEXT_TOKENS,
  TEAM_LEAD_COLOR,
  TEAM_ROLE_COLOR,
} from '../constants.js';
import type { OfficeState } from '../office/engine/officeState.js';
import {
  getCharacterSprites,
  getLoadedCharacterCount,
} from '../office/sprites/spriteData.js';
import type { Character, SpriteData, ToolActivity } from '../office/types.js';
import { Direction } from '../office/types.js';
import { vscode } from '../vscodeApi.js';
import { Button } from './ui/Button.js';
import { Modal } from './ui/Modal.js';

interface AgentsModalProps {
  isOpen: boolean;
  onClose: () => void;
  officeState: OfficeState;
  agents: number[];
  agentStatuses: Record<number, string>;
  agentTools: Record<number, ToolActivity[]>;
}

function drawSpriteToCanvas(canvas: HTMLCanvasElement, sprite: SpriteData, zoom: number): void {
  const rows = sprite.length;
  const cols = sprite[0]?.length ?? 0;
  canvas.width = cols * zoom;
  canvas.height = rows * zoom;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const color = sprite[r][c];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(c * zoom, r * zoom, zoom, zoom);
    }
  }
}

function AvatarPreview({
  palette,
  hueShift,
  zoom = AGENTS_MODAL_AVATAR_ZOOM,
}: {
  palette: number;
  hueShift: number;
  zoom?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const sprites = getCharacterSprites(palette, hueShift);
    drawSpriteToCanvas(canvas, sprites.typing[Direction.DOWN][0], zoom);
  }, [palette, hueShift, zoom]);
  return <canvas ref={canvasRef} className="block" style={{ imageRendering: 'pixelated' }} />;
}

function getDisplayName(ch: Character | undefined, id: number): string {
  if (!ch) return `Agent ${id}`;
  if (ch.agentName) return ch.agentName;
  if (ch.folderName) return ch.folderName;
  return `Agent ${id}`;
}

function getRoleLabel(ch: Character | undefined): string | null {
  if (!ch) return null;
  if (ch.isTeamLead) return 'LEAD';
  if (ch.agentName) return ch.agentName;
  return null;
}

function getAgentStatusLabel(
  ch: Character | undefined,
  status: string | undefined,
  tools: ToolActivity[] | undefined,
): string {
  if (ch?.bubbleType === 'permission') return 'Awaiting permission';
  if (status === 'waiting') return 'Waiting for input';
  const activeTool = tools?.find((t) => !t.done);
  if (activeTool) return activeTool.status;
  if (ch?.isActive) return 'Working';
  return 'Idle';
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return `${n}`;
}

function persistSeats(officeState: OfficeState): void {
  const seats: Record<number, { palette: number; hueShift: number; seatId: string | null }> = {};
  for (const ch of officeState.characters.values()) {
    if (ch.isSubagent) continue;
    seats[ch.id] = { palette: ch.palette, hueShift: ch.hueShift, seatId: ch.seatId };
  }
  vscode.postMessage({ type: 'saveAgentSeats', seats });
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-6 py-1">
      <span className="text-xs text-text-muted w-22 shrink-0">{label}</span>
      <span className="text-xs text-text break-words min-w-0 flex-1">{children}</span>
    </div>
  );
}

export function AgentsModal({
  isOpen,
  onClose,
  officeState,
  agents,
  agentStatuses,
  agentTools,
}: AgentsModalProps) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  // Tick counter to force re-render after imperative mutations to Character
  const [, setTick] = useState(0);
  const bump = () => setTick((n) => n + 1);

  // Collapse expanded card when modal closes
  useEffect(() => {
    if (!isOpen) setExpandedId(null);
  }, [isOpen]);

  const paletteCount = getLoadedCharacterCount();

  // Sort agents by id for stable ordering
  const sortedIds = [...agents].sort((a, b) => a - b);

  const handlePaletteChange = (agentId: number, newPalette: number) => {
    const ch = officeState.characters.get(agentId);
    if (!ch) return;
    ch.palette = newPalette;
    persistSeats(officeState);
    bump();
  };

  const handleHueShiftChange = (agentId: number, newHueShift: number) => {
    const ch = officeState.characters.get(agentId);
    if (!ch) return;
    ch.hueShift = newHueShift;
    bump();
  };

  const handleHueShiftCommit = () => {
    persistSeats(officeState);
  };

  const handleFocus = (agentId: number) => {
    vscode.postMessage({ type: 'focusAgent', id: agentId });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Agents" className="max-w-2xl">
      {sortedIds.length === 0 && (
        <div className="py-12 px-10 text-center text-text-muted text-sm">
          No agents yet. Click <span className="text-accent">+ Agent</span> to launch one.
        </div>
      )}
      <div className="max-h-128 overflow-y-auto">
        {sortedIds.map((id) => {
          const ch = officeState.characters.get(id);
          const isExpanded = expandedId === id;
          const displayName = getDisplayName(ch, id);
          const roleLabel = getRoleLabel(ch);
          const statusLabel = getAgentStatusLabel(ch, agentStatuses[id], agentTools[id]);
          const palette = ch?.palette ?? 0;
          const hueShift = ch?.hueShift ?? 0;
          const seatLabel = ch?.seatId ? 'Seated' : 'Wandering';

          const tools = agentTools[id] ?? [];
          const activeTool = tools.find((t) => !t.done);
          const recentTools = tools.slice(-5).reverse();
          const inputTokens = ch?.inputTokens ?? 0;
          const outputTokens = ch?.outputTokens ?? 0;
          const totalTokens = inputTokens + outputTokens;
          const contextPct = Math.round((totalTokens / MAX_CONTEXT_TOKENS) * 100);

          return (
            <div key={id} className="border-b border-border last:border-b-0">
              <div
                className="flex items-center gap-8 py-6 px-10 cursor-pointer hover:bg-btn-bg"
                onClick={() => setExpandedId(isExpanded ? null : id)}
              >
                <div className="shrink-0 w-12 h-18 flex items-end justify-center">
                  {ch ? (
                    <AvatarPreview palette={palette} hueShift={hueShift} />
                  ) : (
                    <span className="text-text-muted text-xs">?</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-4 flex-wrap">
                    <span className="text-text text-base truncate">{displayName}</span>
                    {roleLabel && (
                      <span
                        className="text-2xs px-3 py-1 border-2 leading-none"
                        style={{
                          color: ch?.isTeamLead ? TEAM_LEAD_COLOR : TEAM_ROLE_COLOR,
                          borderColor: ch?.isTeamLead ? TEAM_LEAD_COLOR : TEAM_ROLE_COLOR,
                          fontWeight: ch?.isTeamLead ? 'bold' : undefined,
                        }}
                      >
                        {roleLabel}
                      </span>
                    )}
                    <span className="text-text-muted text-xs">#{id}</span>
                  </div>
                  <div className="text-text-muted text-xs truncate">
                    {statusLabel} · {seatLabel}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleFocus(id);
                  }}
                  title="Focus terminal"
                >
                  Focus
                </Button>
                <span className="text-text-muted text-xs w-8 text-center">
                  {isExpanded ? '▾' : '▸'}
                </span>
              </div>

              {isExpanded && ch && (
                <div className="py-6 px-10 bg-btn-bg/50 flex flex-col gap-10">
                  <section>
                    <div className="text-xs text-accent-bright mb-4 uppercase tracking-wide">
                      Details
                    </div>
                    <DetailRow label="Name">{displayName}</DetailRow>
                    {ch.teamName && <DetailRow label="Team">{ch.teamName}</DetailRow>}
                    {roleLabel && (
                      <DetailRow label="Role">
                        <span
                          style={{
                            color: ch.isTeamLead ? TEAM_LEAD_COLOR : TEAM_ROLE_COLOR,
                            fontWeight: ch.isTeamLead ? 'bold' : undefined,
                          }}
                        >
                          {roleLabel}
                        </span>
                        {ch.leadAgentId !== undefined && !ch.isTeamLead && (
                          <span className="text-text-muted"> · reports to #{ch.leadAgentId}</span>
                        )}
                      </DetailRow>
                    )}
                    {ch.folderName && <DetailRow label="Workspace">{ch.folderName}</DetailRow>}
                    <DetailRow label="Status">{statusLabel}</DetailRow>
                    <DetailRow label="Seat">
                      {ch.seatId ? `Assigned (${ch.seatId})` : 'Wandering'}
                    </DetailRow>
                    {activeTool && (
                      <DetailRow label="Current">
                        <span className="text-accent">{activeTool.status}</span>
                      </DetailRow>
                    )}
                    {recentTools.length > 0 && (
                      <DetailRow label="Recent">
                        {recentTools
                          .map((t) => t.status.split(':')[0].trim() || t.status)
                          .join(' · ')}
                      </DetailRow>
                    )}
                    {totalTokens > 0 && (
                      <DetailRow label="Tokens">
                        {formatTokens(inputTokens)} in / {formatTokens(outputTokens)} out
                        <span className="text-text-muted"> · {contextPct}% of context</span>
                      </DetailRow>
                    )}
                  </section>

                  <section>
                    <div className="text-xs text-accent-bright mb-4 uppercase tracking-wide">
                      Avatar
                    </div>
                    <div className="flex items-center gap-6 mb-6 flex-wrap">
                      {Array.from({ length: paletteCount }).map((_, idx) => {
                        const isSelected = idx === palette;
                        return (
                          <button
                            key={idx}
                            onClick={() => handlePaletteChange(id, idx)}
                            className={`p-2 border-2 ${
                              isSelected
                                ? 'border-accent bg-active-bg'
                                : 'border-transparent hover:border-border'
                            } cursor-pointer rounded-none bg-bg`}
                            title={`Skin ${idx + 1}`}
                          >
                            <AvatarPreview
                              palette={idx}
                              hueShift={isSelected ? hueShift : 0}
                            />
                          </button>
                        );
                      })}
                    </div>

                    <div className="flex items-center gap-6">
                      <label className="text-xs text-text-muted shrink-0">Hue shift</label>
                      <input
                        type="range"
                        min={HUE_SHIFT_SLIDER_MIN_DEG}
                        max={HUE_SHIFT_SLIDER_MAX_DEG}
                        value={hueShift}
                        onChange={(e) => handleHueShiftChange(id, Number(e.target.value))}
                        onMouseUp={handleHueShiftCommit}
                        onTouchEnd={handleHueShiftCommit}
                        onKeyUp={handleHueShiftCommit}
                        className="flex-1"
                      />
                      <span className="text-xs text-text-muted w-12 text-right">{hueShift}°</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          handleHueShiftChange(id, HUE_SHIFT_SLIDER_MIN_DEG);
                          handleHueShiftCommit();
                        }}
                        title="Reset hue"
                      >
                        Reset
                      </Button>
                    </div>
                    <div className="text-xs text-text-muted mt-4">
                      Tip: values ≥ {HUE_SHIFT_MIN_DEG}° are used automatically when palettes repeat.
                    </div>
                  </section>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
