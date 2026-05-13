import { useEffect, useRef, useState } from 'react';

import { HUE_SHIFT_MIN_DEG } from '../constants.js';
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

const AVATAR_PREVIEW_ZOOM = 3;

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
  zoom = AVATAR_PREVIEW_ZOOM,
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

function getAgentLabel(ch: Character | undefined, id: number): string {
  if (!ch) return `Agent ${id}`;
  if (ch.teamName && ch.agentName) {
    return `${ch.teamName} · ${ch.agentName}`;
  }
  if (ch.agentName) return ch.agentName;
  if (ch.folderName) return ch.folderName;
  return `Agent ${id}`;
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

function persistSeats(officeState: OfficeState): void {
  const seats: Record<number, { palette: number; hueShift: number; seatId: string | null }> = {};
  for (const ch of officeState.characters.values()) {
    if (ch.isSubagent) continue;
    seats[ch.id] = { palette: ch.palette, hueShift: ch.hueShift, seatId: ch.seatId };
  }
  vscode.postMessage({ type: 'saveAgentSeats', seats });
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
          const label = getAgentLabel(ch, id);
          const statusLabel = getAgentStatusLabel(ch, agentStatuses[id], agentTools[id]);
          const palette = ch?.palette ?? 0;
          const hueShift = ch?.hueShift ?? 0;
          const seatLabel = ch?.seatId ? 'Seated' : 'Wandering';

          return (
            <div key={id} className="border-b border-border last:border-b-0">
              <div
                className="flex items-center gap-8 py-6 px-10 cursor-pointer hover:bg-btn-bg"
                onClick={() => setExpandedId(isExpanded ? null : id)}
              >
                <div className="shrink-0 w-12 h-18 flex items-end justify-center">
                  {ch ? (
                    <AvatarPreview palette={palette} hueShift={hueShift} zoom={2} />
                  ) : (
                    <span className="text-text-muted text-xs">?</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-4">
                    <span className="text-text text-base truncate">{label}</span>
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
                <div className="py-6 px-10 bg-btn-bg/50">
                  <div className="text-xs text-text-muted mb-4">Avatar</div>
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
                            zoom={2}
                          />
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex items-center gap-6">
                    <label className="text-xs text-text-muted shrink-0">Hue shift</label>
                    <input
                      type="range"
                      min={0}
                      max={359}
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
                        handleHueShiftChange(id, 0);
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
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
