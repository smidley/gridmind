import { useState } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend,
} from 'recharts'
import { useApi } from '../hooks/useApi'

export default function HistoryPage() {
  const [hours, setHours] = useState(24)
  const { data: readings, loading } = useApi<any>(`/history/readings?hours=${hours}&resolution=5`)
  const { data: daily } = useApi<any>('/history/daily?days=14')

  const chartData = readings?.readings?.map((r: any) => ({
    time: new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    solar: Math.round(r.solar_power / 1000 * 10) / 10,
    home: Math.round(r.home_power / 1000 * 10) / 10,
    grid: Math.round(r.grid_power / 1000 * 10) / 10,
    battery: Math.round(r.battery_power / 1000 * 10) / 10,
    soc: r.battery_soc,
  })) || []

  const dailyData = daily?.summaries?.map((s: any) => ({
    date: s.date.slice(5), // MM-DD
    solar: Math.round(s.solar_generated_kwh * 10) / 10,
    imported: Math.round(s.grid_imported_kwh * 10) / 10,
    exported: Math.round(s.grid_exported_kwh * 10) / 10,
    consumed: Math.round(s.home_consumed_kwh * 10) / 10,
  })) || []

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Energy History</h2>
          <p className="text-sm text-slate-500">Power and energy charts</p>
        </div>
        <div className="flex gap-2">
          {[6, 12, 24, 48, 72].map((h) => (
            <button
              key={h}
              onClick={() => setHours(h)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                hours === h
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              {h}h
            </button>
          ))}
        </div>
      </div>

      {/* Power Chart */}
      <div className="card">
        <div className="card-header">Power Flow (kW)</div>
        {loading ? (
          <div className="h-72 flex items-center justify-center text-slate-500">Loading...</div>
        ) : chartData.length === 0 ? (
          <div className="h-72 flex items-center justify-center text-slate-500">
            No data available for this time range.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis
                dataKey="time"
                stroke="#475569"
                fontSize={11}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis stroke="#475569" fontSize={11} tickLine={false} />
              <Tooltip
                contentStyle={{
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
              />
              <Legend />
              <Line type="monotone" dataKey="solar" stroke="#fbbf24" name="Solar" dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="home" stroke="#22d3ee" name="Home" dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="grid" stroke="#ef4444" name="Grid" dot={false} strokeWidth={1.5} />
              <Line type="monotone" dataKey="battery" stroke="#3b82f6" name="Battery" dot={false} strokeWidth={1.5} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* SOC Chart */}
      {chartData.length > 0 && (
        <div className="card">
          <div className="card-header">Battery State of Charge (%)</div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis
                dataKey="time"
                stroke="#475569"
                fontSize={11}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis stroke="#475569" fontSize={11} tickLine={false} domain={[0, 100]} />
              <Tooltip
                contentStyle={{
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
              />
              <Line type="monotone" dataKey="soc" stroke="#3b82f6" name="SOC" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Daily Summary Bar Chart */}
      {dailyData.length > 0 && (
        <div className="card">
          <div className="card-header">Daily Energy Summary (kWh)</div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={dailyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="date" stroke="#475569" fontSize={11} tickLine={false} />
              <YAxis stroke="#475569" fontSize={11} tickLine={false} />
              <Tooltip
                cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                contentStyle={{
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
              />
              <Legend />
              <Bar dataKey="solar" fill="#fbbf24" name="Solar" radius={[2, 2, 0, 0]} />
              <Bar dataKey="consumed" fill="#22d3ee" name="Consumed" radius={[2, 2, 0, 0]} />
              <Bar dataKey="imported" fill="#ef4444" name="Imported" radius={[2, 2, 0, 0]} />
              <Bar dataKey="exported" fill="#22c55e" name="Exported" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
