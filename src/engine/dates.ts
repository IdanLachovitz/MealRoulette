/** All dates in the app are handled as local-time YYYY-MM-DD strings. */

export function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function parseISODate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(s: string, n: number): string {
  const d = parseISODate(s)
  d.setDate(d.getDate() + n)
  return toISODate(d)
}

export function daysBetween(from: string, to: string): number {
  const a = parseISODate(from).getTime()
  const b = parseISODate(to).getTime()
  return Math.round((b - a) / 86400000)
}

export function startOfWeek(date: string, weekStartsOn: 0 | 1): string {
  const d = parseISODate(date)
  const diff = (d.getDay() - weekStartsOn + 7) % 7
  d.setDate(d.getDate() - diff)
  return toISODate(d)
}

export const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']
const MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
]

export function dayName(date: string): string {
  return DAY_NAMES[parseISODate(date).getDay()]
}

export function dayOfMonth(date: string): number {
  return parseISODate(date).getDate()
}

/** "17–23 באוגוסט" — and spans two month names when the week crosses over. */
export function formatWeekRange(weekStart: string): string {
  const start = parseISODate(weekStart)
  const end = parseISODate(addDays(weekStart, 6))
  if (start.getMonth() === end.getMonth()) {
    return `${start.getDate()}–${end.getDate()} ב${MONTHS[start.getMonth()]}`
  }
  return `${start.getDate()} ב${MONTHS[start.getMonth()]} – ${end.getDate()} ב${MONTHS[end.getMonth()]}`
}

export function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
}
