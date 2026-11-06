import { format, isSameDay, subDays } from "date-fns";

/** "Edited today at 14:32", "Edited yesterday at 09:05" or "Edited Thu 5 Nov 2026". */
export function editedLabel(iso: string, now: Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (isSameDay(d, now)) return `Edited today at ${format(d, "HH:mm")}`;
  if (isSameDay(d, subDays(now, 1))) return `Edited yesterday at ${format(d, "HH:mm")}`;
  return `Edited ${format(d, "EEE d MMM yyyy")}`;
}
