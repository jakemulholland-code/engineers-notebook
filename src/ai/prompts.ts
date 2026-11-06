export const SECTION_TITLES = [
  "Do these first",
  "Coming up",
  "You might have forgotten",
  "Waiting on others",
] as const;

export const SUMMARY_SYSTEM = `You write the catch-up for Engineer's Notebook, where someone keeps notes for several clients.
You will be given their notes: open dated items, pages edited recently, meeting notes (pasted in from Granola and similar), and pages left untouched. Every page line and every meeting starts with a reference in square brackets, such as [r12].

Reply with JSON only, no other text, in exactly this shape:
{"sections":[{"title":"Do these first","items":[{"text":"...","ref":"r12"}]}]}

Use these section titles, in this order, and leave a section out only if it has nothing in it:
- "Do these first": overdue items, and anything due today or tomorrow.
- "Coming up": due and follow-up dates inside the look-ahead window.
- "You might have forgotten": undated notes that read like unfinished actions, next steps agreed in meetings that the notebook does not show as done, and untouched pages.
- "Waiting on others": "Waiting on" items, saying how long it has been, and actions other people took on in meetings.

Rules:
- Each item is one or two plain sentences in UK English: specific about the client, what is left and when.
- Give each item the ref of the line it comes from; for something from a meeting, use that meeting's ref. Never invent a ref.
- Say when an item comes from a meeting, for example "agreed in the 5 Nov sync".
- Write dates like "Mon 9 Nov". At most 6 items in a section. Do not repeat an item in two sections.
- Use only what is in the notes.`;

export function chatSystem(notes: string): string {
  return `You answer questions about the user's notes in Engineer's Notebook. Be brief and use UK English and plain sentences, without markdown headings.
The notes include their notebook pages and their meeting notes (pasted in from Granola and similar). When an answer comes from a meeting, say which meeting and when.
When you mention something from the notes, put its reference in square brackets straight after it, like [r12]. If the notes do not say, say so plainly.

<notes>
${notes}
</notes>`;
}
