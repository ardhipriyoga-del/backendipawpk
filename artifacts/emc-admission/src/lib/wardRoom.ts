export interface ParsedWardRoom {
  ward: string;
  room: string;
  bed: string;
  roomType: string;
}

/**
 * Parses the Ward Room format used by the inpatient TrakCare table:
 * "Jasmine PK 516 PK B3 - III"
 */
export function parseWardRoomDisplay(text: string): ParsedWardRoom | null {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const match = normalized.match(
    /^(.*?)\s+PK\s+(\d+)\s+PK\s+([Bb][^- \t]+)\s*-\s*(.+?)\s*$/i,
  );

  if (!match) return null;

  const [, ward, room, bed, roomType] = match;
  if (!ward.trim() || !room.trim() || !bed.trim() || !roomType.trim()) return null;

  return {
    ward: ward.trim(),
    room: room.trim(),
    bed: bed.trim().toUpperCase(),
    roomType: roomType.trim(),
  };
}