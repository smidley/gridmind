import { useState, useRef, useCallback } from 'react'
import {
  Brain, Trophy, AlertTriangle, Lightbulb, Info, MessageCircle, Loader2,
} from 'lucide-react'
import { useApi, apiFetch } from '../hooks/useApi'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import AnimatedValue from '../components/AnimatedValue'

const API_BASE = import.meta.env.VITE_API_BASE || '/api'

interface Insight {
  title: string
  body: string
  type: 'achievement' | 'tip' | 'warning' | 'info'
  followup_questions?: string[]
}

interface Anomaly {
  title: string
  description: string
  severity: 'info' | 'warning' | 'critical'
  metric?: string
}

function InsightIcon({ type, className = '' }: { type: string; className?: string }) {
  switch (type) {
    case 'achievement': return <Trophy className={`${className} text-amber-400`} />
    case 'warning': return <AlertTriangle className={`${className} text-amber-500`} />
    case 'tip': return <Lightbulb className={`${className} text-emerald-400`} />
    default: return <Info className={`${className} text-blue-400`} />
  }
}

function InsightCard({ insight, index }: { insight: Insight; index: number }) {
  const [expanded, setExpanded] = useState(false)
  const [activeQuestion, setActiveQuestion] = useState<string | null>(null)
  const [streamedText, setStreamedText] = useState('')
  const [streaming, setStreaming] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const askFollowup = useCallback(async (question: string) => {
    if (streaming) return

    // Cancel any previous stream
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setActiveQuestion(question)
    setStreamedText('')
    setStreaming(true)

    try {
      const response = await fetch(`${API_BASE}/ai/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          context: `${insight.title}\n${insight.body}`,
          question,
        }),
        signal: controller.signal,
      })

      if (!response.ok) throw new Error('Failed to get response')

      const reader = response.body?.getReader()
      if (!reader) throw new Error('No stream')

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              if (data.text) {
                setStreamedText(prev => prev + data.text)
              }
              if (data.done || data.error) {
                setStreaming(false)
              }
            } catch { /* ignore parse errors */ }
          }
        }
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        setStreamedText('Failed to get response. Please try again.')
      }
    } finally {
      setStreaming(false)
    }
  }, [insight, streaming])

  return (
    <div className="card overflow-hidden">
      <div
        className="flex items-start gap-3 cursor-pointer"
        onClick={() => { setExpanded(!expanded); if (expanded) { setActiveQuestion(null); setStreamedText('') } }}
      >
        <InsightIcon type={insight.type} className="w-5 h-5 shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-medium text-stone-800 dark:text-slate-200">{insight.title}</p>
          <p className="text-xs text-stone-500 dark:text-slate-400 mt-1">{insight.body}</p>
        </div>
        <MessageCircle className={`w-4 h-4 shrink-0 mt-1 transition-colors ${expanded ? 'text-blue-400' : 'text-slate-400'}`} />
      </div>

      {/* Expanded: follow-up questions */}
      {expanded && (
        <div className="mt-4 pt-3 border-t border-stone-200/30 dark:border-slate-800/50">
          <div className="text-[10px] text-stone-500 dark:text-slate-500 font-medium uppercase tracking-wider mb-2">Ask a follow-up</div>
          <div className="flex flex-wrap gap-2">
            {(insight.followup_questions || []).map((q, i) => (
              <button
                key={i}
                onClick={(e) => { e.stopPropagation(); askFollowup(q) }}
                disabled={streaming}
                className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                  activeQuestion === q
                    ? 'bg-blue-500/15 border-blue-500/30 text-blue-500 dark:text-blue-400'
                    : 'border-stone-200 dark:border-slate-700 text-stone-500 dark:text-slate-400 hover:border-blue-500/30 hover:text-blue-500'
                }`}
              >
                {q}
              </button>
            ))}
          </div>

          {/* Streaming response */}
          {(streamedText || streaming) && (
            <div className="mt-3 p-3 rounded-lg bg-stone-50 dark:bg-slate-800/40 border border-stone-200/40 dark:border-slate-700/40">
              <div className="flex items-start gap-2">
                <Brain className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                <div className="text-sm text-stone-700 dark:text-slate-300 leading-relaxed">
                  {streamedText}
                  {streaming && <span className="inline-block w-1.5 h-4 bg-blue-400 ml-0.5 animate-pulse" />}
                </div>
              </div>
              {streaming && (
                <div className="flex items-center gap-1.5 mt-2 text-[10px] text-stone-400 dark:text-slate-500">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Thinking...
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function AIInsights() {
  const { data: insights } = useApi<any>('/ai/insights-with-followups')
  const { data: anomalies } = useApi<any>('/ai/anomalies')
  const { data: billEstimate } = useApi<any>('/ai/bill-estimate')
  const { data: aiStatus } = useApi<any>('/ai/status')

  const insightsList: Insight[] = insights?.insights || []
  const anomalyList: Anomaly[] = anomalies?.anomalies || []
  const isConfigured = aiStatus?.configured

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Brain className="w-6 h-6 text-blue-400" />
        <div>
          <h1 className="text-lg font-bold text-stone-800 dark:text-slate-100">AI Insights</h1>
          <p className="text-xs text-stone-500 dark:text-slate-500">
            {aiStatus?.provider_name ? `Powered by ${aiStatus.provider_name}` : 'Energy analysis and recommendations'}
          </p>
        </div>
        <span className="live-dot ml-1" />
      </div>

      {!isConfigured && (
        <div className="card text-center py-8">
          <Brain className="w-10 h-10 text-slate-400 dark:text-slate-600 mx-auto mb-3" />
          <p className="text-stone-600 dark:text-slate-400">AI provider not configured.</p>
          <p className="text-xs text-stone-500 dark:text-slate-500 mt-1">Add an API key in Settings to enable AI-powered insights.</p>
        </div>
      )}

      {/* Anomalies (show first — they're more urgent) */}
      {anomalyList.length > 0 && (
        <div className="space-y-2">
          {anomalyList.map((anomaly, i) => (
            <div key={i} className={`flex items-start gap-3 p-3 rounded-xl border ${
              anomaly.severity === 'critical'
                ? 'border-red-500/30 bg-red-500/5'
                : anomaly.severity === 'warning'
                ? 'border-amber-500/30 bg-amber-500/5'
                : 'border-blue-500/30 bg-blue-500/5'
            }`}>
              <Brain className={`w-4 h-4 shrink-0 mt-0.5 ${
                anomaly.severity === 'critical' ? 'text-red-400' :
                anomaly.severity === 'warning' ? 'text-amber-400' : 'text-blue-400'
              }`} />
              <div>
                <p className={`text-sm font-medium ${
                  anomaly.severity === 'critical' ? 'text-red-400' :
                  anomaly.severity === 'warning' ? 'text-amber-400' : 'text-blue-400'
                }`}>{anomaly.title}</p>
                <p className="text-xs text-stone-500 dark:text-slate-400 mt-0.5">{anomaly.description}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Insights */}
      {insightsList.length > 0 && (
        <div className="space-y-3">
          <div className="text-[10px] text-stone-500 dark:text-slate-500 font-medium uppercase tracking-wider">
            Insights · {insightsList.length} items · Click to explore
          </div>
          {insightsList.map((insight, i) => (
            <InsightCard key={i} insight={insight} index={i} />
          ))}
        </div>
      )}

      {insightsList.length === 0 && isConfigured && (
        <div className="card text-center py-6">
          <p className="text-xs text-stone-500 dark:text-slate-500">No insights yet. Data will be analyzed on the next cycle.</p>
        </div>
      )}

      {/* Monthly Bill Estimate */}
      {billEstimate && !billEstimate.error && billEstimate.estimated_total != null && (
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Brain className="w-4.5 h-4.5 text-blue-400" />
              <span className="card-header mb-0">Estimated Monthly Bill</span>
            </div>
            {billEstimate.confidence && (
              <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${
                billEstimate.confidence === 'high' ? 'bg-emerald-500/15 text-emerald-500'
                : billEstimate.confidence === 'medium' ? 'bg-amber-500/15 text-amber-500'
                : 'bg-slate-500/15 text-slate-400'
              }`}>
                {billEstimate.confidence} confidence
              </span>
            )}
          </div>

          <div className="text-center mb-4">
            <div className="stat-value text-blue-400">
              <AnimatedValue value={billEstimate.estimated_total} format={(v: number) => `$${v.toFixed(2)}`} />
            </div>
            <div className="stat-label">{billEstimate.month} estimate</div>
            <p className="text-[10px] text-stone-500 dark:text-slate-500 mt-1">
              {billEstimate.days_tracked} of {billEstimate.days_in_month} days tracked
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            {billEstimate.energy_charges != null && (
              <div>
                <span className="text-stone-500 dark:text-slate-500">Energy Charges</span>
                <p className="font-bold text-red-400">${billEstimate.energy_charges.toFixed(2)}</p>
              </div>
            )}
            {billEstimate.export_credits != null && (
              <div>
                <span className="text-stone-500 dark:text-slate-500">Export Credits</span>
                <p className="font-bold text-emerald-400">${Math.abs(billEstimate.export_credits).toFixed(2)}</p>
              </div>
            )}
            {billEstimate.fixed_fees != null && (
              <div>
                <span className="text-stone-500 dark:text-slate-500">Fixed Fees</span>
                <p className="font-bold text-stone-600 dark:text-slate-300">${billEstimate.fixed_fees.toFixed(2)}</p>
              </div>
            )}
            {billEstimate.taxes_and_fees != null && (
              <div>
                <span className="text-stone-500 dark:text-slate-500">Taxes & Fees</span>
                <p className="font-bold text-stone-600 dark:text-slate-300">${billEstimate.taxes_and_fees.toFixed(2)}</p>
              </div>
            )}
          </div>

          {billEstimate.note && (
            <p className="text-[10px] text-stone-500 dark:text-slate-500 mt-3 pt-3 border-t border-stone-200/30 dark:border-slate-800/50">
              {billEstimate.note}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
