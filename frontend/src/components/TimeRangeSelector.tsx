export interface TimeRange {
  id: string
  label: string
  apiParam: string  // e.g., "since=today" or "hours=24"
  resolution: number  // Chart resolution in minutes
}

export const TIME_RANGES: TimeRange[] = [
  { id: 'today', label: 'Today', apiParam: 'since=today', resolution: 5 },
  { id: '1h', label: '1h', apiParam: 'hours=1', resolution: 1 },
  { id: '12h', label: '12h', apiParam: 'hours=12', resolution: 5 },
  { id: '24h', label: '24h', apiParam: 'hours=24', resolution: 5 },
  { id: '7d', label: '7d', apiParam: 'hours=168', resolution: 30 },
]

interface Props {
  value: string
  onChange: (id: string) => void
}

export default function TimeRangeSelector({ value, onChange }: Props) {
  return (
    <div className="flex gap-1 bg-slate-200/60 dark:bg-slate-800/60 rounded-lg p-0.5">
      {TIME_RANGES.map(({ id, label }) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
            value === id
              ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

/** Helper: get the TimeRange config for a given id */
export function getTimeRange(id: string): TimeRange {
  return TIME_RANGES.find(r => r.id === id) || TIME_RANGES[0]
}
