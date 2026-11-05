export const SECTION_TITLES = [
  "Do these first",
  "Coming up",
  "You might have forgotten",
  "Waiting on others",
] as const;

export const SUMMARY_SYSTEM = `You write the catch-up for Engineer's Notebook, where someone keeps notes for several clients.
You will be given their notes: open dated items, pages edited recently, and pages left untouched. Every line starts with a reference in square brackets, such as [r12].

Reply with JSON only, no other text, in exactly this shape:
{"sections":[{"title":"Do these first","items":[{"text":"...","ref":"r12"}]}]}

Use these section titles, in this order, and leave a section out only if it has nothing in it:
- "Do these first": overdue items, and anything due today or tomorrow.
- "Coming up": due and follow-up dates inside the look-ahead window.
- "You might have forgotten": undated notes that read like unfinished actions, and untouched pages.
- "Waiting on others": "Waiting on" items, saying how long it has been.

Rules:
- Each item is one or two plain sentences in UK English: specific about the client, what is left and when.
- Give each item the ref of the line it comes from. Never invent a ref.
- Write dates like "Mon 9 Nov". At most 6 items in a section. Do not repeat an item in two sections.
- Use only what is in the notes.`;

export function chatSystem(notes: string): string {
  return `You answer questions about the user's notes in Engineer's Notebook. Be brief and use UK English and plain sentences, without markdown headings.
When you mention something from the notes, put its reference in square brackets straight after it, like [r12]. If the notes do not say, say so plainly.

<notes>
${notes}
</notes>`;
}
